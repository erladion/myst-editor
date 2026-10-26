import { describe, expect, it } from 'vitest';
import { ensureTomlTable, setTomlKey } from '../src/core/toml-edit.js';
import { editConditions, editPdf } from '../src/core/project-settings.js';
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

describe('editPdf and [pdf]', () => {
  const read = (text: string) => loadEditorConfig([{ file: 'docs/.mysteditor.toml', text, readCapabilities: () => '[]' }]);

  it('writes the settings into [pdf], and reads them back', () => {
    const text = editPdf('[roles.jira]\nlabel = "Jira"\n', { paper: 'Letter', logo: '_static/logo.svg', header: ['{logo}', '', '{chapter}'], tocDepth: 3, title: null });
    expect(text).toBe('[roles.jira]\nlabel = "Jira"\n\n[pdf]\npaper = "Letter"\nlogo = "_static/logo.svg"\nheader = ["{logo}", "", "{chapter}"]\ntoc_depth = 3\n');
    const { pdf, problems } = read(text);
    expect(problems).toEqual([]);
    expect(pdf).toMatchObject({ paper: 'Letter', logo: '_static/logo.svg', logoPath: 'docs/_static/logo.svg', header: ['{logo}', '', '{chapter}'], footer: ['', '{page}', ''], tocDepth: 3, numbering: 'content' });
    expect(editPdf(text, { paper: null, tocDepth: null })).not.toMatch(/paper|toc_depth/);
  });

  it('says what’s wrong with a setting', () => {
    const { problems, pdf } = read('[pdf]\npaper = "A5"\nheader = ["a", "b"]\ntoc_depth = 9\nnumbering = "roman"\nheaders_on = "odd"\ncolour = "red"\n');
    expect(problems.map((p) => p.message)).toEqual([
      '[pdf] paper must be A4 or Letter',
      '[pdf] header must be three texts (left, centre, right), like ["", "{page}", ""]',
      '[pdf] headers_on must be "numbered", "not-cover" or "all"',
      '[pdf] numbering must be "content" or "cover"',
      '[pdf] toc_depth must be 1, 2, 3 or 4',
      '[pdf] unknown setting "colour"',
    ]);
    expect(pdf.paper).toBe('A4');
  });
});

describe('the cover and fonts in [pdf]', () => {
  const read = (text: string) => loadEditorConfig([{ file: 'docs/.mysteditor.toml', text, readCapabilities: () => '[]' }]);

  it('writes graphics one to a line, and reads them back', () => {
    const text = editPdf('', { coverImages: [{ file: 'a.svg', x: 10, y: 20.5, width: 40 }, { file: 'b.png', x: 0, y: 0, width: 210, height: 30 }], fonts: ['f/Brand.ttf'], font: 'Brand' });
    expect(text).toBe('[pdf]\ncover_images = [\n  { file = "a.svg", x = 10, y = 20.5, width = 40 },\n  { file = "b.png", x = 0, y = 0, width = 210, height = 30 },\n]\nfont = "Brand"\nfonts = ["f/Brand.ttf"]\n');
    const { pdf, problems } = read(text);
    expect(problems).toEqual([]);
    expect(pdf.coverImages).toEqual([
      { file: 'a.svg', path: 'docs/a.svg', x: 10, y: 20.5, width: 40, height: null },
      { file: 'b.png', path: 'docs/b.png', x: 0, y: 0, width: 210, height: 30 },
    ]);
    expect(pdf.fonts).toEqual([{ file: 'f/Brand.ttf', path: 'docs/f/Brand.ttf' }]);
    // Changed in place; an empty list takes the setting out.
    expect(editPdf(text, { coverImages: [{ file: 'a.svg', x: 12, y: 20, width: 40 }] })).toContain('cover_images = [\n  { file = "a.svg", x = 12, y = 20, width = 40 },\n]\nfont');
    expect(editPdf(text, { coverImages: [] })).not.toContain('cover_images');
  });

  it('says what’s wrong with a graphic or a font', () => {
    const { problems } = read('[pdf]\ncover_images = [{ x = 1 }, { file = "a.svg", x = "20mm", y = 1, width = 2 }]\nfonts = ["brand.css"]\ncover_color = "rgb(1,2,3)"\n');
    expect(problems.map((p) => p.message)).toEqual([
      '[pdf] cover_color must be a colour, like "#ffffff" or "white"',
      '[pdf] fonts must be a list of font files (.ttf, .otf, .woff or .woff2)',
      '[pdf] cover_images, number 1: needs a file',
      '[pdf] cover_images, number 2: x, y, width (and height) are numbers of mm',
    ]);
  });
});

