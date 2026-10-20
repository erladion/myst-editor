// Node views: how MyST constructs look and behave in the editor.
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { Decoration, EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';
import { createTokenizer } from 'myst-parser';
import { splitDirective } from '../../../core/directive';
import { loadDocument } from '../../../core/document';
import type { EditorContext } from './context';
import { ADMONITIONS, CALLOUT_CHOICES, ICONS, REFERENCE_ROLES, directiveInfo, splitRoleValue } from './directives';
import { renderMath } from './math';
import { describe, parseCondition, readMarker, withExpression } from '../../../core/conditions';
import { removeCondition } from './conditions';

// "A or B and not C" with the capability names as chips.
function conditionChips(text: string): Node[] {
  return text.split(/(\s+|[()])/).filter(Boolean).map((part) =>
    /^(and|or|not|\(|\)|\s+)$/i.test(part) ? document.createTextNode(part) : el('span', { class: 'cond-name' }, part),
  );
}

type GetPos = () => number | undefined;

// ---- helpers ------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

function icon(svg: string): HTMLElement {
  const span = el('span', { class: 'icon', 'aria-hidden': 'true' });
  span.innerHTML = svg;
  return span;
}

function button(label: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: `nv-button ${cls}`, title }, label);
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor selection
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
  });
  return b;
}

function setAttrs(view: EditorView, getPos: GetPos, node: PMNode, patch: Record<string, unknown>) {
  const pos = getPos();
  if (pos === undefined) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }));
}

function deleteNode(view: EditorView, getPos: GetPos, node: PMNode) {
  const pos = getPos();
  if (pos === undefined) return;
  view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
  view.focus();
}

// Replace a block with whatever the writer's edited source parses to.
function replaceWithSource(view: EditorView, getPos: GetPos, node: PMNode, source: string, ctx: EditorContext) {
  const pos = getPos();
  if (pos === undefined) return;
  if (!source.trim()) return deleteNode(view, getPos, node);
  const loaded = loadDocument(source.replace(/\s+$/, '') + '\n', ctx.config);
  ctx.absorb(loaded.map);
  view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, loaded.doc.content));
  view.focus();
}

const optionCount = (options: [string, string][]) => (options.length ? `Options (${options.length})` : 'Options');

let tokenizer: ReturnType<typeof createTokenizer> | null = null;
function markdownPreview(source: string): string {
  tokenizer ??= createTokenizer({ markdownit: { html: false } });
  try {
    return tokenizer.render(source);
  } catch {
    return '';
  }
}

// ---- block directives with Markdown bodies --------------------------------------

