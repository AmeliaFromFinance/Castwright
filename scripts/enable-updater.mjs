// Turns on update files (signed installers for latest.json) in tauri.conf.json.
// The release workflow runs this only when TAURI_SIGNING_PRIVATE_KEY is set,
// because Tauri stops the build if it has to sign without a key.
// Usage: node scripts/enable-updater.mjs [src-tauri/tauri.conf.json]
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'src-tauri/tauri.conf.json';
const conf = JSON.parse(readFileSync(file, 'utf8'));
conf.bundle = { ...conf.bundle, createUpdaterArtifacts: true };
writeFileSync(file, `${JSON.stringify(conf, null, 2)}\n`);
console.log(`Update files on in ${file}`);
