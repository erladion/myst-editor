// An Antora component's contents: its navigation files (antora.yml's nav), lists of
// xrefs to its pages, nested as the contents are. Adding, moving and taking out a page
// changes its item there; the pages under it go with it (or, when it's taken out, up
// to where it was).
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { schema } from '../../../../core/schema';
import type { AsciidocConfig } from '../../../../core/asciidoc/config';
import { resolveResource, resourceIdFor, specStyle, type Antora } from '../../../../core/asciidoc/antora';
import { headingName, listName, readNav, splitXref, type NavItem, type NavList } from '../../../../core/asciidoc/nav';
import type { Project } from '../../../../shared/api';
import type { Contents } from '../contents';
import { fromComponent, inComponent } from './references';

const { nodes } = schema;

export const antoraOf = (project: Project | null): Antora | null => (project ? ((project.config as AsciidocConfig).antora ?? null) : null);

const stem = (file: string) => file.replace(/\.adoc$/, '');

// Every item in a navigation file, depth first.
function allItems(lists: NavList[]): NavItem[] {
  const out: NavItem[] = [];
  const add = (items: NavItem[]) => items.forEach((i) => (out.push(i), add(i.children)));
  lists.forEach((l) => add(l.items));
  return out;
}

// The items in `nav` (relative to the component) listing `page`.
function itemsFor(antora: Antora, nav: string, doc: PMNode, page: string): NavItem[] {
  return allItems(readNav(doc)).filter((i) => i.target !== null && resolveResource(antora, nav, i.target, 'page')?.file === page);
}

const itemNode = (target: string, children: PMNode[] = []) =>
  nodes.list_item.create({ marker: '*' }, [nodes.paragraph.create(null, nodes.role.create({ name: 'xref', value: target })), ...(children.length ? [nodes.bullet_list.create({ bullet: '*' }, children)] : [])]);

// Where an entry's pages are, in a navigation file: a list (the file's last, or a
// titled one), or the list under an item (made if it has none yet).
type Container = { kind: 'list'; list: NavList } | { kind: 'item'; item: NavItem } | { kind: 'end' };

function containerOf(antora: Antora, nav: string, doc: PMNode, entry: string | null): Container | null {
  const lists = readNav(doc);
  const name = stem(nav);
  if (entry === null || entry === name) return lists.length ? { kind: 'list', list: lists[lists.length - 1] } : { kind: 'end' };
  const list = lists.find((l) => listName(name, l.index) === entry);
  if (list) return { kind: 'list', list };
  const item = allItems(lists).find((i) => (i.heading !== null ? headingName(name, i.heading) === entry : i.target !== null && stem(resolveResource(antora, nav, i.target, 'page')?.file ?? '') === entry));
  return item ? { kind: 'item', item } : null;
}

// `items` put in the container, before the item for `before` (a page) if it's there,
// else at its end.
function insertInto(tr: Transaction, antora: Antora, nav: string, container: Container, before: string | null, items: PMNode[]): Transaction {
  const pageOf = (i: NavItem) => (i.target !== null ? (resolveResource(antora, nav, i.target, 'page')?.file ?? null) : null);
  if (container.kind === 'end') return tr.insert(tr.doc.content.size, nodes.bullet_list.create({ bullet: '*' }, items));
  if (container.kind === 'list') {
    const at = before ? container.list.items.find((i) => pageOf(i) === before) : undefined;
    return tr.insert(at ? at.pos : container.list.pos + container.list.node.nodeSize - 1, items);
  }
  const { item } = container;
  const at = before ? item.children.find((i) => pageOf(i) === before) : undefined;
  if (at) return tr.insert(at.pos, items);
  // Its list of pages: the last one in it, or a new one at its end.
  let sub: { pos: number; node: PMNode } | null = null;
  item.node.forEach((child, offset) => {
    if (child.type === nodes.bullet_list) sub = { pos: item.pos + 1 + offset, node: child };
  });
  if (sub) {
    const s = sub as { pos: number; node: PMNode };
    return tr.insert(s.pos + s.node.nodeSize - 1, items);
  }
  return tr.insert(item.pos + item.node.nodeSize - 1, nodes.bullet_list.create({ bullet: '*' }, items));
}

