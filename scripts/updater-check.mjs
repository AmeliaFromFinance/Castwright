// Checks a release's latest.json: right version, a signature and link for every
// platform. Prints GitHub notices and exits 0 either way, so a release is never blocked.
// Usage: node scripts/updater-check.mjs v0.8.0 latest.json
import { readFileSync } from 'node:fs';

export const PLATFORMS = ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64'];

/** Problems with a parsed latest.json, as plain sentences. Empty when it's fine. */
export function problems(json, tag) {
  const out = [];
  const version = String(tag).replace(/^v/, '');
  if (String(json?.version ?? '').replace(/^v/, '') !== version) out.push(`latest.json says version ${json?.version}, not ${version}.`);
  const platforms = json?.platforms ?? {};
  for (const p of PLATFORMS) {
    const entry = platforms[p];
    if (!entry) out.push(`${p} is missing, so those copies won't update themselves.`);
    else if (!entry.signature || !/^https:\/\//.test(entry.url ?? '')) out.push(`${p} has no signature or link.`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [tag, file = 'latest.json'] = process.argv.slice(2);
  let json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`::warning title=Auto-update::Couldn't read ${file}: ${e.message}`);
    process.exit(0);
  }
  const found = problems(json, tag);
  for (const p of found) console.log(`::warning title=Auto-update::${p}`);
  if (!found.length) console.log(`latest.json is fine: ${Object.keys(json.platforms).sort().join(', ')}`);
}
