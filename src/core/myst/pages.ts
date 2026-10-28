// MyST Markdown pages: which files they are, and their titles.
import type { PageFormat } from '../format.js';

export const mystPages: PageFormat = {
  id: 'myst',
  name: 'MyST Markdown',
  extension: '.md',
  title: firstHeading,
  newPage: (title) => `# ${title}\n`,
};

export function firstHeading(text: string): string | null {
  let body = text;
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(body);
  if (fm) body = body.slice(fm[0].length);
  let inFence: string | null = null;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(`{3,}|~{3,}|:{3,})/.exec(line)?.[1];
    if (fence) {
      if (!inFence) inFence = fence[0];
      else if (fence[0] === inFence) inFence = null;
      continue;
    }
    if (inFence) continue;
    const atx = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    const setext = line.trim() && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1] ?? '') && !/^\s*[-*+]\s/.test(line);
    const raw = atx?.[1] ?? (setext ? line.trim() : null);
    if (raw) return plain(raw);
  }
  return null;
}

// Strip inline Markdown: roles, code, emphasis, links.
function plain(text: string): string {
  return text
    .replace(/\{[\w:.-]+\}`([^`]*)`/g, (_m, v: string) => v.replace(/\s*<[^>]*>$/, ''))
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')
    .trim();
}
