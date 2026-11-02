// Rewrites the selector tables in docs-site/.../reference/styling.md from src/lib/overlay/selectors.ts.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cw-selectors-'));
const src = readFileSync('src/lib/overlay/selectors.ts', 'utf8').replace(
  /import type \{ LayerKind \} from '\$lib\/bindings\/LayerKind';/,
  'type LayerKind = { type: string };'
);
writeFileSync(join(dir, 'selectors.ts'), src);
writeFileSync(join(dir, 'run.ts'), "import { selectorsMarkdown } from './selectors.ts';\nprocess.stdout.write(selectorsMarkdown());\n");
const md = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(dir, 'run.ts')], { encoding: 'utf8' });
const tables = md.split('\n').slice(4).join('\n');
const page = 'docs-site/src/content/docs/reference/styling.md';
const current = readFileSync(page, 'utf8');
const at = current.indexOf('\n## ');
writeFileSync(page, current.slice(0, at + 1) + tables.trimStart());
console.log('Updated', page);
