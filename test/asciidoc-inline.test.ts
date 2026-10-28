// AsciiDoc inline text: read the way Asciidoctor reads it, and written so that
// Asciidoctor reads it the same.
import { describe, expect, it } from 'vitest';
import { convert } from '@asciidoctor/core';
import type { Node as PMNode } from 'prosemirror-model';
import { parseInline, serializeInline, Unsupported } from '../src/core/asciidoc/inline.js';
import { schema } from '../src/core/schema.js';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The editor's reading of a paragraph, as the HTML Asciidoctor would make of it.
function html(nodes: PMNode[]): string {
  let out = '';
  const open: string[] = [];
  const tag = (name: string) => {
    if (name === 'strong') return ['<strong>', '</strong>'];
    if (name === 'em') return ['<em>', '</em>'];
    if (name === 'code') return ['<code>', '</code>'];
    if (name === 'strike') return ['<span class="line-through">', '</span>'];
    return ['', ''];
  };
  const marksOf = (n: PMNode) => n.marks.map((m) => (m.type.name === 'link' ? `link:${m.attrs.href}` : m.type.name));
  for (const n of nodes) {
    const want = marksOf(n);
    // Open marks stay open while the node has them, whatever their order.
    let keep = 0;
    while (keep < open.length && want.includes(open[keep])) keep++;
    while (open.length > keep) {
      const m = open.pop()!;
      out += m.startsWith('link:') ? '</a>' : tag(m)[1];
    }
    for (const m of want.filter((w) => !open.includes(w))) {
      out += m.startsWith('link:') ? `<a href="${m.slice(5)}">` : tag(m)[0];
      open.push(m);
    }
    if (n.isText) out += escape(n.text!);
    else if (n.type.name === 'soft_break') out += '\n';
    else if (n.type.name === 'hard_break') out += '<br>\n';
    else if (n.type.name === 'image') out += `<span class="image"><img src="${n.attrs.src}" alt="${n.attrs.alt}"></span>`;
    else if (n.type.name === 'html_inline') out += n.attrs.value;
    else if (n.type.name === 'role') {
      const { name, value } = n.attrs;
      const m = /^([\s\S]*?)\s*<([^<>]*)>$/.exec(value);
      const [text, target] = m ? [m[1], m[2]] : ['', value];
      if (name === 'sup') out += `<sup>${value}</sup>`;
      else if (name === 'sub') out += `<sub>${value}</sub>`;
      else if (name === 'attribute') out += `{${value}}`;
      else if (name === 'ref') out += `<a href="#${target}">${text || `[${target}]`}</a>`;
      else if (name === 'xref') out += `<a href="${target.replace(/\.adoc/, '.html')}">${text || target.replace(/\.adoc/, '.html')}</a>`;
      else if (name === 'anchor') out += `<a id="${value}"></a>`;
      else out += `${name}:${value}`;
    } else out += `[${n.type.name}]`;
  }
  while (open.length) {
    const m = open.pop()!;
    out += m.startsWith('link:') ? '</a>' : tag(m)[1];
  }
  return out;
}

async function asciidoctor(text: string): Promise<string> {
  const out = (await convert(text, { safe: 'safe', attributes: { experimental: '' } })) as string;
  return out
    .replace(/^<div class="paragraph">\n<p>|<\/p>\n<\/div>$/g, '')
    .replace(/ class="bare"/g, '')
    .replace(/&#8217;/g, '’');
}

const SAMPLES = [
  'plain text',
  '*bold* and _italic_ and `mono`',
  'a**b**c and x__y__z and a``b``c',
  '*bold _and italic_ inside*',
  '_*not bold*_',
  '*a\nb* across lines',
  'a*b*c and 2*3*4 and snake_case_name',
  'not*bold * here and a * b * c',
  'a.*b* (*c*) "*d*"',
  'see:*b* and ;*c* and }*d*',
  '\\*not bold* and \\_not_ and \\`code`',
  '`+*literal*+` and ``+a*b+``x',
  '++a*b*c++ and (+*y*+) and x+*y*+z',
  'pass:[<b>raw</b>] and +++<i>raw</i>+++',
  'H~2~O and x^2^ and a ^b c^ d',
  'https://example.org and https://example.org[the site] and https://example.org.',
  '(https://example.org) and link:other.html[Other] and link:other.html[]',
  'mailto:me@example.org[Mail me]',
  '<<install>> and <<install,Installing>> and <<a,b,c>>',
  'xref:guide.adoc[] and xref:guide.adoc#start[Getting started]',
  'image:logo.png[The logo] here',
  'an [[anchor]]here',
  'line one +\nline two',
  'see {version} and \\{version} and {no space}',
  '[.line-through]#gone#',
  'a \\https://example.org b',
  'back\\slash and \\\\ and a\\b',
  'brackets [like this] and <angles> & ampersands',
  'link:https://example.org[*bold* link]',
];

describe('AsciiDoc inline text', () => {
  it.each(SAMPLES)('reads %j as Asciidoctor does', async (text) => {
    expect(html(parseInline(text))).toBe(await asciidoctor(text));
  });

  it.each(SAMPLES)('writes %j back so that it reads the same', async (text) => {
    const para = schema.node('paragraph', null, parseInline(text));
    const written = serializeInline(para);
    expect(html(parseInline(written))).toBe(html(parseInline(text)));
    expect(await asciidoctor(written)).toBe(await asciidoctor(text));
  });

  it('keeps what it can’t show as it is', () => {
    for (const text of ['#highlight#', '[.role]*styled*', 'https://example.org[new window^]', 'image:a.png[A,100]', '((index term))']) {
      expect(() => parseInline(text), text).toThrow(Unsupported);
    }
  });

  it('writes text that looks like markup so that it stays text', async () => {
    const tricky = ['*not bold*', 'a_b_ and _c_', '`tick`', '{attr}', '<<ref>>', 'https://example.org', 'x^2^', 'image:a.png[]', 'one +', '* not a list', '[not attributes]', '.Not a title', '== Not a section', 'NOTE: not a note', 'term:: not a definition'];
    for (const text of tricky) {
      const para = schema.node('paragraph', null, [schema.text(text)]);
      const written = serializeInline(para);
      expect(parseInline(written).map((n) => n.text).join(''), `${text} → ${written}`).toBe(text);
    }
  });
});