class DirectiveView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private header = el('div', { class: 'directive-header', contenteditable: 'false' });
  private preview = el('div', { class: 'directive-preview', contenteditable: 'false' });
  private argInput: HTMLInputElement | null = null;
  private rendered = '';

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: GetPos,
    private ctx: EditorContext,
  ) {
    this.contentDOM = el('div', { class: 'directive-body' });
    this.dom = el('div', {}, this.header, this.preview, this.contentDOM);
    this.render();
  }

  private render() {
    const { name, args, options } = this.node.attrs;
    const info = directiveInfo(name, this.ctx.config.editor);
    this.dom.className = `directive tone-${info.tone} directive-${name}`;
    // Rebuild the header unless only the argument changed while the writer is typing it.
    const key = JSON.stringify([name, options]);
    if (key === this.rendered && this.argInput) {
      if (this.argInput.value !== args && document.activeElement !== this.argInput) this.argInput.value = args;
    } else {
      this.rendered = key;
      this.buildHeader();
    }
    this.renderPreview();
  }

  private buildHeader() {
    const { name, args, options } = this.node.attrs;
    const info = directiveInfo(name, this.ctx.config.editor);
    const schema = this.ctx.config.editor.directives[name]?.options;
    const parts: Node[] = [icon(ICONS[info.tone])];

    if (ADMONITIONS[name]) {
      const select = el('select', { class: 'directive-kind', title: 'Change the type of this callout' });
      const names = CALLOUT_CHOICES.includes(name) ? CALLOUT_CHOICES : [name, ...CALLOUT_CHOICES];
      for (const n of names) select.append(el('option', { value: n }, ADMONITIONS[n].label));
      select.value = name;
      select.addEventListener('change', () => {
        const patch: Record<string, unknown> = { name: select.value };
        if (select.value === 'admonition' && !args) patch.args = 'Title';
        if (name === 'admonition' && select.value !== 'admonition') patch.args = '';
        setAttrs(this.view, this.getPos, this.node, patch);
      });
      parts.push(select);
    } else {
      parts.push(el('span', { class: 'directive-label' }, info.label));
    }

    this.argInput = null;
    if (info.argLabel || args) {
      const argLabel = info.argLabel ?? 'Argument';
      const input = el('input', { class: 'directive-arg', placeholder: argLabel, 'aria-label': argLabel });
      input.value = args;
      input.addEventListener('input', () => setAttrs(this.view, this.getPos, this.node, { args: input.value }));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          this.focusBody();
        }
      });
      this.argInput = input;
      parts.push(input);
    }

    // The argument field stretches; without one, push the buttons right.
    if (!this.argInput) parts.push(el('span', { class: 'spacer' }));
    parts.push(
      button(optionCount(options), 'Edit the options of this block', async () => {
        const next = await this.ctx.ui.editOptions({ title: `${info.label} options`, options: this.node.attrs.options, schema });
        if (next) setAttrs(this.view, this.getPos, this.node, { options: next });
      }),
    );
    parts.push(button('✕', 'Remove this block', () => deleteNode(this.view, this.getPos, this.node), 'danger'));
    this.header.replaceChildren(...parts);
  }

  private renderPreview() {
    const { name, args, options } = this.node.attrs;
    if (name === 'figure' && args) {
      const alt = options.find(([k]: [string, string]) => k === 'alt')?.[1] ?? '';
      const current = this.preview.querySelector('img');
      const src = this.ctx.assetUrl(args);
      if (current?.getAttribute('src') !== src) {
        const img = el('img', { src, alt, draggable: 'false' });
        img.addEventListener('error', () => this.preview.replaceChildren(el('div', { class: 'missing' }, `Image not found: ${args}`)));
        this.preview.replaceChildren(img);
      }
      this.preview.hidden = false;
    } else {
      this.preview.hidden = true;
    }
  }

  private focusBody() {
    const pos = this.getPos();
    if (pos === undefined) return;
    const sel = TextSelection.near(this.view.state.doc.resolve(pos + 1));
    this.view.dispatch(this.view.state.tr.setSelection(sel));
    this.view.focus();
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(e: Event) {
    return this.header.contains(e.target as Node) || this.preview.contains(e.target as Node);
  }

  ignoreMutation(m: ViewMutationRecord) {
    return !this.contentDOM.contains(m.target);
  }
}

// ---- opaque directives and raw blocks: cards with a preview ---------------------

// Messages from preview iframes (see fragments.ts in the main process): their
// height, or that the build produced nothing to show.
const previewListeners = new Map<string, (msg: { height: number; empty: boolean }) => void>();
let previewCounter = 0;
window.addEventListener('message', (e) => {
  if (!String(e.origin).startsWith('myst-build://')) return;
  const data = e.data as { mysteditorFragment?: string; height?: number; empty?: boolean };
  if (data?.mysteditorFragment) previewListeners.get(data.mysteditorFragment)?.({ height: Number(data.height) || 0, empty: !!data.empty });
});

const previewUrlOf = (decorations: readonly Decoration[]) =>
  (decorations.find((d) => (d as Decoration & { spec: { previewUrl?: string } }).spec.previewUrl) as (Decoration & { spec: { previewUrl: string } }) | undefined)?.spec.previewUrl ?? null;

