// Download the uv binary bundled with the app into resources/uv/, verifying it
// against a checksum recorded here (not one fetched alongside the download).
//   node scripts/fetch-uv.mjs [--platform linux|win32]   (default: this system)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '0.12.24';
const BUILDS = {
  linux: {
    target: 'x86_64-unknown-linux-gnu',
    archive: 'tar.gz',
    sha256: 'b4dfaef47d491a7296981f8374a4595f55dbf84e8937c8ecd2983574d8bb3da6',
    exe: 'uv',
    inside: (target) => join(`uv-${target}`, 'uv'),
  },
  win32: {
    target: 'x86_64-pc-windows-msvc',
    archive: 'zip',
    sha256: '7c38608c8a18ee137d748a1773053b07ec8f3a30fab49aebaa6f4e4efeceb019',
    exe: 'uv.exe',
    inside: () => 'uv.exe',
  },
};

const flag = process.argv.indexOf('--platform');
const platform = flag >= 0 ? process.argv[flag + 1] : process.platform;
const build = BUILDS[platform];
if (!build) throw new Error(`No uv build for ${platform}; expected one of ${Object.keys(BUILDS).join(', ')}`);

const dir = join(import.meta.dirname, '..', 'resources', 'uv');
const stamp = join(dir, 'VERSION');
if (existsSync(join(dir, build.exe)) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${VERSION} ${build.target}`) {
  console.log(`uv ${VERSION} already present`);
  process.exit(0);
}

const url = `https://github.com/astral-sh/uv/releases/download/${VERSION}/uv-${build.target}.${build.archive}`;
console.log(`Downloading ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
const archive = Buffer.from(await response.arrayBuffer());
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== build.sha256) throw new Error(`Checksum mismatch for ${url}: expected ${build.sha256}, got ${actual}`);

const work = mkdtempSync(join(tmpdir(), 'mysteditor-uv-'));
try {
  const file = join(work, `uv.${build.archive}`);
  writeFileSync(file, archive);
  // tar reads zip files too on Windows (bsdtar); GNU tar on Linux doesn't, so unzip.
  if (build.archive === 'zip' && process.platform !== 'win32') execFileSync('unzip', ['-q', '-o', file, '-d', work]);
  else execFileSync('tar', ['-xf', file, '-C', work]);
  // One platform's uv at a time: resources/uv/ is bundled as it is.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Copy rather than rename: the temp dir may be on another filesystem.
  copyFileSync(join(work, build.inside(build.target)), join(dir, build.exe));
  chmodSync(join(dir, build.exe), 0o755);
  writeFileSync(stamp, `${VERSION} ${build.target}\n`);
  console.log(`uv ${VERSION} saved to ${join(dir, build.exe)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
