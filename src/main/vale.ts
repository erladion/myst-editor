// Runs Vale on saved pages, if it's installed: on the PATH (or a usual install
// location), with a .vale.ini that applies (Vale looks from the page's folder up, and
// in its global config).
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, promises as fs, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { ValeAlert, ValeResult } from '../shared/vale.js';

const TIMEOUT_MS = 30_000;
// Corrections for spelling and the like come from `vale fix`, one run per alert.
const MAX_FIXES = 40;
const FIX_CONCURRENCY = 4;

function executable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Apps started from a desktop launcher don't always get the shell's PATH.
const USUAL_PLACES = [join(homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', '/snap/bin', join(homedir(), 'go', 'bin')];

export function findVale(): string | null {
  // MYSTEDITOR_VALE: a Vale to use instead (the tests use a script).
  if (process.env.MYSTEDITOR_VALE) return process.env.MYSTEDITOR_VALE;
  const name = process.platform === 'win32' ? 'vale.exe' : 'vale';
  for (const dir of [...(process.env.PATH ?? '').split(delimiter), ...USUAL_PLACES]) {
    if (dir && executable(join(dir, name))) return join(dir, name);
  }
  return null;
}

function run(vale: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  // A .js Vale is a stand-in run with Electron's own Node.
  const script = /\.[cm]?js$/.test(vale);
  const [file, argv] = script ? [process.execPath, [vale, ...args]] : [vale, args];
  const env = script ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
  return new Promise((resolve) => {
    execFile(file, argv, { cwd, env, timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : -1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

type Raw = Omit<ValeAlert, 'Suggestions'>;

// Replacements Vale offers for an alert: a rule's own, or what `vale fix` works out.
async function corrections(vale: string, cwd: string, alert: Raw): Promise<string[]> {
  const { Name, Params } = alert.Action ?? { Name: '', Params: null };
  if (Name === 'replace') return Params ?? [];
  if (Name === 'remove') return [''];
  if (Name !== 'suggest' && Name !== 'edit') return [];
  const { code, stdout } = await run(vale, ['fix', JSON.stringify(alert)], cwd);
  if (code !== 0) return [];
  try {
    const { suggestions } = JSON.parse(stdout) as { suggestions?: string[] };
    return (suggestions ?? []).slice(0, 8);
  } catch {
    return [];
  }
}

export async function lint(file: string): Promise<ValeResult> {
  const vale = findVale();
  if (!vale) return { status: 'unavailable', reason: 'not-installed', message: 'Vale isn’t installed.' };
  const cwd = dirname(file);
  const { code, stdout, stderr } = await run(vale, ['--output=JSON', '--no-exit', file], cwd);
  if (code !== 0) {
    // Runtime errors are JSON too: {"Code": "E100", "Text": "..."}.
    let error: { Code?: string; Text?: string } = {};
    try {
      error = JSON.parse(stderr || stdout);
    } catch {
      // not JSON
    }
    if (error.Code === 'E100') return { status: 'unavailable', reason: 'no-config', message: 'No Vale configuration (.vale.ini) applies to this page.' };
    return { status: 'unavailable', reason: 'failed', message: (error.Text ?? (stderr || stdout)).trim() || `Vale stopped (exit code ${code}).` };
  }
  let found: Record<string, Raw[]>;
  try {
    found = JSON.parse(stdout || '{}');
  } catch {
    return { status: 'unavailable', reason: 'failed', message: 'Vale’s output couldn’t be read.' };
  }
  const raw = Object.values(found)[0] ?? [];
  const alerts: ValeAlert[] = raw.map((a) => ({ ...a, Suggestions: [] }));
  // Corrections, a few at a time; past MAX_FIXES only the rules' own.
  let next = 0;
  const work = async () => {
    while (next < alerts.length) {
      const i = next++;
      const a = alerts[i];
      a.Suggestions = i < MAX_FIXES || a.Action?.Name === 'replace' ? await corrections(vale, cwd, raw[i]) : [];
    }
  };
  await Promise.all(Array.from({ length: FIX_CONCURRENCY }, work));
  return { status: 'ok', alerts };
}

// Accepting a word: into the vocabulary of the Vale configuration that applies (its
// accept.txt, which every rule respects), so Vale accepts it everywhere, not only here.
// Without a vocabulary, the configuration gets one: `Vocab = Project`.
const NEW_VOCAB = 'Project';

interface ValeConfig {
  Vocab?: string[] | null;
  RootINI?: string;
  Paths?: string[] | null; // styles folders: Vale's default, then the configuration's own
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `Vocab = name` in the configuration's general part (before its first [section]).
async function addVocab(ini: string, name: string) {
  const text = await fs.readFile(ini, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*\[/.test(l));
  lines.splice(at < 0 ? lines.length : at, 0, `Vocab = ${name}`);
  await fs.writeFile(ini, lines.join(eol));
}

export async function accept(file: string, word: string): Promise<{ ok: true; file: string; addedVocab: boolean } | { ok: false; message: string }> {
  const vale = findVale();
  if (!vale) return { ok: false, message: 'Vale isn’t installed.' };
  const cwd = dirname(file);
  const { code, stdout } = await run(vale, ['ls-config'], cwd);
  let config: ValeConfig = {};
  try {
    if (code === 0) config = JSON.parse(stdout);
  } catch {
    // unreadable
  }
  if (!config.RootINI) return { ok: false, message: 'No Vale configuration (.vale.ini) applies to this page.' };
  const paths = config.Paths ?? [];
  let vocab = config.Vocab?.[0];
  let addedVocab = false;
  if (!vocab) {
    vocab = NEW_VOCAB;
    await addVocab(config.RootINI, vocab);
    addedVocab = true;
  }
  // The vocabulary's word list where it exists already, else in the configuration's
  // own styles folder (listed last).
  const lists = [...paths].reverse().map((p) => join(p, 'config', 'vocabularies', vocab!, 'accept.txt'));
  const target = lists.find((l) => existsSync(l)) ?? lists[0];
  if (!target) return { ok: false, message: 'Vale has no styles folder to keep the word in.' };
  await fs.mkdir(dirname(target), { recursive: true });
  let text = '';
  try {
    text = await fs.readFile(target, 'utf8');
  } catch {
    // a new list
  }
  // Entries are regular expressions; the word is taken literally, as written.
  const entry = escapeRegex(word.trim());
  if (!text.split(/\r?\n/).includes(entry)) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    await fs.writeFile(target, `${text}${text && !text.endsWith('\n') ? eol : ''}${entry}${eol}`);
  }
  return { ok: true, file: target, addedVocab };
}