abstract class CardView implements NodeView {
  dom: HTMLElement;
  // The block as the project's Sphinx build renders it, when there is one.
  protected previewUrl: string | null;
  private previewId: string | null = null;

  constructor(
    protected node: PMNode,
    protected view: EditorView,
    protected getPos: GetPos,
    protected ctx: EditorContext,
    decorations: readonly Decoration[] = [],
  ) {
    this.previewUrl = previewUrlOf(decorations);
    this.dom = el('div', { contenteditable: 'false' });
    this.dom.addEventListener('dblclick', (e) => {
      if (this.view.editable && !(e.target as HTMLElement).closest('a, button')) this.edit();
    });
    this.render();
  }

  destroy() {
    if (this.previewId) previewListeners.delete(this.previewId);
  }

  protected abstract render(): void;
  protected abstract editTitle(): string;

  protected async edit() {
    const source = await this.ctx.ui.editSource({
      title: this.editTitle(),
      source: this.node.attrs.source,
      help: 'This is the Markdown source of the block. It is saved exactly as written.',
    });
    if (source !== null && source !== this.node.attrs.source) replaceWithSource(this.view, this.getPos, this.node, source, this.ctx);
  }

  protected card(cls: string, title: Node[], body: Node[]) {
    this.dom.className = `card ${cls}`;
    const header = el('div', { class: 'card-header' }, ...title, el('span', { class: 'spacer' }), button('Edit…', 'Edit the source of this block', () => this.edit()));
    if (this.previewId) previewListeners.delete(this.previewId);
    this.previewId = null;
    if (!this.previewUrl) return this.dom.replaceChildren(header, ...body);

    // The built HTML in a sandboxed frame on the build's own origin; the card's own
    // preview stays as the fallback until the frame says it has something to show.
    const id = `p${++previewCounter}`;
    const frame = el('iframe', {
      class: 'card-preview',
      title: 'Preview from the Sphinx build',
      sandbox: 'allow-scripts allow-same-origin',
      src: `${this.previewUrl}&id=${id}`,
    });
    const fallback = el('div', { class: 'card-fallback' }, ...body);
    const badge = el('span', { class: 'card-badge', title: 'Rendered by the project’s Sphinx build' }, 'as built');
    header.insertBefore(badge, header.querySelector('.spacer'));
    badge.hidden = true;
    frame.hidden = true;
    previewListeners.set(id, ({ height, empty }) => {
      frame.hidden = empty;
      fallback.hidden = !empty;
      badge.hidden = empty;
      frame.style.height = `${Math.min(height, 2000)}px`;
    });
    this.previewId = id;
    this.dom.replaceChildren(header, frame, fallback);
  }

  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    const url = previewUrlOf(decorations);
    if (node.attrs !== this.node.attrs || url !== this.previewUrl) {
      this.node = node;
      this.previewUrl = url;
      this.render();
    }
    return true;
  }

  stopEvent(e: Event) {
    return !!(e.target as HTMLElement).closest?.('button, a');
  }

  ignoreMutation() {
    return true;
  }
}

class OpaqueDirectiveView extends CardView {
  protected editTitle() {
    return `Edit {${this.node.attrs.name}} block`;
  }

  protected render() {
    const { name, args, options, source } = this.node.attrs;
    const label = (text: string) => el('span', { class: 'card-label' }, text);
    const body = splitDirective(source)?.body ?? '';

    if (name === 'image') {
      const img = el('img', { src: this.ctx.assetUrl(args), alt: options.find(([k]: string[]) => k === 'alt')?.[1] ?? '' });
      img.addEventListener('error', () => img.replaceWith(el('div', { class: 'missing' }, `Image not found: ${args}`)));
      return this.card('card-image', [label('Image'), el('code', {}, args)], [el('div', { class: 'card-image-preview' }, img)]);
    }

    if (name === 'toctree') {
      const entries = body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith(':'));
      const caption = options.find(([k]: string[]) => k === 'caption')?.[1];
      const list = el(
        'ul',
        { class: 'toc-entries' },
        ...entries.map((entry) => {
          const { title, target } = splitRoleValue(entry);
          const a = el('a', { href: '#', title: `Open ${target}` }, title ?? this.ctx.pageTitle(target) ?? target);
          a.addEventListener('click', (e) => {
            e.preventDefault();
            this.ctx.openDocument(target);
          });
          return el('li', {}, a);
        }),
      );
      return this.card('card-toc', [label('Table of contents'), ...(caption ? [el('span', { class: 'muted' }, caption)] : [])], [list]);
    }

