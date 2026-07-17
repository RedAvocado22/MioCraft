---
title: "Command Pattern — khi hành vi cần được điều phối"
description: "Command đóng gói một yêu cầu thành object — cho phép queue, log, undo, và retry. Đây là nền tảng của event sourcing và nhiều hệ thống phức tạp."
category: programming
pubDate: 2024-02-16
series: "Phần 5: Design Patterns"
tags: ["design-patterns", "command", "event-sourcing"]
---

Có một class of problem mà các pattern trước không giải được: khi hành vi cần trở thành một *thứ gì đó* — một object bạn có thể truyền đi, lưu lại, xếp hàng, undo, hoặc retry.

Ví dụ cụ thể trong HMS: patient hủy appointment. Flow đơn giản:

1. Đổi status appointment sang `CANCELLED`
2. Giải phóng slot trong Redis
3. Gửi refund notification nếu đã thanh toán
4. Cập nhật schedule của doctor

Bây giờ business yêu cầu thêm: nếu user hủy trong vòng 24 giờ trước lịch khám, admin phải được notify và approve trước khi hủy thực sự có hiệu lực. Và admin có thể undo approve trong vòng 1 giờ.

Đột nhiên bạn cần lưu trữ "hành động hủy lịch" như một entity — không phải chỉ thực thi nó ngay.

---

## Command Pattern: đóng gói hành vi thành object

Command Pattern biến một *request* thành một object độc lập. Object đó chứa tất cả thông tin cần thiết để thực thi request — và quan trọng hơn, có thể được lưu trữ, truyền đi, xếp hàng, hay thực thi sau.

```java
// Command interface — tất cả command đều có cùng contract
public interface AppointmentCommand {
    void execute();
    void undo(); // Optional nhưng đây là một trong những lý do chính để dùng pattern này
    CommandType getType();
}

// Concrete command: Hủy lịch khám
public class CancelAppointmentCommand implements AppointmentCommand {
    
    // Lưu tất cả thông tin cần thiết để execute VÀ undo
    private final UUID appointmentId;
    private final String cancellationReason;
    private final UUID requestedByUserId;
    
    // Snapshot trạng thái trước khi execute — cần cho undo
    private AppointmentStatus previousStatus;
    private String previousSlotKey;
    
    // Dependencies
    private final AppointmentRepository appointmentRepository;
    private final SlotManager slotManager;
    private final NotificationService notificationService;
    
    @Override
    public void execute() {
        Appointment appointment = appointmentRepository.findById(appointmentId).orElseThrow();
        
        // Lưu snapshot để có thể undo
        this.previousStatus = appointment.getStatus();
        this.previousSlotKey = appointment.getSlotKey();
        
        // Thực thi từng bước
        appointment.cancel(cancellationReason);
        appointmentRepository.save(appointment);
        slotManager.releaseSlot(previousSlotKey);
        notificationService.sendCancellationNotification(appointment, requestedByUserId);
    }
    
    @Override
    public void undo() {
        if (previousStatus == null) {
            throw new IllegalStateException("Command has not been executed yet");
        }
        
        // Đảo ngược từng bước
        Appointment appointment = appointmentRepository.findById(appointmentId).orElseThrow();
        appointment.restore(previousStatus);
        appointmentRepository.save(appointment);
        slotManager.reoccupySlot(previousSlotKey, appointment.getDoctorId(), appointment.getPatientId());
        notificationService.sendCancellationReversedNotification(appointment);
    }
    
    @Override
    public CommandType getType() { return CommandType.CANCEL_APPOINTMENT; }
}
```

Command có thể được lưu vào database và thực thi sau:

```java
// Lưu command như một pending request
@Entity
public class PendingCommand {
    @Id private UUID id;
    private String commandType;
    private String commandPayload; // JSON serialized
    private CommandStatus status; // PENDING, APPROVED, REJECTED, EXECUTED, UNDONE
    private UUID requestedByUserId;
    private UUID approvedByAdminId;
    private LocalDateTime createdAt;
    private LocalDateTime executeAfter; // Chỉ execute sau khi admin approve
}

@Service
public class CommandOrchestrator {
    
    // Admin gửi request hủy lịch — không execute ngay
    public UUID submitCancelRequest(UUID appointmentId, String reason, UUID userId) {
        CancelAppointmentCommand command = commandFactory.createCancelCommand(appointmentId, reason, userId);
        
        PendingCommand pending = PendingCommand.builder()
            .commandType("CANCEL_APPOINTMENT")
            .commandPayload(objectMapper.writeValueAsString(command))
            .status(CommandStatus.PENDING)
            .requestedByUserId(userId)
            .build();
        
        return pendingCommandRepository.save(pending).getId();
    }
    
    // Admin approve — lúc này mới execute
    @Transactional
    public void approveAndExecute(UUID commandId, UUID adminId) {
        PendingCommand pending = pendingCommandRepository.findById(commandId).orElseThrow();
        
        AppointmentCommand command = commandFactory.deserialize(
            pending.getCommandType(), 
            pending.getCommandPayload()
        );
        
        command.execute();
        pending.markExecuted(adminId);
        pendingCommandRepository.save(pending);
    }
    
    // Undo trong vòng 1 giờ sau approve
    @Transactional
    public void undoCommand(UUID commandId, UUID adminId) {
        PendingCommand pending = pendingCommandRepository.findById(commandId).orElseThrow();
        
        if (pending.getExecutedAt().isBefore(LocalDateTime.now().minusHours(1))) {
            throw new UndoWindowExpiredException("Undo window has expired for command: " + commandId);
        }
        
        AppointmentCommand command = commandFactory.deserialize(
            pending.getCommandType(),
            pending.getCommandPayload()
        );
        
        command.undo();
        pending.markUndone(adminId);
        pendingCommandRepository.save(pending);
    }
}
```

---

## Khi nào Command thực sự cần thiết

Đừng dùng Command Pattern chỉ để "wrap một method call vào object." Đó là over-engineering.

Dùng khi bạn cần một hoặc nhiều trong số này:

- **Deferred execution**: hành động cần thực thi sau (queue, approval workflow)
- **Undo/Redo**: cần đảo ngược hành động đã làm
- **Audit trail đầy đủ**: không chỉ log kết quả mà log cả intent và context
- **Retry logic**: fail thì retry command object, không phải retry toàn bộ request
- **Transaction outbox**: lưu command vào DB để đảm bảo at-least-once execution

Nếu bạn chỉ cần gọi một method và nhận kết quả ngay — gọi method đó đi. Không cần Command.

---

## Takeaway

Trong HMS, bất kỳ hành động nào cần approval flow hoặc undo capability đều là ứng viên cho Command Pattern. Câu hỏi để tự kiểm tra: *"Hành động này có cần tồn tại như một entity trong database không?"* Nếu có — Command Pattern là công cụ đúng.

---

*Bài tiếp theo: Review không chỉ là đọc code — mà là hiểu change*