// `item` taken out, with what's under it (`lift`: what's under it stays, in its place).
function takeOut(tr: Transaction, item: NavItem, lift: boolean): Transaction {
  const from = tr.mapping.map(item.pos);
  const node = tr.doc.nodeAt(from)!;
  const under: PMNode[] = [];
  if (lift) node.forEach((child) => child.type === nodes.bullet_list && child.forEach((c) => under.push(c)));
  // The only item in its list: the list goes.
  const $from = tr.doc.resolve(from);
  if ($from.parent.childCount === 1 && !under.length) return tr.delete($from.before(), $from.after());
  return tr.replaceWith(from, from + node.nodeSize, under);
}

// The xrefs in moved items, written for the navigation file they're now in.
function rewritten(antora: Antora, fromNav: string, toNav: string, node: PMNode): PMNode {
  if (fromNav === toNav) return node;
  const map = (n: PMNode): PMNode => {
    if (n.type === nodes.role && n.attrs.name === 'xref') {
      const { text, target } = splitXref(n.attrs.value as string);
      const found = resolveResource(antora, fromNav, target, 'page');
      const id = found && resourceIdFor(toNav, found.file, 'page', specStyle(target));
      if (!id) return n;
      const spec = `${id}${found.fragment ? `#${found.fragment}` : ''}`;
      return nodes.role.create({ ...n.attrs, value: text ? `${text} <${spec}>` : spec });
    }
    if (n.isLeaf) return n;
    const children: PMNode[] = [];
    n.forEach((c) => children.push(map(c)));
    return n.copy(Fragment.from(children));
  };
  return map(node);
}

// ---- the edits, on a navigation file's page (exported for tests) --------------------

export function addToNav(state: EditorState, antora: Antora, nav: string, page: string): Transaction {
  const id = resourceIdFor(nav, page, 'page')!;
  return insertInto(state.tr, antora, nav, containerOf(antora, nav, state.doc, null)!, null, [itemNode(id)]);
}

export function removeFromNav(state: EditorState, antora: Antora, nav: string, page: string): Transaction {
  let tr = state.tr;
  for (const item of itemsFor(antora, nav, state.doc, page).reverse()) tr = takeOut(tr, item, true);
  return tr;
}

// Within one navigation file: `page`'s item (and what's under it) moved into `entry`.
export function moveInNav(state: EditorState, antora: Antora, nav: string, page: string, entry: string, before: string | null): Transaction | string {
  const item = itemsFor(antora, nav, state.doc, page)[0];
  const node = item ? state.doc.nodeAt(item.pos)! : itemNode(resourceIdFor(nav, page, 'page')!);
  let tr = state.tr;
  if (item) tr = takeOut(tr, item, false);
  const container = containerOf(antora, nav, tr.doc, entry);
  if (!container) return 'It isn’t in the navigation where it was dropped.';
  return insertInto(tr, antora, nav, container, before, [node]);
}

// Into another navigation file: what goes in, and taking it out of the first.
export function itemOf(state: EditorState, antora: Antora, nav: string, page: string, toNav: string): PMNode {
  const item = itemsFor(antora, nav, state.doc, page)[0];
  return item ? rewritten(antora, nav, toNav, state.doc.nodeAt(item.pos)!) : itemNode(resourceIdFor(toNav, page, 'page')!);
}

export function insertInNav(state: EditorState, antora: Antora, nav: string, node: PMNode, entry: string, before: string | null): Transaction | string {
  const container = containerOf(antora, nav, state.doc, entry);
  if (!container) return 'It isn’t in the navigation where it was dropped.';
  return insertInto(state.tr, antora, nav, container, before, [node]);
}

export function takeOutOfNav(state: EditorState, antora: Antora, nav: string, page: string): Transaction {
  const item = itemsFor(antora, nav, state.doc, page)[0];
  return item ? takeOut(state.tr, item, false) : state.tr;
}

// ---- the contents ------------------------------------------------------------------

