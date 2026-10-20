// ProseMirror schema for MyST documents.
//
// Every block node carries a `sid` attribute pointing into the SourceMap built at
// parse time. On save, a node that is still equal to its original is written back
// as its exact original source text; only edited nodes get re-serialized.
import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';

const sid = { sid: { default: null } };

// Attributes shared by every directive-backed node. `header` is the exact original
// opening fence + options text; it is reused verbatim while `headerKey` still
// matches the current name/args/options.
export const directiveAttrs = {
  name: { default: 'note' },
  args: { default: '' },
  options: { default: [] as [string, string][] },
  fence: { default: ':::' },
  header: { default: null as string | null },
  headerKey: { default: null as string | null },
};

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: { group: 'block', content: 'inline*', attrs: { ...sid } },

  heading: {
    group: 'block',
    content: 'inline*',
    defining: true,
    attrs: { ...sid, level: { default: 1 }, setext: { default: false } },
  },

  blockquote: { group: 'block', content: 'block+', defining: true, attrs: { ...sid } },

  bullet_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { ...sid, bullet: { default: '-' }, tight: { default: true } },
  },

  ordered_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { ...sid, start: { default: 1 }, delim: { default: '.' }, tight: { default: true }, repeat: { default: false } },
  },

  // `marker` is the item's original marker ("-", "3.", ...) and `pad` the spaces
  // after it, kept so edited items don't change style.
  list_item: {
    content: 'block+',
    defining: true,
    attrs: { ...sid, marker: { default: null as string | null }, pad: { default: 1 } },
  },

  // Plain fenced/indented code and code-like directives (code-block, eval-rst, ...).
  // `directive` is false for plain fences; otherwise directiveAttrs apply.
  code_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: {
      ...sid,
      lang: { default: '' },
      fence: { default: '```' },
      indented: { default: false },
      directive: { default: false },
      ...withoutFence(directiveAttrs),
      name: { default: 'code-block' },
    },
  },

  // Display math: `$$ ... $$ (label)` or a {math} directive.
  math_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    attrs: {
      ...sid,
      label: { default: '' },
      directive: { default: false },
      ...withoutFence(directiveAttrs),
      name: { default: 'math' },
      fence: { default: '```' },
    },
  },

  // A directive the editor understands whose body is MyST markdown
  // (admonitions, figure captions, dropdowns, ...).
  md_directive: { group: 'block', content: 'block*', defining: true, attrs: { ...sid, ...directiveAttrs } },

  // A directive the editor doesn't understand: kept byte-for-byte.
  opaque_directive: {
    group: 'block',
    atom: true,
    attrs: { ...sid, name: { default: '' }, args: { default: '' }, options: { default: [] }, source: { default: '' } },
  },

  // `(label)=`
  target: { group: 'block', atom: true, attrs: { ...sid, label: { default: '' } } },

  thematic_break: { group: 'block', attrs: { ...sid, markup: { default: '---' } } },

  // Anything else (front matter, HTML blocks, tables, comments, footnote definitions,
  // unrecognized syntax). `kind` is informational; `source` is written back as-is.
  raw_block: { group: 'block', atom: true, attrs: { ...sid, kind: { default: 'unknown' }, source: { default: '' } } },

  text: { group: 'inline' },

  // A line break inside a paragraph's source. Rendered as a space, written as "\n",
  // so a writer's edit doesn't re-wrap the paragraph.
  soft_break: { group: 'inline', inline: true, atom: true, selectable: false },
  hard_break: { group: 'inline', inline: true, selectable: false },

  role: { group: 'inline', inline: true, atom: true, attrs: { name: { default: 'ref' }, value: { default: '' } } },
  inline_math: { group: 'inline', inline: true, atom: true, attrs: { value: { default: '' } } },
  html_inline: { group: 'inline', inline: true, atom: true, attrs: { value: { default: '' } } },
  // `[](target)`: a link whose text Sphinx fills in from the target's title.
  ref_link: { group: 'inline', inline: true, atom: true, attrs: { href: { default: '' }, title: { default: null } } },
  footnote_ref: { group: 'inline', inline: true, atom: true, attrs: { label: { default: '' } } },
  image: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { src: { default: '' }, alt: { default: '' }, title: { default: null } },
  },
};

const marks: Record<string, MarkSpec> = {
  link: { attrs: { href: {}, title: { default: null } }, inclusive: false },
  em: {},
  strong: {},
  strike: {},
  code: {},
};

function withoutFence<T extends Record<string, unknown>>(attrs: T): Omit<T, 'fence'> {
  const { fence: _fence, ...rest } = attrs;
  return rest;
}

export const schema = new Schema({ nodes, marks });
