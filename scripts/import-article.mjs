#!/usr/bin/env node
import { readFileSync, copyFileSync, existsSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const src = process.argv[2];

if (!src) {
  console.error('Usage: npm run import -- <path-to-article.md>');
  process.exit(1);
}

const srcPath = resolve(src);

if (!existsSync(srcPath)) {
  console.error(`Error: File not found — ${srcPath}`);
  process.exit(1);
}

if (extname(srcPath) !== '.md') {
  console.error('Error: File must be a .md file');
  process.exit(1);
}

// Basic frontmatter check
const content = readFileSync(srcPath, 'utf8');
const hasFrontmatter = content.startsWith('---');
if (!hasFrontmatter) {
  console.error('Error: File is missing frontmatter (must start with ---)');
  console.error('');
  console.error('Required frontmatter format:');
  console.error('---');
  console.error('title: "Article title"');
  console.error('description: "Short description"');
  console.error('category: system-design | architecture | programming');
  console.error('pubDate: YYYY-MM-DD');
  console.error('tags: ["tag1", "tag2"]  # optional');
  console.error('---');
  process.exit(1);
}

const requiredFields = ['title', 'description', 'category', 'pubDate'];
const missing = requiredFields.filter((f) => !content.includes(`${f}:`));
if (missing.length > 0) {
  console.error(`Error: Missing required frontmatter fields: ${missing.join(', ')}`);
  process.exit(1);
}

const validCategories = ['system-design', 'architecture', 'programming'];
const categoryMatch = content.match(/^category:\s*(.+)$/m);
const category = categoryMatch?.[1]?.trim().replace(/['"]/g, '');
if (category && !validCategories.includes(category)) {
  console.error(`Error: Invalid category "${category}"`);
  console.error(`Valid categories: ${validCategories.join(', ')}`);
  process.exit(1);
}

const filename = basename(srcPath);
const destDir = new URL('../src/content/articles/', import.meta.url);
const destPath = fileURLToPath(new URL(filename, destDir));

if (existsSync(destPath)) {
  console.warn(`Warning: ${filename} already exists and will be overwritten.`);
}

copyFileSync(srcPath, destPath);

console.log(`✓ Imported: src/content/articles/${filename}`);
console.log('  Run "npm run dev" to preview, or "npm run build" to build.');