export const antoraContents: Contents = {
  async pages(ws, project) {
    const antora = antoraOf(project);
    return antora ? antora.nav.map((n) => fromComponent(antora, n)).filter((f) => ws.project.files.includes(f)) : [];
  },

  add(ws, project, tocPage, page) {
    const antora = antoraOf(project)!;
    const nav = inComponent(antora, tocPage);
    return ws.edit(tocPage, (state) => addToNav(state, antora, nav, inComponent(antora, page)));
  },

  async listing(ws, project, _info, page) {
    const antora = antoraOf(project);
    if (!antora) return [];
    const out: string[] = [];
    for (const nav of await antoraContents.pages(ws, project, null, [])) {
      if (itemsFor(antora, inComponent(antora, nav), (await ws.stateOf(nav)).doc, inComponent(antora, page)).length) out.push(nav);
    }
    return out;
  },

  async remove(ws, project, pages, page) {
    const antora = antoraOf(project)!;
    const failed: string[] = [];
    for (const nav of pages) if (!(await ws.edit(nav, (state) => removeFromNav(state, antora, inComponent(antora, nav), inComponent(antora, page))))) failed.push(nav);
    return failed;
  },

  async move(ws, project, move) {
    const antora = antoraOf(project);
    if (!antora) return 'This isn’t an Antora component.';
    const navs = antora.nav.map((n) => fromComponent(antora, n));
    if (navs.includes(move.page)) return 'Headings and navigation files are moved in the navigation file itself.';
    const page = inComponent(antora, move.page);
    const before = move.before ? inComponent(antora, move.before) : null;
    const title = (p: string) => ws.project.titles[p] ?? p;
    // The navigation file it goes in: the one the entry is in, else (without the
    // entry's name) the page it's under, or the file itself.
    const entry = move.entries?.to ?? stem(inComponent(antora, move.to));
    const navOf = async (name: string | null, source: string | null): Promise<string | null> => {
      if (source && navs.includes(source)) return source;
      for (const nav of navs) {
        const doc = (await ws.stateOf(nav)).doc;
        if (name && containerOf(antora, inComponent(antora, nav), doc, name)) return nav;
      }
      return null;
    };
    const to = await navOf(entry, move.to);
    if (!to) return `“${title(move.to)}” isn’t in the navigation.`;
    // Where it is now: under the entry it moves out of, or wherever it's listed.
    let from: string | null = move.from ? await navOf(move.entries?.from ?? stem(inComponent(antora, move.from)), move.from) : null;
    if (from && !itemsFor(antora, inComponent(antora, from), (await ws.stateOf(from)).doc, page).length) from = null;
    if (!from) for (const nav of navs) if (itemsFor(antora, inComponent(antora, nav), (await ws.stateOf(nav)).doc, page).length) from = nav;
    const toNav = inComponent(antora, to);
    if (from === to || !from) {
      let error: string | null = null;
      const ok = await ws.edit(to, (state) => {
        const tr = moveInNav(state, antora, toNav, page, entry, before);
        if (typeof tr === 'string') {
          error = tr;
          return null;
        }
        return tr;
      });
      return error ?? (ok ? null : `“${title(to)}” is open in the source view or couldn’t be saved.`);
    }
    const fromNav = inComponent(antora, from);
    const node = itemOf(await ws.stateOf(from), antora, fromNav, page, toNav);
    let error: string | null = null;
    const ok = await ws.edit(to, (state) => {
      const tr = insertInNav(state, antora, toNav, node, entry, before);
      if (typeof tr === 'string') {
        error = tr;
        return null;
      }
      return tr;
    });
    if (error) return error;
    if (!ok) return `“${title(to)}” is open in the source view or couldn’t be saved.`;
    if (!(await ws.edit(from, (state) => takeOutOfNav(state, antora, fromNav, page)))) return `It’s now also in “${title(to)}”, but couldn’t be taken out of “${title(from)}”, which is open in the source view or couldn’t be saved.`;
    return null;
  },

  // A new page goes in its module's navigation, else the first.
  likely(project, folder, pages) {
    const antora = antoraOf(project);
    if (!antora) return null;
    const module = /^modules\/([^/]+)\//.exec(`${inComponent(antora, folder)}/`)?.[1];
    const own = pages.find((p) => module && inComponent(antora, p).startsWith(`modules/${module}/`));
    return own ?? pages[0] ?? null;
  },
};