    const declared = this.ctx.config.editor.directives[name];
    const optionLabel = (k: string) => declared?.options[k]?.label ?? k;
    const chips = options.map(([k, v]: [string, string]) => el('span', { class: 'chip' }, v ? `${optionLabel(k)}: ${v}` : optionLabel(k)));
    const lines = body.split('\n');
    const preview = lines.slice(0, 8).join('\n') + (lines.length > 8 ? '\n…' : '');
    this.card(
      `card-directive${declared?.tone ? ` tone-${declared.tone}` : ''}`,
      [label(declared?.label ?? name), ...(args ? [el('span', { class: 'muted' }, args)] : [])],
      [
        ...(chips.length ? [el('div', { class: 'chips' }, ...chips)] : []),
        ...(preview.trim() ? [el('pre', { class: 'card-source' }, preview)] : []),
        el('div', { class: 'card-note' }, declared ? 'Double-click to edit.' : 'Custom block — shown as in the source. Double-click to edit.'),
      ],
    );
  }
}

const RAW_LABELS: Record<string, string> = {
  frontmatter: 'Page settings',
  table: 'Table',
  definitionList: 'Definition list',
  footnote: 'Footnote',
  html: 'HTML',
  comment: 'Comment',
  'block-break': 'Cell break',
};

class RawBlockView extends CardView {
  protected editTitle() {
    return `Edit ${(RAW_LABELS[this.node.attrs.kind] ?? 'Markdown').toLowerCase()}`;
  }

  protected async edit() {
    const settings = this.ctx.config.editor.conditions;
    if (!settings || !/^condition-/.test(this.node.attrs.kind)) return super.edit();
    const marker = readMarker(this.node.attrs.source, settings.block);
    if (marker?.kind !== 'start') return;
    const result = await this.ctx.ui.editCondition({ expr: marker.expr, settings, allowRemove: true });
    if (!result) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    if ('remove' in result) removeCondition(settings, pos)(this.view.state, this.view.dispatch);
    else setAttrs(this.view, this.getPos, this.node, { source: withExpression(this.node.attrs.source, result.expr) });
    this.view.focus();
  }

  private renderCondition(kind: string, source: string) {
    const settings = this.ctx.config.editor.conditions;
    const marker = settings && readMarker(source, settings.block);
    if (kind === 'condition-end' || marker?.kind !== 'start') {
      this.dom.className = 'cond-end-line';
      this.dom.title = 'End of the condition';
      return this.dom.replaceChildren(el('span', {}, 'end of condition'));
    }
    const parsed = parseCondition(marker.expr);
    const pos = () => this.getPos();
    this.dom.className = 'cond-start';
    this.dom.replaceChildren(
      el('span', { class: 'cond-label' }, 'Shown only when'),
      el('span', { class: 'cond-expr' }, ...(parsed.ok ? conditionChips(describe(parsed.expr)) : [marker.expr])),
      ...(parsed.ok ? [] : [el('span', { class: 'cond-error' }, parsed.error)]),
      el('span', { class: 'spacer' }),
      button('Edit…', 'Change the condition', () => void this.edit()),
      button('Remove', 'Remove the condition and keep its content', () => {
        const p = pos();
        if (p !== undefined && settings) removeCondition(settings, p)(this.view.state, this.view.dispatch);
      }, 'danger'),
    );
  }

