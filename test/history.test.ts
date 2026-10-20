import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Snapshots } from '../src/main/history.js';

describe('Snapshots', () => {
  it('keeps a version at most every ten minutes, newest first, unless forced', async () => {
    let now = 1_000_000_000_000;
    const s = new Snapshots(mkdtempSync(join(tmpdir(), 'mysteditor-history-')), () => now);
    expect(await s.keep('/docs', 'a.md', 'one')).toBe(true);
    now += 60_000;
    expect(await s.keep('/docs', 'a.md', 'two')).toBe(false); // too soon
    expect(await s.keep('/docs', 'a.md', 'two', { force: true })).toBe(true);
    now += 11 * 60_000;
    expect(await s.keep('/docs', 'a.md', 'two')).toBe(false); // same as the last one
    expect(await s.keep('/docs', 'a.md', 'three')).toBe(true);
    const list = await s.list('/docs', 'a.md');
    expect(await Promise.all(list.map((v) => s.read('/docs', 'a.md', v.id)))).toEqual(['three', 'two', 'one']);
    expect(await s.list('/docs', 'b.md')).toEqual([]);
    expect(await s.read('/docs', 'a.md', '../../etc/passwd')).toBeNull();
  });

  it('keeps the newest 50, and nothing older than 30 days', async () => {
    let now = 1_000_000_000_000;
    const s = new Snapshots(mkdtempSync(join(tmpdir(), 'mysteditor-history-')), () => now);
    for (let i = 0; i < 55; i++) {
      await s.keep('/docs', 'a.md', `v${i}`);
      now += 11 * 60_000;
    }
    expect(await s.list('/docs', 'a.md')).toHaveLength(50);
    now += 31 * 24 * 3600_000;
    await s.keep('/docs', 'a.md', 'fresh');
    expect((await s.list('/docs', 'a.md')).map((v) => v.id)).toEqual([String(now)]);
  });
});