describe('moving the cover’s parts', () => {
  const read = (text: string) => loadEditorConfig([{ file: 'docs/.mysteditor.toml', text, readCapabilities: () => '[]' }]);

  it('writes each moved part as its own table, and takes it out when it goes back', () => {
    const base = '[pdf]\ntitle = "Manual"\n';
    const moved = editPdf(base, { cover: { title: { x: 20, y: 120, width: null, size: 36, align: 'center' }, logo: { x: 150, y: 20, width: 40, size: null, align: null } } });
    expect(moved).toBe('[pdf]\ntitle = "Manual"\n\n[pdf.cover.title]\nx = 20\ny = 120\nsize = 36\nalign = "center"\n\n[pdf.cover.logo]\nx = 150\ny = 20\nwidth = 40\n');
    expect(read(moved).pdf.cover).toEqual({ title: { x: 20, y: 120, width: null, size: 36, align: 'center' }, logo: { x: 150, y: 20, width: 40, size: null, align: null } });
    expect(read(moved).problems).toEqual([]);
    const back = editPdf(moved, { cover: { title: null } });
    expect(back).toBe('[pdf]\ntitle = "Manual"\n\n[pdf.cover.logo]\nx = 150\ny = 20\nwidth = 40\n');
    expect(editPdf(back, { cover: { logo: null } })).toBe(base);
  });

  it('says what’s wrong with a part’s place', () => {
    const { problems } = read('[pdf.cover.title]\nx = "20mm"\ny = 1\n[pdf.cover.badge]\nx = 1\ny = 1\n[pdf.cover.note]\nx = 1\ny = 2\nalign = "justify"\n');
    expect(problems.map((p) => p.message)).toEqual([
      '[pdf.cover.title]: x and y are numbers of mm',
      '[pdf.cover.badge]: the cover’s parts are logo, title, subtitle, note',
      '[pdf.cover.note]: align is left, center or right',
    ]);
  });
});

describe('the PDF’s stylesheets', () => {
  const read = (text: string) => loadEditorConfig([{ file: 'docs/.mysteditor.toml', text, readCapabilities: () => '[]' }]);

  it('leaves out the website’s, and adds its own', () => {
    const text = editPdf('[pdf]\npaper = "A4"\n', { siteCss: false, css: '_static/pdf.css' });
    expect(text).toBe('[pdf]\npaper = "A4"\nsite_css = false\ncss = "_static/pdf.css"\n');
    const { pdf, problems } = read(text);
    expect(problems).toEqual([]);
    expect(pdf).toMatchObject({ siteCss: false, css: '_static/pdf.css', cssPath: 'docs/_static/pdf.css' });
    expect(read('').pdf).toMatchObject({ siteCss: true, css: null });
    expect(editPdf(text, { siteCss: true, css: null })).toBe('[pdf]\npaper = "A4"\nsite_css = true\n');
  });

  it('says what’s wrong with them', () => {
    const { problems } = read('[pdf]\nsite_css = "no"\ncss = "_static/pdf.scss"\n');
    expect(problems.map((p) => p.message)).toEqual(['[pdf] site_css must be true or false', '[pdf] css must be a stylesheet (.css)']);
  });
});
