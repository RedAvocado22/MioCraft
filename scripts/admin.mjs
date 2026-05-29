#!/usr/bin/env node
import { createServer } from 'http';
import { writeFileSync, existsSync, readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { basename, extname } from 'path';

const ARTICLES_DIR = fileURLToPath(new URL('../src/content/articles/', import.meta.url));
const PORT = 4323;

const VALID_CATEGORIES = ['system-design', 'architecture', 'programming'];
const REQUIRED_FIELDS = ['title', 'description', 'category', 'pubDate'];

function validateFrontmatter(content) {
  if (!content.startsWith('---')) return { ok: false, error: 'Thiếu frontmatter (phải bắt đầu bằng ---)' };
  const missing = REQUIRED_FIELDS.filter(f => !content.includes(`${f}:`));
  if (missing.length) return { ok: false, error: `Thiếu trường: ${missing.join(', ')}` };
  const catMatch = content.match(/^category:\s*(.+)$/m);
  const cat = catMatch?.[1]?.trim().replace(/['"]/g, '');
  if (cat && !VALID_CATEGORIES.includes(cat)) {
    return { ok: false, error: `Category không hợp lệ: "${cat}". Dùng: ${VALID_CATEGORIES.join(', ')}` };
  }
  return { ok: true };
}

function listArticles() {
  return readdirSync(ARTICLES_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = readFileSync(`${ARTICLES_DIR}/${f}`, 'utf8');
      const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      const catMatch = content.match(/^category:\s*(.+)$/m);
      return {
        filename: f,
        title: titleMatch?.[1] ?? f,
        category: catMatch?.[1]?.trim().replace(/['"]/g, '') ?? '',
      };
    });
}

const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TechCraft Admin</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#0d0d14;--surface:#13131e;--surface2:#1a1a28;
    --border:rgba(255,255,255,0.07);--text:#e8eaf0;--muted:#6b7280;
    --accent:#8b5cf6;--accent2:#a78bfa;--green:#34d399;--red:#f87171;
  }
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;min-height:100vh;-webkit-font-smoothing:antialiased}
  header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;gap:0.75rem}
  .logo{font-size:1rem;font-weight:800;background:linear-gradient(135deg,#a78bfa,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .logo-sub{color:var(--muted);font-size:0.8rem}
  main{max-width:680px;margin:0 auto;padding:2.5rem 1.5rem}
  h2{font-size:1rem;font-weight:600;color:var(--text);margin-bottom:1.25rem}

  /* Drop zone */
  .drop-zone{
    border:2px dashed rgba(139,92,246,0.3);border-radius:12px;
    padding:2.5rem 1.5rem;text-align:center;cursor:pointer;
    transition:border-color 0.2s,background 0.2s;background:rgba(139,92,246,0.03);
    margin-bottom:1.5rem;
  }
  .drop-zone:hover,.drop-zone.drag-over{border-color:var(--accent);background:rgba(139,92,246,0.07)}
  .drop-icon{font-size:2rem;margin-bottom:0.5rem}
  .drop-label{color:var(--muted);font-size:0.9rem}
  .drop-label strong{color:var(--accent2)}
  #file-input{display:none}

  /* File preview */
  .preview{display:none;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.25rem 1.5rem;margin-bottom:1.25rem}
  .preview.show{display:block}
  .preview-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
  .preview-filename{font-size:0.85rem;font-family:monospace;color:var(--accent2);background:rgba(139,92,246,0.1);padding:0.2rem 0.6rem;border-radius:4px}
  .preview-fields{display:grid;gap:0.5rem}
  .field-row{display:flex;gap:0.75rem;font-size:0.85rem}
  .field-key{color:var(--muted);width:90px;flex-shrink:0}
  .field-val{color:var(--text)}

  /* Validation */
  .validation{padding:0.75rem 1rem;border-radius:8px;font-size:0.875rem;margin-bottom:1rem;display:none}
  .validation.show{display:block}
  .validation.ok{background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.2);color:var(--green)}
  .validation.err{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);color:var(--red)}

  /* Button */
  .btn{
    display:inline-flex;align-items:center;gap:0.5rem;
    padding:0.6rem 1.25rem;border-radius:8px;border:none;cursor:pointer;
    font-size:0.875rem;font-weight:600;transition:opacity 0.15s;
  }
  .btn:disabled{opacity:0.4;cursor:not-allowed}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-primary:hover:not(:disabled){opacity:0.88}
  .btn-ghost{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
  .btn-ghost:hover{background:rgba(255,255,255,0.06)}
  .btn-row{display:flex;gap:0.75rem;align-items:center}

  /* Alert */
  .alert{padding:0.75rem 1rem;border-radius:8px;font-size:0.875rem;margin-top:1rem;display:none}
  .alert.show{display:block}
  .alert.success{background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.2);color:var(--green)}
  .alert.error{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);color:var(--red)}

  /* Articles list */
  .divider{border:none;height:1px;background:var(--border);margin:2rem 0}
  .article-list{display:flex;flex-direction:column;gap:0.5rem}
  .article-item{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.75rem 1rem;font-size:0.875rem}
  .article-info{display:flex;flex-direction:column;gap:0.2rem}
  .article-title{color:var(--text);font-weight:500}
  .article-meta{color:var(--muted);font-size:0.78rem;font-family:monospace}
  .badge{font-size:0.68rem;font-weight:600;padding:0.18rem 0.55rem;border-radius:999px;text-transform:uppercase;letter-spacing:0.04em}
  .badge-sd{background:rgba(96,165,250,0.12);color:#60a5fa}
  .badge-arch{background:rgba(52,211,153,0.12);color:#34d399}
  .badge-prog{background:rgba(251,191,36,0.12);color:#fbbf24}
  .empty{color:var(--muted);font-size:0.875rem;text-align:center;padding:1.5rem}
</style>
</head>
<body>
<header>
  <span class="logo">TechCraft</span>
  <span class="logo-sub">/ Admin</span>
</header>
<main>
  <h2>Thêm bài viết mới</h2>

  <div class="drop-zone" id="drop-zone" onclick="document.getElementById('file-input').click()">
    <div class="drop-icon">📄</div>
    <p class="drop-label">Kéo thả file <strong>.md</strong> vào đây hoặc <strong>nhấn để chọn</strong></p>
  </div>
  <input type="file" id="file-input" accept=".md" />

  <div class="validation" id="validation"></div>

  <div class="preview" id="preview">
    <div class="preview-header">
      <span class="preview-filename" id="preview-filename"></span>
    </div>
    <div class="preview-fields" id="preview-fields"></div>
  </div>

  <div class="btn-row">
    <button class="btn btn-primary" id="upload-btn" disabled onclick="uploadFile()">
      Lưu bài viết
    </button>
    <button class="btn btn-ghost" id="clear-btn" style="display:none" onclick="clearFile()">
      Xoá
    </button>
  </div>

  <div class="alert" id="alert"></div>

  <hr class="divider" />

  <h2>Bài viết hiện có</h2>
  <div class="article-list" id="article-list">
    <p class="empty">Đang tải...</p>
  </div>
</main>

<script>
let selectedFile = null;
let fileContent = null;

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const preview = document.getElementById('preview');
const validation = document.getElementById('validation');
const uploadBtn = document.getElementById('upload-btn');
const clearBtn = document.getElementById('clear-btn');
const alert = document.getElementById('alert');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  if (!file.name.endsWith('.md')) {
    showValidation('Chỉ chấp nhận file .md', false);
    return;
  }
  selectedFile = file;
  fileContent = await file.text();

  document.getElementById('preview-filename').textContent = file.name;

  const fields = {};
  const fm = fileContent.match(/^---\\n([\\s\\S]*?)\\n---/);
  if (fm) {
    fm[1].split('\\n').forEach(line => {
      const m = line.match(/^(\\w+):\\s*(.+)$/);
      if (m) fields[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  }

  const labels = { title: 'Tiêu đề', description: 'Mô tả', category: 'Chuyên mục', pubDate: 'Ngày đăng', tags: 'Tags' };
  const html = Object.entries(fields).map(([k, v]) =>
    \`<div class="field-row"><span class="field-key">\${labels[k] ?? k}</span><span class="field-val">\${v}</span></div>\`
  ).join('');
  document.getElementById('preview-fields').innerHTML = html || '<p style="color:var(--muted);font-size:0.85rem">Không đọc được frontmatter</p>';

  preview.classList.add('show');
  clearBtn.style.display = 'inline-flex';

  // Validate
  const res = await fetch('/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: fileContent })
  }).then(r => r.json());

  showValidation(res.error ?? '✓ Frontmatter hợp lệ', res.ok);
  uploadBtn.disabled = !res.ok;
}

function showValidation(msg, ok) {
  validation.textContent = msg;
  validation.className = 'validation show ' + (ok ? 'ok' : 'err');
}

function clearFile() {
  selectedFile = null;
  fileContent = null;
  fileInput.value = '';
  preview.classList.remove('show');
  validation.classList.remove('show');
  clearBtn.style.display = 'none';
  uploadBtn.disabled = true;
  alert.classList.remove('show');
}

async function uploadFile() {
  if (!selectedFile || !fileContent) return;
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Đang lưu...';

  const res = await fetch('/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: selectedFile.name, content: fileContent })
  }).then(r => r.json());

  if (res.ok) {
    alert.textContent = '✓ Đã lưu ' + selectedFile.name + ' vào src/content/articles/';
    alert.className = 'alert show success';
    clearFile();
    loadArticles();
  } else {
    alert.textContent = '✗ Lỗi: ' + res.error;
    alert.className = 'alert show error';
    uploadBtn.disabled = false;
  }
  uploadBtn.textContent = 'Lưu bài viết';
}

async function loadArticles() {
  const articles = await fetch('/articles').then(r => r.json());
  const list = document.getElementById('article-list');
  if (!articles.length) {
    list.innerHTML = '<p class="empty">Chưa có bài viết nào.</p>';
    return;
  }
  const badgeClass = { 'system-design': 'badge-sd', 'architecture': 'badge-arch', 'programming': 'badge-prog' };
  const catLabel = { 'system-design': 'System Design', 'architecture': 'Kiến trúc', 'programming': 'Lập trình' };
  list.innerHTML = articles.map(a => \`
    <div class="article-item">
      <div class="article-info">
        <span class="article-title">\${a.title}</span>
        <span class="article-meta">\${a.filename}</span>
      </div>
      <span class="badge \${badgeClass[a.category] ?? ''}">\${catLabel[a.category] ?? a.category}</span>
    </div>
  \`).join('');
}

loadArticles();
</script>
</body>
</html>`;

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && req.url === '/articles') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listArticles()));
    return;
  }

  if (req.method === 'POST' && (req.url === '/upload' || req.url === '/validate')) {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const { filename, content } = JSON.parse(body);
        const validation = validateFrontmatter(content);

        if (req.url === '/validate') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(validation));
          return;
        }

        if (!validation.ok) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(validation));
          return;
        }

        if (!filename.endsWith('.md') || filename.includes('/') || filename.includes('..')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Tên file không hợp lệ' }));
          return;
        }

        const dest = `${ARTICLES_DIR}/${basename(filename)}`;
        writeFileSync(dest, content, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  TechCraft Admin  →  http://localhost:${PORT}\n`);
});
