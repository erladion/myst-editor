// The app's earlier name keeps working: its settings folder is moved to the app's,
// and its projects' settings files are still read.
import { describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptPreviousSettings } from '../src/main/previous-names.js';
import { settingsSources } from '../src/main/project.js';

describe('the settings folder', () => {
  it('under the earlier name: moved to the app’s, a link left where it was', () => {
    const appData = mkdtempSync(join(tmpdir(), 'appdata-'));
    mkdirSync(join(appData, 'MyST Editor', 'sphinx'), { recursive: true });
    writeFileSync(join(appData, 'MyST Editor', 'settings.json'), '{"recent":["/docs"]}');
    adoptPreviousSettings(appData, join(appData, 'Wysie'));
    expect(readFileSync(join(appData, 'Wysie', 'settings.json'), 'utf8')).toBe('{"recent":["/docs"]}');
    expect(existsSync(join(appData, 'Wysie', 'sphinx'))).toBe(true);
    expect(lstatSync(join(appData, 'MyST Editor')).isSymbolicLink()).toBe(true);
    // Through the link, the old paths still lead there (environments keep them).
    expect(readFileSync(join(appData, 'MyST Editor', 'settings.json'), 'utf8')).toBe('{"recent":["/docs"]}');
  });

  it('left alone once the app has its own', () => {
    const appData = mkdtempSync(join(tmpdir(), 'appdata-'));
    mkdirSync(join(appData, 'MyST Editor'));
    mkdirSync(join(appData, 'Wysie'));
    adoptPreviousSettings(appData, join(appData, 'Wysie'));
    expect(lstatSync(join(appData, 'MyST Editor')).isDirectory()).toBe(true);
  });
});

describe('a project’s settings file', () => {
  it('is .wysie.toml, or .mysteditor.toml, the new name first', () => {
    const root = mkdtempSync(join(tmpdir(), 'names-'));
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, '.mysteditor.toml'), '# old\n');
    writeFileSync(join(root, 'docs', '.mysteditor.toml'), '# old\n');
    writeFileSync(join(root, 'docs', '.wysie.toml'), '# new\n');
    expect(settingsSources(root, join(root, 'docs')).map((s) => [s.file, s.text])).toEqual([
      ['.mysteditor.toml', '# old\n'],
      ['docs/.wysie.toml', '# new\n'],
    ]);
  });
});
