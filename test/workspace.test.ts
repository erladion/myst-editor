// The workspace's advanced (text) mode, with a fake file API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineEnding, Workspace } from '../src/renderer/src/workspace.js';
import type { MystApi, ProjectInfo } from '../src/shared/api.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';

function fakeApi(files: Record<string, string>) {
  const writes: [string, string][] = [];
  const api = {
    readFile: async (p: string) => files[p],
    writeFile: async (p: string, text: string) => {
      writes.push([p, text]);
      files[p] = text;
    },
    setUnsaved: () => {},
  } as unknown as MystApi;
  return { api, writes };
}

const project: ProjectInfo = { root: '/x', name: 'x', projects: [], defaultConfig: DEFAULT_CONFIG, files: ['a.md'], titles: {}, buildInputs: '' };

describe('Workspace text mode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves typed Markdown exactly, and reads it back into formatted editing', async () => {
    // Odd spacing a formatted edit would normalise is kept exactly when typed.
    const { api, writes } = fakeApi({ 'a.md': '# Title\n\nText\n' });
    const ws = new Workspace(api, project);
    await ws.open('a.md');
    ws.enterTextMode('a.md');
    expect(ws.get('a.md')!.text).toBe('# Title\n\nText\n');

    ws.setText('a.md', '# Title\n\n*  odd   list\n\n\n\nText\n');
    expect(ws.get('a.md')!.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(writes).toEqual([['a.md', '# Title\n\n*  odd   list\n\n\n\nText\n']]);
    expect(ws.get('a.md')!.status.kind).toBe('saved');

    ws.leaveTextMode('a.md');
    const s = ws.get('a.md')!;
    expect(s.text).toBeNull();
    expect(s.state.doc.child(1).type.name).toBe('bullet_list');
    // Nothing changed since: saving writes nothing more.
    expect(await ws.save('a.md')).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('starts text mode from unsaved formatted edits', async () => {
    const { api } = fakeApi({ 'a.md': 'Hello\n' });
    const ws = new Workspace(api, project);
    const s = await ws.open('a.md');
    ws.update('a.md', s.state.apply(s.state.tr.insertText('Oh, ', 1)), true);
    ws.enterTextMode('a.md');
    expect(ws.get('a.md')!.text).toBe('Oh, Hello\n');
  });

  it('typing back the saved text makes the page clean again', async () => {
    const { api } = fakeApi({ 'a.md': 'Hello\n' });
    const ws = new Workspace(api, project);
    await ws.open('a.md');
    ws.enterTextMode('a.md');
    ws.setText('a.md', 'Hello!\n');
    ws.setText('a.md', 'Hello\n');
    expect(ws.get('a.md')!.dirty).toBe(false);
  });
});

describe('Workspace line endings', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const page = '# Title\r\n\r\nFirst paragraph.\r\n\r\n- one\r\n- two\r\n';

  it('keeps a CRLF page CRLF when editing formatted', async () => {
    const { api, writes } = fakeApi({ 'a.md': page });
    const ws = new Workspace(api, project);
    const s = await ws.open('a.md');
    expect(await ws.save('a.md', { force: true })).toBe(true);
    expect(writes).toEqual([]); // unchanged: nothing written
    const end = s.state.doc.child(1).nodeSize + s.state.doc.child(0).nodeSize - 1;
    ws.update('a.md', s.state.apply(s.state.tr.insertText(' More.', end)), true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(writes).toEqual([['a.md', page.replace('First paragraph.', 'First paragraph. More.')]]);
  });

  it('keeps a CRLF page CRLF in the Markdown view', async () => {
    const { api, writes } = fakeApi({ 'a.md': page });
    const ws = new Workspace(api, project);
    await ws.open('a.md');
    ws.enterTextMode('a.md');
    expect(ws.get('a.md')!.text).toBe(page.replace(/\r\n/g, '\n'));
    ws.setText('a.md', ws.get('a.md')!.text!); // as the editor hands it back
    expect(ws.get('a.md')!.dirty).toBe(false);
    ws.setText('a.md', '# Title\n\nChanged.\n');
    await vi.advanceTimersByTimeAsync(1500);
    expect(writes).toEqual([['a.md', '# Title\r\n\r\nChanged.\r\n']]);
    ws.leaveTextMode('a.md');
    expect(await ws.save('a.md', { force: true })).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('tells CRLF files from LF ones', () => {
    expect(lineEnding('a\r\nb\r\n')).toBe('\r\n');
    expect(lineEnding('a\nb\n')).toBe('\n');
    expect(lineEnding('a\r\nb\nc\nd\n')).toBe('\n');
  });
});
