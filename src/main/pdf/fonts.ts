// Fonts for the PDF, for Project Settings to show: what font files in the project are
// (family, weight, style, from their own tables, as mysteditor_pdf.py reads them), and
// the fonts installed on this computer.
import { execFile } from 'node:child_process';
import { basename, extname } from 'node:path';
import { inflateSync } from 'node:zlib';

export interface FontInfo {
  family: string;
  weight: string; // "700", or "100 900" for a variable font
  style: 'normal' | 'italic';
}

// The font's tables by tag: TrueType and OpenType files (the first font of a
// collection) and WOFF; null for what can't be read this way (WOFF2).
function tables(buf: Buffer): Map<string, Buffer> | null {
  const out = new Map<string, Buffer>();
  const sig = buf.toString('latin1', 0, 4);
  if (sig === 'wOFF') {
    for (let i = 0, n = buf.readUInt16BE(12); i < n; i++) {
      const o = 44 + i * 20;
      const [offset, length, original] = [buf.readUInt32BE(o + 4), buf.readUInt32BE(o + 8), buf.readUInt32BE(o + 12)];
      const data = buf.subarray(offset, offset + length);
      out.set(buf.toString('latin1', o, o + 4), length < original ? inflateSync(data) : data);
    }
    return out;
  }
  const base = sig === 'ttcf' ? buf.readUInt32BE(12) : 0;
  if (!['\0\x01\0\0', 'OTTO', 'true'].includes(buf.toString('latin1', base, base + 4))) return null;
  for (let i = 0, n = buf.readUInt16BE(base + 4); i < n; i++) {
    const o = base + 12 + i * 16;
    const offset = buf.readUInt32BE(o + 8);
    out.set(buf.toString('latin1', o, o + 4), buf.subarray(offset, offset + buf.readUInt32BE(o + 12)));
  }
  return out;
}

// A name from the name table: the first of `ids` there is, in English if it has it.
function nameOf(name: Buffer, ids: number[]): string | null {
  const found = new Map<number, { text: string; english: boolean }>();
  const strings = name.readUInt16BE(4);
  for (let i = 0, n = name.readUInt16BE(2); i < n; i++) {
    const o = 6 + i * 12;
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((k) => name.readUInt16BE(o + k));
    const bytes = Buffer.from(name.subarray(strings + offset, strings + offset + length));
    let text: string;
    if (platform === 0 || platform === 3) text = bytes.swap16().toString('utf16le');
    else if (platform === 1 && encoding === 0) text = bytes.toString('latin1');
    else continue;
    const english = platform === 1 || language === 0x409;
    if (text.trim() && (!found.has(id) || (english && !found.get(id)!.english))) found.set(id, { text: text.trim(), english });
  }
  for (const id of ids) if (found.has(id)) return found.get(id)!.text;
  return null;
}

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra-?light|ultra-?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi-?bold|demi-?bold/i, 600],
  [/extra-?bold|ultra-?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
];

// From the file's name, for fonts whose tables can't be read: "Brand-BoldItalic.woff2".
function fromFileName(file: string): FontInfo {
  const stem = basename(file, extname(file));
  const [family, styles = ''] = stem.split(/[-_ ](?=[^-_ ]*$)/);
  return {
    family: styles ? family : stem,
    weight: String(WEIGHTS.find(([re]) => re.test(styles))?.[1] ?? 400),
    style: /italic|oblique/i.test(styles) ? 'italic' : 'normal',
  };
}

export function fontInfo(buf: Buffer, file: string): FontInfo {
  const guess = fromFileName(file);
  let t: Map<string, Buffer> | null = null;
  try {
    t = tables(buf);
  } catch {
    // a damaged file: its name will do
  }
  if (!t) return guess;
  const name = t.get('name');
  const os2 = t.get('OS/2');
  let weight = os2 && os2.length >= 6 ? String(os2.readUInt16BE(4)) : guess.weight;
  // A variable font: its range of weights.
  const fvar = t.get('fvar');
  if (fvar && fvar.length >= 16) {
    const [axes, count, size] = [fvar.readUInt16BE(4), fvar.readUInt16BE(8), fvar.readUInt16BE(10)];
    for (let i = 0; i < count; i++) {
      const o = axes + i * size;
      if (fvar.toString('latin1', o, o + 4) === 'wght') weight = `${Math.round(fvar.readInt32BE(o + 4) / 65536)} ${Math.round(fvar.readInt32BE(o + 12) / 65536)}`;
    }
  }
  const italic = os2 && os2.length >= 64 ? (os2.readUInt16BE(62) & 1) === 1 : guess.style === 'italic';
  return { family: (name && nameOf(name, [16, 1])) || guess.family, weight, style: italic ? 'italic' : 'normal' };
}

// The font families installed here (fontconfig on Linux, Windows' own list), sorted.
let installed: Promise<string[]> | null = null;
export function installedFonts(): Promise<string[]> {
  installed ??= new Promise((resolve) => {
    const done = (out: string) => resolve([...new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
    if (process.platform === 'win32') {
      execFile('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'], { windowsHide: true, timeout: 20_000 }, (e, out) => done(e ? '' : out));
    } else {
      execFile('fc-list', ['--format', '%{family[0]}\\n'], { timeout: 20_000 }, (e, out) => done(e ? '' : out));
    }
  });
  return installed;
}