  protected render() {
    const { kind, source } = this.node.attrs;
    if (/^condition-/.test(kind)) return this.renderCondition(kind, source);
    const label = el('span', { class: 'card-label' }, RAW_LABELS[kind] ?? 'Markdown');
    if (kind === 'comment') {
      return this.card('card-comment', [label], [el('div', { class: 'comment-text' }, source.replace(/^%\s?/gm, ''))]);
    }
    if (kind === 'frontmatter') {
      const keys = [...source.matchAll(/^([\w-]+):/gm)].map((m) => m[1]);
      return this.card('card-frontmatter', [label, el('span', { class: 'muted' }, keys.join(', '))], []);
    }
    if (kind === 'table' || kind === 'definitionList' || kind === 'footnote') {
      const preview = el('div', { class: 'card-rendered' });
      preview.innerHTML = markdownPreview(source);
      return this.card(`card-${kind}`, [label], [preview]);
    }
    this.card('card-raw', [label], [el('pre', { class: 'card-source' }, source)]);
  }
}

// ---- code and math ------------------------------------------------------------------

class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private header = el('div', { class: 'code-header', contenteditable: 'false' });
  private langInput = el('input', { class: 'code-lang', placeholder: 'language', 'aria-label': 'Language' });
  private label = el('span', { class: 'code-label' });
  private options: HTMLButtonElement;

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: GetPos,
    private ctx: EditorContext,
  ) {
    this.contentDOM = el('code');
    this.dom = el('div', { class: 'code-block' }, this.header, el('pre', {}, this.contentDOM));
    this.langInput.addEventListener('input', () => {
      const v = this.langInput.value.trim();
      setAttrs(this.view, this.getPos, this.node, this.node.attrs.directive ? { args: v, lang: v } : { lang: v });
    });
    this.options = button('Options', 'Edit the options of this code block', async () => {
      const next = await this.ctx.ui.editOptions({
        title: `${this.label.textContent} options`,
        options: this.node.attrs.options,
        schema: this.ctx.config.editor.directives[this.node.attrs.name]?.options,
      });
      if (next) setAttrs(this.view, this.getPos, this.node, { options: next });
    });
    this.header.append(this.label, this.langInput, el('span', { class: 'spacer' }), this.options);
    this.render();
  }

  private render() {
    const { directive, name, args, lang, options } = this.node.attrs;
    const isCode = !directive || ['code-block', 'code', 'sourcecode', 'code-cell'].includes(name);
    const declared = this.ctx.config.editor.directives[name];
    this.label.textContent = declared?.label ?? (isCode ? 'Code' : name === 'eval-rst' ? 'reStructuredText' : name);
    this.langInput.hidden = !isCode;
    const value = directive ? args : lang;
    if (this.langInput.value !== value && document.activeElement !== this.langInput) this.langInput.value = value;
    this.options.hidden = !directive;
    this.options.textContent = optionCount(options);
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(e: Event) {
    return this.header.contains(e.target as Node);
  }

  ignoreMutation(m: ViewMutationRecord) {
    return !this.contentDOM.contains(m.target);
  }
}

class MathBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private preview = el('div', { class: 'math-preview', contenteditable: 'false' });
  private label = el('span', { class: 'math-label', contenteditable: 'false' });
  private rendered: string | null = null;

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: GetPos,
    decorations: readonly Decoration[],
  ) {
    this.contentDOM = el('pre', { class: 'math-source', spellcheck: 'false' });
    this.dom = el('div', { class: 'math-block' }, this.preview, this.label, this.contentDOM);
    this.preview.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      const end = pos + 1 + this.node.content.size;
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, end)));
      this.view.focus();
    });
    this.render(decorations);
  }

  private render(decorations: readonly Decoration[]) {
    const tex = this.node.textContent;
    if (tex !== this.rendered) {
      this.rendered = tex;
      renderMath(this.preview, tex || '\\text{(empty equation)}', true);
    }
    this.label.textContent = this.node.attrs.label ? `(${this.node.attrs.label})` : '';
    this.dom.classList.toggle('editing', decorations.some((d) => (d as Decoration & { spec: { mathEditing?: boolean } }).spec.mathEditing));
  }

  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render(decorations);
    return true;
  }

  ignoreMutation(m: ViewMutationRecord) {
    return !this.contentDOM.contains(m.target);
  }
}

