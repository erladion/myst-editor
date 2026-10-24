import { describe, expect, it } from 'vitest';
import { ensureTomlTable, setTomlKey } from '../src/core/toml-edit.js';
import { editConditions } from '../src/core/project-settings.js';
import { loadEditorConfig } from '../src/core/editor-config.js';

const FILE = `# Our project's editor settings
[roles.jira]
label = "Jira issue"   # shown in the toolbar

[conditions]
capabilities = "capabilities.json"  # the product list
block = [
  "if",   # opens
  "endif",
]

[conditions.colors]
CapabilityX = "teal"
"CapabilityX or CapabilityY" = "orange"

[sphinx.env]
PRODUCT = "enterprise"
`;

describe('setTomlKey', () => {
  it('changes a value in place, keeping comments and layout', () => {
    expect(setTomlKey(FILE, ['conditions'], 'capabilities', 'data/caps.json')).toBe(FILE.replace('"capabilities.json"', '"data/caps.json"'));
    expect(setTomlKey(FILE, ['conditions'], 'block', ['when', 'end'])).toBe(FILE.replace(/block = \[[\s\S]*?\n\]/, 'block = ["when", "end"]'));
    expect(setTomlKey(FILE, ['conditions', 'colors'], 'CapabilityX or CapabilityY', 'blue')).toBe(FILE.replace('= "orange"', '= "blue"'));
  });

  it('adds a key after the table’s last one', () => {
    expect(setTomlKey(FILE, ['conditions'], 'case_sensitive', false)).toBe(FILE.replace('  "endif",\n]\n', '  "endif",\n]\ncase_sensitive = false\n'));
    expect(setTomlKey(FILE, ['conditions', 'colors'], 'Capability.Z', 'slate')).toBe(FILE.replace('= "orange"\n', '= "orange"\n"Capability.Z" = "slate"\n'));
  });

  it('takes a key out, with the lines its value runs over', () => {
    expect(setTomlKey(FILE, ['conditions'], 'block', undefined)).toBe(FILE.replace(/block = \[[\s\S]*?\n\]\n/, ''));
    expect(setTomlKey(FILE, ['conditions'], 'inline', undefined)).toBe(FILE);
  });

  it('adds a missing table at the end, or before its subtables', () => {
    expect(setTomlKey('[roles.jira]\nlabel = "Jira"', ['conditions'], 'enabled', false)).toBe('[roles.jira]\nlabel = "Jira"\n\n[conditions]\nenabled = false\n');
    expect(setTomlKey('', ['conditions'], 'capabilities', 'c.json')).toBe('[conditions]\ncapabilities = "c.json"\n');
    expect(setTomlKey('[conditions.colors]\nX = "teal"\n', ['conditions'], 'enabled', false)).toBe('[conditions]\nenabled = false\n\n[conditions.colors]\nX = "teal"\n');
  });

  it('adds a subtable after its parent table', () => {
    expect(setTomlKey('[a]\nx = 1\n\n[a.b]\ny = 2\n\n[c]\nz = 3\n', ['a', 'd'], 'w', true)).toBe('[a]\nx = 1\n\n[a.b]\ny = 2\n\n[a.d]\nw = true\n\n[c]\nz = 3\n');
  });

  it('writes into dotted keys where the table is written that way', () => {
    expect(setTomlKey('[conditions]\ncolors.X = "teal"\n', ['conditions', 'colors'], 'Y', 'blue')).toBe('[conditions]\ncolors.X = "teal"\ncolors.Y = "blue"\n');
  });

  it('knows a table that only has subtables', () => {
    expect(ensureTomlTable(FILE, ['conditions'])).toBe(FILE);
    expect(ensureTomlTable('[conditions.colors]\n', ['conditions'])).toBe('[conditions.colors]\n');
    expect(ensureTomlTable('# settings\n', ['conditions'])).toBe('# settings\n\n[conditions]\n');
  });

  it('reads strings with quotes, escapes and brackets in them', () => {
    const text = `[a]\nx = "a ] # \\" b"  # c\ny = '''\nq ] '''\nz = """x""""\n[b]\n`;
    expect(setTomlKey(text, ['a'], 'w', true)).toBe(text.replace('[b]', 'w = true\n[b]'));
    expect(setTomlKey(text, ['a'], 'x', 'n')).toBe(text.replace('"a ] # \\" b"', '"n"'));
  });
});

describe('editConditions', () => {
  const config = (text: string) => loadEditorConfig([{ file: '.mysteditor.toml', text, readCapabilities: () => '["CapabilityX", "CapabilityY"]' }]);

  it('turns conditional content on and off, keeping its settings', () => {
    const on = editConditions('', { enabled: true });
    expect(on).toBe('[conditions]\n');
    expect(config(on).conditions).not.toBeNull();
    const off = editConditions(FILE, { enabled: false });
    expect(config(off).conditions).toBeNull();
    expect(config(off).conditionSettings?.capabilities).toEqual(['CapabilityX', 'CapabilityY']);
    expect(config(editConditions(off, { enabled: true })).conditions?.colors).toEqual({ CapabilityX: 'teal', 'CapabilityX or CapabilityY': 'orange' });
    expect(editConditions(off, { enabled: true })).toBe(FILE);
  });

  it('says so when a file further out turns it off', () => {
    expect(editConditions('', { enabled: true }, true)).toBe('[conditions]\nenabled = true\n');
  });

  it('changes the file, the markers, case and colours', () => {
    const next = editConditions(FILE, { capabilities: 'caps.json', key: 'product.capabilities', inline: ['ifi', 'endifi'], caseSensitive: false, colors: { CapabilityX: null, CapabilityY: 'magenta' } });
    const c = loadEditorConfig([{ file: 'x', text: next, readCapabilities: () => '{"product": {"capabilities": ["A"]}}' }]).conditions!;
    expect(c).toMatchObject({ capabilitiesFile: 'caps.json', capabilitiesKey: 'product.capabilities', capabilities: ['A'], inline: ['ifi', 'endifi'], caseSensitive: false, colors: { 'CapabilityX or CapabilityY': 'orange', CapabilityY: 'magenta' } });
    expect(next).toContain('# the product list');
    expect(editConditions(next, { key: null })).not.toContain('key =');
  });

  it('refuses what it can’t write into the text', () => {
    expect(() => editConditions('conditions = { block = ["a", "b"] }\n', { caseSensitive: false })).toThrow();
  });
});
