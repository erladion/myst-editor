// The workspace's advanced (text) mode, with a fake file API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workspace } from '../src/renderer/src/workspace.js';
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

const project: ProjectInfo = { root: '/x', name: 'x', projects: [], defaultConfig: DEFAULT_CONFIG, files: ['a.md'], titles: {} };

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