// ---- inline atoms -------------------------------------------------------------------

abstract class InlineView implements NodeView {
  dom: HTMLElement;
  private unsubscribe: () => void;

  constructor(
    protected node: PMNode,
    protected view: EditorView,
    protected getPos: GetPos,
    protected ctx: EditorContext,
  ) {
    this.dom = el('span', { contenteditable: 'false' });
    this.dom.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (this.view.editable) this.edit();
    });
    this.render();
    // Cross-reference titles and broken-link marks come from the build.
    this.unsubscribe = ctx.subscribe(() => this.render());
  }

  destroy() {
    this.unsubscribe();
  }

  protected abstract render(): void;
  protected abstract edit(): void;

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    if (node.attrs !== this.node.attrs) {
      this.node = node;
      this.render();
    }
    return true;
  }

  ignoreMutation() {
    return true;
  }
}

const CODE_ROLES = new Set(['code', 'literal', 'file', 'samp', 'command', 'program', 'envvar', 'option', 'regexp', 'makevar', 'mailheader', 'mimetype', 'newsgroup', 'dfn']);

class RoleView extends InlineView {
  protected render() {
    const { name, value } = this.node.attrs as { name: string; value: string };
    const d = this.dom;
    d.className = 'role';
    d.removeAttribute('title');
    if (name === 'sub' || name === 'subscript') return d.replaceChildren(el('sub', {}, value));
    if (name === 'sup' || name === 'superscript') return d.replaceChildren(el('sup', {}, value));
    if (name === 'kbd') return d.replaceChildren(...value.split(/(\+|-(?=\w))/).map((k) => (/^[+-]$/.test(k) ? k : el('kbd', {}, k))));
    if (name === 'math') {
      d.classList.add('role-math');
      return renderMath(d, value, false);
    }
    if (name === 'abbr') {
      const { title, target } = splitRoleValue(value.replace(/\s*\(([^()]*)\)$/, ' <$1>'));
      d.replaceChildren(el('abbr', title ? { title: target } : {}, title ?? target));
      return;
    }
    if (name === 'guilabel' || name === 'menuselection') {
      d.classList.add('role-gui');
      return d.replaceChildren(value.replace(/&(\w)/g, '$1').replace(/-->/g, '▸'));
    }
    if (CODE_ROLES.has(name)) {
      d.classList.add('role-code');
      return d.replaceChildren(el('code', {}, value));
    }
    const declared = this.ctx.config.editor.roles[name];
    if (declared) {
      d.classList.add('role-custom');
      d.title = declared.url ? `${declared.label ?? name} (Ctrl+click to open)` : (declared.label ?? `{${name}} role`);
      return d.replaceChildren(el('span', { class: 'role-name' }, declared.label ?? name), value);
    }
    const { title, target } = splitRoleValue(value);
    if (REFERENCE_ROLES[name] || /:/.test(name)) {
      // Cross-references and domain roles such as {py:func}.
      d.classList.add('role-ref');
      if (/:/.test(name) && !REFERENCE_ROLES[name]) d.classList.add('role-code');
      const resolved = this.ctx.resolveRole(name, target);
      d.classList.toggle('role-broken', resolved.broken);
      d.title = resolved.broken
        ? `${REFERENCE_ROLES[name] ?? name} not found: ${target}`
        : `${REFERENCE_ROLES[name] ?? name}: ${target}${name === 'doc' ? ' (Ctrl+click to open)' : ''}`;
      const shown = title ?? resolved.title ?? (name === 'doc' ? this.ctx.pageTitle(target) : null) ?? target;
      d.replaceChildren(el('span', { class: 'role-arrow' }, resolved.broken ? '⚠' : '↗'), shown);
      return;
    }
    d.classList.add('role-unknown');
    d.title = `{${name}} role`;
    d.replaceChildren(el('span', { class: 'role-name' }, name), value);
  }

