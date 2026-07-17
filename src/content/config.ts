import { defineCollection, z } from 'astro:content';

const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['system-design', 'architecture', 'programming']),
    pubDate: z.coerce.date(),
    addedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).optional(),
    series: z.string().optional(),
  }),
});

export const collections = { articles };
