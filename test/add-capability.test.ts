import { describe, expect, it } from 'vitest';
import { addCapability, isCapabilityName, loadEditorConfig } from '../src/core/editor-config.js';

describe('adding a capability', () => {
  it('follows the list’s shape and the file’s layout', () => {
    // One line, under a key: stays on one line, spaced as it was.
    expect(addCapability('{"product": {"capabilities": ["A", "B"]}}', 'product.capabilities', 'C')).toBe('{"product": {"capabilities": ["A", "B", "C"]}}');
    expect(addCapability('{"capabilities":["A","B"]}', null, 'C')).toBe('{"capabilities":["A","B","C"]}');
    // One line and a final newline: the same.
    expect(addCapability('["A"]\n', null, 'B')).toBe('["A", "B"]\n');
    // Indented, with a final newline: indented the same.
    expect(addCapability('{\n    "capabilities": [\n        "A"\n    ]\n}\n', null, 'B')).toBe('{\n    "capabilities": [\n        "A",\n        "B"\n    ]\n}\n');
    // A list on one line in an indented file stays on its line.
    const file = '{\n  "name": "Product",\n  "capabilities": ["A", "B"],\n  "other": [1, 2]\n}\n';
    expect(addCapability(file, null, 'C')).toBe('{\n  "name": "Product",\n  "capabilities": ["A", "B", "C"],\n  "other": [1, 2]\n}\n');
    // An empty list.
    expect(addCapability('{"capabilities": []}', null, 'A')).toBe('{"capabilities": ["A"]}');
    expect(addCapability('{\n  "capabilities": []\n}\n', null, 'A')).toBe('{\n  "capabilities": [\n    "A"\n  ]\n}\n');
    // A list of objects: one more, named like the others, written like them.
    expect(addCapability('[{"id": "A", "label": "Alpha"}]', null, 'B')).toBe('[{"id": "A", "label": "Alpha"}, {"id": "B"}]');
    expect(addCapability('[{"name":"A"}]', null, 'B')).toBe('[{"name":"A"},{"name":"B"}]');
    expect(addCapability('[\n  {\n    "name": "A"\n  }\n]\n', null, 'B')).toBe('[\n  {\n    "name": "A"\n  },\n  {\n    "name": "B"\n  }\n]\n');
    // Keyed by name: a value like the others'.
    expect(addCapability('{"A": {"since": "2.0"}}', null, 'B')).toBe('{"A": {"since": "2.0"}, "B": {}}');
    expect(addCapability('{"A":true}', null, 'B')).toBe('{"A":true,"B":true}');
    expect(addCapability('{\n  "A": true\n}', null, 'B')).toBe('{\n  "A": true,\n  "B": true\n}');
  });

  it('leaves the file as it is when the name is there, and gives up without a list', () => {
    const text = '{"capabilities": ["A"]}';
    expect(addCapability(text, null, 'A')).toBe(text);
    expect(addCapability('{"other": 1}', 'product.capabilities', 'B')).toBeNull();
  });

  it('knows which names a condition can use', () => {
    expect(['CapabilityX', 'feature.beta', 'x_1:y-2'].every(isCapabilityName)).toBe(true);
    expect(['', '1st', 'two words', 'and', 'Not'].some(isCapabilityName)).toBe(false);
  });

  it('records where the file is, relative to the opened folder', () => {
    const config = loadEditorConfig([{ file: 'docs/.mysteditor.toml', text: '[conditions]\ncapabilities = "../data/caps.json"\nkey = "product.capabilities"\n', readCapabilities: () => '{"product": {"capabilities": []}}' }]);
    expect([config.conditions?.capabilitiesPath, config.conditions?.capabilitiesKey]).toEqual(['data/caps.json', 'product.capabilities']);
  });
});