  protected async edit() {
    const next = await this.ctx.ui.editFields({
      title: 'Edit role',
      fields: [
        { key: 'name', label: 'Role', value: this.node.attrs.name, help: 'For example ref, doc, term or py:func' },
        {
          key: 'value',
          label: 'Content',
          value: this.node.attrs.value,
          help: 'A target, or "title <target>"',
          suggestions: (values) => this.ctx.suggest(values.name),
        },
      ],
    });
    if (next && next.name.trim()) setAttrs(this.view, this.getPos, this.node, { name: next.name.trim(), value: next.value });
  }

  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: EditorContext) {
    super(node, view, getPos, ctx);
    this.dom.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const { name, value } = this.node.attrs;
      const url = this.ctx.config.editor.roles[name]?.url;
      if (url) {
        e.preventDefault();
        window.open(url.replaceAll('{value}', encodeURIComponent(value)), '_blank');
      } else if (name === 'doc') {
        e.preventDefault();
        this.ctx.openDocument(splitRoleValue(value).target);
      }
    });
  }
}

class InlineMathView extends InlineView {
  protected render() {
    this.dom.className = 'inline-math';
    renderMath(this.dom, this.node.attrs.value, false);
  }

  protected async edit() {
    const next = await this.ctx.ui.editFields({
      title: 'Edit formula',
      fields: [{ key: 'value', label: 'LaTeX', value: this.node.attrs.value, placeholder: 'a^2 + b^2 = c^2' }],
    });
    if (next) setAttrs(this.view, this.getPos, this.node, { value: next.value });
  }
}

