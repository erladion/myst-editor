// Node views: how MyST constructs look and behave in the editor.
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { Decoration, EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';
import { createTokenizer } from 'myst-parser';
import { splitDirective } from '../../../core/directive';
import { loadDocument } from '../../../core/document';
import type { EditorContext } from './context';
import { ICONS } from './tones';
import { REFERENCE_ROLES, splitRoleValue } from '../formats/myst/directives';
import { editingFor } from '../formats/editing';
import { renderMath } from './math';
import { describe, parseCondition, readMarker, unknownNames, withExpression } from '../../../core/conditions';
import { condStripes, conditionColor, conditionsKey, exprVisible, removeCondition, tocConditionsOf } from './conditions';
import { FORMATTING, LINE_BREAKS, inlineTag, lineTagOf, safeHtml } from './html';

// "A or B and not C" with the capability names as chips.
function conditionChips(text: string): Node[] {
  return text.split(/(\s+|[()])/).filter(Boolean).map((part) =>
    /^(and|or|not|\(|\)|\s+)$/i.test(part) ? document.createTextNode(part) : el('span', { class: 'cond-name' }, part),
  );
}

type GetPos = () => number | undefined;

// A node view's own classes, leaving alone those ProseMirror's decorations add
// (conditions, checks): it only adds them again when they change, so a view that
// redraws must not take them off.
const ownClasses = new WeakMap<HTMLElement, string[]>();
function setOwnClass(dom: HTMLElement, cls: string) {
  dom.classList.remove(...(ownClasses.get(dom) ?? []));
  const next = cls.split(/\s+/).filter(Boolean);
  dom.classList.add(...next);
  ownClasses.set(dom, next);
}

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
// A Markdown block (a table, say) rendered for a card, with the HTML in it shown
// as it looks (see html.ts for what's allowed).
function markdownPreview(source: string, assetUrl: (src: string) => string): DocumentFragment {
  tokenizer ??= createTokenizer({ markdownit: { html: true } });
  try {
    return safeHtml(tokenizer.render(source), assetUrl);
  } catch {
    return document.createDocumentFragment();
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
    const info = editingFor(this.ctx.config).block(name, this.ctx.config.editor);
    setOwnClass(this.dom, `directive tone-${info.tone} directive-${name}`);
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
    const info = editingFor(this.ctx.config).block(name, this.ctx.config.editor);
    const schema = this.ctx.config.editor.directives[name]?.options;
    const parts: Node[] = [icon(ICONS[info.tone])];

    const callouts = editingFor(this.ctx.config).callouts;
    if (callouts.is(name)) {
      const select = el('select', { class: 'directive-kind', title: 'Change the type of this callout' });
      const names = callouts.names.includes(name) ? callouts.names : [name, ...callouts.names];
      for (const n of names) select.append(el('option', { value: n }, callouts.label(n)));
      select.value = name;
      select.addEventListener('change', () => setAttrs(this.view, this.getPos, this.node, callouts.change(name, select.value, args)));
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
    // Figures and tables: the name cross-references use.
    if (name === 'figure' || name === 'table') parts.push(this.nameButton(name));
    parts.push(
      button(optionCount(options), 'Edit the options of this block', async () => {
        const next = await this.ctx.ui.editOptions({ title: `${info.label} options`, options: this.node.attrs.options, schema });
        if (next) setAttrs(this.view, this.getPos, this.node, { options: next });
      }),
    );
    parts.push(button('✕', 'Remove this block', () => deleteNode(this.view, this.getPos, this.node), 'danger'));
    this.header.replaceChildren(...parts);
  }

  private nameButton(kind: string): HTMLButtonElement {
    const current = (this.node.attrs.options as [string, string][]).find(([k]) => k === 'name')?.[1] ?? '';
    const what = kind === 'figure' ? 'figure' : 'table';
    const b = button(current ? `#${current}` : '# Name', current ? `Other places refer to this ${what} as ${current}` : `Give this ${what} a name, to refer to it from other places`, async () => {
      const values = await this.ctx.ui.editFields({
        title: `Name of the ${what}`,
        submit: 'Save',
        fields: [{ key: 'name', label: 'Name', value: current, placeholder: kind === 'figure' ? 'fig-architecture' : 'table-regions', help: 'Insert → Cross-reference finds it by this. Empty: no name.' }],
      });
      if (!values) return;
      const value = values.name.trim();
      const rest = (this.node.attrs.options as [string, string][]).filter(([k]) => k !== 'name');
      setAttrs(this.view, this.getPos, this.node, { options: value ? [...rest, ['name', value]] : rest });
    });
    b.classList.add('directive-name');
    return b;
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
  private shown: HTMLIFrameElement | null = null; // the preview frame in the card
  private pending: HTMLIFrameElement | null = null; // a newer one, loading
  private fallback: HTMLElement | null = null;
  private badge: HTMLElement | null = null;

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

  // `preview`: whether the build's rendering may stand in for `body`.
  protected card(cls: string, title: Node[], body: Node[], preview = true) {
    setOwnClass(this.dom, `card ${cls}`);
    const header = el('div', { class: 'card-header' }, ...title, el('span', { class: 'spacer' }), button('Edit…', 'Edit the source of this block', () => this.edit()));
    if (this.previewId) previewListeners.delete(this.previewId);
    this.previewId = null;
    this.shown = this.pending = null;
    if (!this.previewUrl || !preview) return this.dom.replaceChildren(header, ...body);

    // The built HTML in a sandboxed frame on the build's own origin; the card's own
    // preview stays as the fallback until the frame says it has something to show.
    this.fallback = el('div', { class: 'card-fallback' }, ...body);
    this.badge = el('span', { class: 'card-badge', title: 'Rendered by the project’s Sphinx build' }, 'as built');
    header.insertBefore(this.badge, header.querySelector('.spacer'));
    this.badge.hidden = true;
    this.dom.replaceChildren(header, this.fallback);
    this.loadPreview(this.previewUrl);
  }

  // After a build, the new preview loads out of sight, as wide as the one shown, and
  // replaces it once it has its height: the card doesn't collapse and grow back.
  private loadPreview(url: string) {
    if (this.previewId) previewListeners.delete(this.previewId);
    this.pending?.remove();
    const id = `p${++previewCounter}`;
    const frame = el('iframe', {
      class: 'card-preview',
      title: 'Preview from the Sphinx build',
      sandbox: 'allow-scripts allow-same-origin',
      src: `${url}&id=${id}`,
    });
    if (this.shown) {
      frame.classList.add('card-preview-next');
      frame.style.width = `${this.shown.offsetWidth}px`;
      this.pending = frame;
    } else {
      frame.hidden = true;
      this.shown = frame;
    }
    previewListeners.set(id, ({ height, empty }) => {
      if (frame === this.pending) {
        this.shown?.remove();
        frame.classList.remove('card-preview-next');
        frame.style.width = '';
        this.shown = frame;
        this.pending = null;
      }
      frame.hidden = empty;
      this.fallback!.hidden = !empty;
      this.badge!.hidden = empty;
      frame.style.height = `${Math.min(height, 2000)}px`;
    });
    this.previewId = id;
    this.dom.insertBefore(frame, this.fallback);
  }

  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    const url = previewUrlOf(decorations);
    const sameBlock = node.attrs === this.node.attrs;
    this.node = node;
    if (sameBlock && url === this.previewUrl) return true;
    this.previewUrl = url;
    // Only a new build: swap the preview. Otherwise (edited, or no preview now) redraw.
    if (sameBlock && url && this.shown && !this.shown.hidden) this.loadPreview(url);
    else this.render();
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
  private tocConditions: string | null = null; // "View as", for a toctree with conditions

  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: EditorContext, decorations: readonly Decoration[] = []) {
    super(node, view, getPos, ctx, decorations);
    this.tocConditions = tocConditionsOf(decorations);
  }

  protected editTitle() {
    return `Edit {${this.node.attrs.name}} block`;
  }

  update(node: PMNode, decorations: readonly Decoration[]) {
    const tocConditions = tocConditionsOf(decorations);
    if (node.type !== this.node.type || tocConditions === this.tocConditions) return super.update(node, decorations);
    // "View as" changed: what's greyed out among the entries.
    this.tocConditions = tocConditions;
    this.node = node;
    this.previewUrl = previewUrlOf(decorations);
    this.render();
    return true;
  }

  // A toctree's entries, as links, and its conditions' markers among them: each
  // condition named in its colour, its entries with its stripe, greyed out when
  // "View as" leaves them out.
  private tocItems(body: string): { items: HTMLElement[]; conditional: boolean } {
    const settings = this.ctx.config.editor.conditions;
    const viewAs = conditionsKey.getState(this.view.state)?.viewAs ?? null;
    const items: HTMLElement[] = [];
    const open: { color: string; hidden: boolean; li: HTMLElement }[] = [];
    let conditional = false;
    for (const line of body.split('\n').map((l) => l.trim())) {
      if (!line || line.startsWith(':')) continue;
      const marker = settings && readMarker(line, settings.block);
      if (settings && marker) {
        conditional = true;
        if (marker.kind === 'end') {
          if (open.pop()) continue;
          items.push(el('li', { class: 'cond-start toc-cond cond-unmatched', title: 'This end marker has no matching start' }, 'End of a condition that wasn’t started'));
          continue;
        }
        const parsed = parseCondition(marker.expr);
        const problem = !parsed.ok ? parsed.error : unknownNames(parsed.names, settings).map((n) => `Unknown capability “${n}”`).join('\n');
        const color = conditionColor(marker.expr, settings);
        const hidden = open.some((o) => o.hidden) || (parsed.ok && !exprVisible(parsed.expr, settings, viewAs));
        const li = el(
          'li',
          { class: `cond-start toc-cond${problem ? ' cond-problem' : ''}${hidden ? ' cond-off' : ''}`, style: `--cond: ${color}`, ...(problem ? { title: problem } : {}) },
          el('span', { class: 'cond-label' }, 'Shown only when'),
          el('span', { class: 'cond-expr' }, ...(parsed.ok ? conditionChips(describe(parsed.expr)) : [marker.expr])),
        );
        items.push(li);
        open.push({ color, hidden, li });
        continue;
      }
      const { title, target } = splitRoleValue(line);
      const a = el('a', { href: '#', title: `Open ${target}` }, title ?? this.ctx.pageTitle(target) ?? target);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        this.ctx.openDocument(target);
      });
      if (!open.length) {
        items.push(el('li', {}, a));
        continue;
      }
      const { depth, style } = condStripes(open.map((o) => o.color));
      items.push(el('li', { class: `cond-in cond-d${depth}${open.some((o) => o.hidden) ? ' cond-off' : ''}`, style }, a));
    }
    for (const { li } of open) {
      li.classList.add('cond-unmatched');
      li.title = 'This condition has no end marker';
    }
    return { items, conditional };
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
      const caption = options.find(([k]: string[]) => k === 'caption')?.[1];
      const { items, conditional } = this.tocItems(body);
      // With conditions among the entries, the card shows them all, marked; the build
      // would show only those of its own capabilities.
      return this.card('card-toc', [label('Table of contents'), ...(caption ? [el('span', { class: 'muted' }, caption)] : [])], [el('ul', { class: 'toc-entries' }, ...items)], !conditional);
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
      setOwnClass(this.dom, 'cond-end-line');
      this.dom.title = 'End of the condition';
      return this.dom.replaceChildren(el('span', {}, 'end of condition'));
    }
    const parsed = parseCondition(marker.expr);
    const pos = () => this.getPos();
    setOwnClass(this.dom, 'cond-start');
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
      const preview = el('div', { class: 'card-rendered' }, markdownPreview(source, (src) => this.ctx.assetUrl(src)));
      return this.card(`card-${kind}`, [label], [preview]);
    }
    // An HTML block shows what it looks like; one that shows nothing (a comment, say)
    // shows its source.
    if (kind === 'html') {
      const rendered = safeHtml(source, (src) => this.ctx.assetUrl(src));
      if (rendered.textContent?.trim() || rendered.querySelector?.('img, hr')) {
        return this.card('card-raw card-html', [label], [el('div', { class: 'card-rendered html-rendered' }, rendered)]);
      }
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
    protected decorations: readonly Decoration[] = [],
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

  update(node: PMNode, decorations: readonly Decoration[] = []) {
    if (node.type !== this.node.type) return false;
    const marks = (ds: readonly Decoration[]) => JSON.stringify(ds.map((d) => (d as Decoration & { spec: unknown }).spec));
    if (node.attrs !== this.node.attrs || marks(decorations) !== marks(this.decorations)) {
      this.node = node;
      this.decorations = decorations;
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
    setOwnClass(this.dom, 'inline-math');
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
    setOwnClass(this.dom, `role role-ref${resolved.broken ? ' role-broken' : ''}`);
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
    setOwnClass(this.dom, 'footnote-ref');
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
      setOwnClass(this.dom, 'cond-pill cond-pill-start');
      this.dom.title = `Shown only when ${parsed.ok ? describe(parsed.expr) : marker.expr} (double-click to change)`;
      this.dom.textContent = `if ${parsed.ok ? describe(parsed.expr) : marker.expr}`;
      return;
    }
    if (marker?.kind === 'end') {
      setOwnClass(this.dom, 'cond-pill cond-pill-end');
      this.dom.title = 'End of the inline condition';
      this.dom.textContent = 'end';
      return;
    }
    this.renderHtml(this.node.attrs.value);
  }

  // Common tags look like what they do: a line break, a list item's bullet, or
  // nothing (the text between <b> and </b> shows bold). Selecting one shows the tag.
  private renderHtml(value: string) {
    const tag = inlineTag(value);
    this.dom.dataset.raw = value;
    this.dom.title = `${value} (HTML; double-click to edit)`;
    const shown = (cls: string, ...children: Node[]) => {
      setOwnClass(this.dom, `html-tag ${cls}`);
      this.dom.replaceChildren(...children);
    };
    if (!tag || (tag.attrs && !['a', 'span', 'img', 'ol', 'li', 'td', 'th'].includes(tag.name))) {
      setOwnClass(this.dom, 'html-inline');
      this.dom.title = 'Inline HTML (double-click to edit)';
      this.dom.textContent = value;
      return;
    }
    if (tag.name === 'br') return shown('html-br', document.createElement('br'));
    const line = lineTagOf(this.decorations);
    const lineBreak = line?.lineBreak ? [document.createElement('br')] : [];
    if (tag.name === 'li' && tag.kind === 'open') {
      const marker = el('span', { class: 'html-li-marker' }, line?.marker ?? '•');
      marker.style.marginLeft = `${((line?.depth ?? 1) - 1) * 1.4}em`;
      return shown('html-li', ...lineBreak, marker);
    }
    if (tag.name === 'img') {
      const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(value);
      const alt = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(value);
      const img = el('img', { src: this.ctx.assetUrl(src?.[1] ?? src?.[2] ?? src?.[3] ?? ''), alt: alt?.[1] ?? alt?.[2] ?? '', draggable: 'false' });
      return shown('html-img', img);
    }
    // Ends of block-level tags start a new line too, so text after a list is below it.
    if (LINE_BREAKS.has(tag.name) && !(tag.name === 'li' && tag.kind === 'close')) return shown(lineBreak.length ? 'html-block' : 'html-hidden', ...lineBreak);
    if (tag.name in FORMATTING || tag.name === 'a' || tag.name === 'span' || tag.name === 'li') return shown('html-hidden');
    setOwnClass(this.dom, 'html-inline');
    this.dom.textContent = value;
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
    img.title = this.node.attrs.title ?? (this.node.attrs.alt ? `${this.node.attrs.alt} (double-click to change)` : 'Double-click to describe this image or change it');
    // Added, not set: a check's mark (a decoration's class) stays.
    this.dom.classList.add('inline-image');
    this.dom.replaceChildren(img);
  }

  protected async edit() {
    const next = await this.ctx.ui.editFields({
      title: 'Image',
      fields: [
        { key: 'src', label: 'Image file', value: this.node.attrs.src, browse: () => this.ctx.chooseImage() },
        { key: 'alt', label: 'Description', value: this.node.attrs.alt, help: 'Read aloud by screen readers' },
      ],
    });
    if (next) setAttrs(this.view, this.getPos, this.node, next);
  }
}

class TargetView extends InlineView {
  protected render() {
    setOwnClass(this.dom, 'target');
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
    html_inline: (node, view, getPos, decorations) => new HtmlInlineView(node, view, getPos, ctx, decorations),
    image: (node, view, getPos) => new ImageView(node, view, getPos, ctx),
    target: (node, view, getPos) => new TargetView(node, view, getPos, ctx),
  };
}
