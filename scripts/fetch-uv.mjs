// Download the uv binary bundled with the app into resources/uv/, verifying it
// against a checksum recorded here (not one fetched alongside the download).
//   node scripts/fetch-uv.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '0.12.24';
const TARGET = 'x86_64-unknown-linux-gnu';
const SHA256 = 'b4dfaef47d491a7296981f8374a4595f55dbf84e8937c8ecd2983574d8bb3da6';

const dir = join(import.meta.dirname, '..', 'resources', 'uv');
const stamp = join(dir, 'VERSION');
if (existsSync(join(dir, 'uv')) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${VERSION} ${TARGET}`) {
  console.log(`uv ${VERSION} already present`);
  process.exit(0);
}

const url = `https://github.com/astral-sh/uv/releases/download/${VERSION}/uv-${TARGET}.tar.gz`;
console.log(`Downloading ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
const archive = Buffer.from(await response.arrayBuffer());
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== SHA256) throw new Error(`Checksum mismatch for ${url}: expected ${SHA256}, got ${actual}`);

const work = mkdtempSync(join(tmpdir(), 'mysteditor-uv-'));
try {
  writeFileSync(join(work, 'uv.tar.gz'), archive);
  execFileSync('tar', ['-xzf', join(work, 'uv.tar.gz'), '-C', work]);
  mkdirSync(dir, { recursive: true });
  // Copy rather than rename: the temp dir may be on another filesystem.
  copyFileSync(join(work, `uv-${TARGET}`, 'uv'), join(dir, 'uv'));
  chmodSync(join(dir, 'uv'), 0o755);
  writeFileSync(stamp, `${VERSION} ${TARGET}\n`);
  console.log(`uv ${VERSION} saved to ${join(dir, 'uv')}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
