// Prints one version's notes from CHANGELOG.md, without its heading.
// Usage: node scripts/changelog-section.mjs v0.6.0 [CHANGELOG.md]
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '').split('-')[0];
const file = process.argv[3] ?? 'CHANGELOG.md';
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Give a version like v0.6.0');
  process.exit(2);
}

const lines = readFileSync(file, 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replaceAll('.', '\\.')}(\\s|$)`).test(l));
if (start < 0) {
  console.error(`${file} has no section for ${version}`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) {
  console.error(`The ${version} section in ${file} is empty`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