class RefLinkView extends InlineView {
  protected render() {
    const { href } = this.node.attrs;
    const resolved = this.ctx.resolveLink(href);
    this.dom.className = `role role-ref${resolved.broken ? ' role-broken' : ''}`;
    this.dom.title = resolved.broken ? `Link target not found: ${href}` : `Link to ${href} (title filled in by Sphinx)`;
    this.dom.replaceChildren(el('span', { class: 'role-arrow' }, resolved.broken ? '⚠' : '↗'), resolved.title ?? href.replace(/^#/, ''));
  }

  protected async edit() {
    const next = await this.ctx.ui.editFields({
      title: 'Edit link',
      fields: [{ key: 'href', label: 'Target', value: this.node.attrs.href, help: 'A label, page or URL' }],
    });
    if (next) setAttrs(this.view, this.getPos, this.node, { href: next.href });
  }
}

class FootnoteRefView extends InlineView {
  protected render() {
    this.dom.className = 'footnote-ref';
    this.dom.title = `Footnote ${this.node.attrs.label}`;
    this.dom.replaceChildren(el('sup', {}, `[${this.node.attrs.label}]`));
  }

  protected async edit() {
    const next = await this.ctx.ui.editFields({ title: 'Footnote', fields: [{ key: 'label', label: 'Label', value: this.node.attrs.label }] });
    if (next?.label) setAttrs(this.view, this.getPos, this.node, { label: next.label });
  }
}

class HtmlInlineView extends InlineView {
  private marker() {
    const settings = this.ctx.config.editor.conditions;
    return settings ? readMarker(this.node.attrs.value, settings.inline) : null;
  }

  protected render() {
    const marker = this.marker();
    if (marker?.kind === 'start') {
      const parsed = parseCondition(marker.expr);
      this.dom.className = 'cond-pill cond-pill-start';
      this.dom.title = `Shown only when ${parsed.ok ? describe(parsed.expr) : marker.expr} (double-click to change)`;
      this.dom.textContent = `if ${parsed.ok ? describe(parsed.expr) : marker.expr}`;
      return;
    }
    if (marker?.kind === 'end') {
      this.dom.className = 'cond-pill cond-pill-end';
      this.dom.title = 'End of the inline condition';
      this.dom.textContent = 'end';
      return;
    }
    this.dom.className = 'html-inline';
    this.dom.title = 'Inline HTML';
    this.dom.textContent = this.node.attrs.value;
  }

  protected async edit() {
    const settings = this.ctx.config.editor.conditions;
    const marker = this.marker();
    if (settings && marker?.kind === 'start') {
      const result = await this.ctx.ui.editCondition({ expr: marker.expr, settings, allowRemove: true });
      const pos = this.getPos();
      if (!result || pos === undefined) return;
      if ('remove' in result) removeCondition(settings, pos)(this.view.state, this.view.dispatch);
      else setAttrs(this.view, this.getPos, this.node, { value: withExpression(this.node.attrs.value, result.expr) });
      return;
    }
    if (marker) return;
    const next = await this.ctx.ui.editFields({ title: 'Inline HTML', fields: [{ key: 'value', label: 'HTML', value: this.node.attrs.value }] });
    if (next) setAttrs(this.view, this.getPos, this.node, { value: next.value });
  }
}

class ImageView extends InlineView {
  protected render() {
    const img = el('img', { src: this.ctx.assetUrl(this.node.attrs.src), alt: this.node.attrs.alt, draggable: 'false' });
    if (this.node.attrs.title) img.title = this.node.attrs.title;
    this.dom.className = 'inline-image';
    this.dom.replaceChildren(img);
  }

  protected async edit() {
    const next = await this.ctx.ui.editFields({
      title: 'Image',
      fields: [
        { key: 'src', label: 'Image file', value: this.node.attrs.src },
        { key: 'alt', label: 'Description', value: this.node.attrs.alt, help: 'Read aloud by screen readers' },
      ],
    });
    if (next) setAttrs(this.view, this.getPos, this.node, next);
  }
}

class TargetView extends InlineView {
  protected render() {
    this.dom.className = 'target';
    this.dom.title = 'Link target: other pages can refer to the next section with this label';
    this.dom.replaceChildren(el('span', { class: 'target-icon' }, '⚓'), this.node.attrs.label);
  }

  protected async edit() {
    const next = await this.ctx.ui.editFields({
      title: 'Link target',
      fields: [{ key: 'label', label: 'Label', value: this.node.attrs.label, help: 'Referenced elsewhere as {ref}`label`' }],
    });
    if (next?.label) setAttrs(this.view, this.getPos, this.node, { label: next.label.trim() });
  }
}

export function nodeViews(ctx: EditorContext): Record<string, NodeViewConstructor> {
  return {
    md_directive: (node, view, getPos) => new DirectiveView(node, view, getPos, ctx),
    opaque_directive: (node, view, getPos, decorations) => new OpaqueDirectiveView(node, view, getPos, ctx, decorations),
    raw_block: (node, view, getPos, decorations) => new RawBlockView(node, view, getPos, ctx, decorations),
    code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos, ctx),
    math_block: (node, view, getPos, decorations) => new MathBlockView(node, view, getPos, decorations),
    role: (node, view, getPos) => new RoleView(node, view, getPos, ctx),
    inline_math: (node, view, getPos) => new InlineMathView(node, view, getPos, ctx),
    ref_link: (node, view, getPos) => new RefLinkView(node, view, getPos, ctx),
    footnote_ref: (node, view, getPos) => new FootnoteRefView(node, view, getPos, ctx),
    html_inline: (node, view, getPos) => new HtmlInlineView(node, view, getPos, ctx),
    image: (node, view, getPos) => new ImageView(node, view, getPos, ctx),
    target: (node, view, getPos) => new TargetView(node, view, getPos, ctx),
  };
}
