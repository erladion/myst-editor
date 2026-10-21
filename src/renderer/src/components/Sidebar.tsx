// Page tree: one section per Sphinx project in the opened folder, plus other files.
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { SphinxProject } from '../../../shared/api';
import type { SphinxInfo } from '../../../shared/sphinx';
import { projectFor } from '../../../shared/projects';
import { basename } from '../paths';
import { tocTree, type TocEntry } from '../sphinx';
import type { ContentsMove } from '../pages';
import { SearchPanel } from './SearchPanel';

interface Props {
  projectName: string;
  files: string[]; // relative to the opened folder
  titles: Record<string, string>;
  projects: SphinxProject[];
  builds: Record<string, SphinxInfo | null>; // by project id; when built, pages follow the toctree
  current: string | null;
  unsaved: Set<string>;
  onOpen: (path: string) => void;
  onOpenFolder: () => void;
  onNewPage: (folder: string | null) => void; // null: next to the current page
  onDeletePage: (path: string) => void;
  onMoveInContents: (move: ContentsMove) => Promise<string | null>; // an error, or null
  onHistory: (path: string) => void;
  onRename: (path: string) => void;
  // Search all pages, when open (focusKey refocuses its field).
  search: { focusKey: number } | null;
  saveAll: () => Promise<boolean>;
  onSearchResult: (path: string, line: number, query: string, caseSensitive: boolean) => void;
  onCloseSearch: () => void;
}

interface MenuItem {
  label: string;
  action: () => void;
}

// What right-clicking a page offers.
interface PageMenu {
  path: string;
  x: number;
  y: number;
  extra: MenuItem[]; // Move up / down, for pages in the contents
}

interface Folder {
  name: string;
  path: string;
  folders: Folder[];
  files: string[];
}

// A folder tree of `files`, shown relative to `base` ('' for none).
function buildTree(files: string[], base: string): Folder {
  const root: Folder = { name: '', path: base, folders: [], files: [] };
  for (const file of files) {
    const parts = (base ? file.slice(base.length + 1) : file).split('/');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, path: folder.path ? `${folder.path}/${part}` : part, folders: [], files: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  // index.md first, as the folder's landing page.
  const sort = (f: Folder) => {
    f.files.sort((a, b) => Number(basename(b) === 'index.md') - Number(basename(a) === 'index.md') || a.localeCompare(b));
    f.folders.forEach(sort);
  };
  sort(root);
  return root;
}

export function Sidebar({ projectName, files, titles, projects, builds, current, unsaved, onOpen, onOpenFolder, onNewPage, onDeletePage, onMoveInContents, onHistory, onRename, search, saveAll, onSearchResult, onCloseSearch }: Props) {
  const [menu, setMenu] = useState<PageMenu | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);
  // Right-click (or the context-menu key) on a page.
  const onPageMenu = (e: React.MouseEvent, path: string, extra: MenuItem[] = []) => {
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ path, x: e.clientX || box.left + 16, y: e.clientY || box.bottom, extra });
  };
  const [mode, setMode] = useState<'contents' | 'files'>('contents');
  const [filter, setFilter] = useState('');
  const anyBuilt = projects.some((p) => builds[p.id]);

  // Files grouped by the project they belong to.
  const sections = useMemo(() => {
    const byProject = new Map<string, string[]>();
    const other: string[] = [];
    for (const f of files) {
      const owner = projectFor(projects, f);
      if (owner) byProject.set(owner.id, [...(byProject.get(owner.id) ?? []), f]);
      else other.push(f);
    }
    return { byProject, other };
  }, [files, projects]);

  // A contents entry opens its page wherever it is in the folder (a page may sit in
  // another project's folder and still be in this one's contents).
  const allFiles = useMemo(() => new Set(files), [files]);
  const matches = filter ? files.filter((f) => `${titles[f] ?? ''} ${f}`.toLowerCase().includes(filter.toLowerCase())) : null;
  // Section headings only when there's more than one group of pages. Projects that
  // share a name (conf.py's `project`) are told apart by their folders.
  const headings = projects.length + (sections.other.length ? 1 : 0) > 1;
  const heading = (p: SphinxProject) => (projects.some((q) => q !== p && q.name === p.name) ? `${p.name} (${p.dir || 'top folder'})` : p.name);

  const fileItem = (file: string) => (
    <li key={file}>
      <button
        type="button"
        className={`page${file === current ? ' current' : ''}`}
        title={file}
        aria-current={file === current ? 'page' : undefined}
        onClick={() => onOpen(file)}
        onContextMenu={(e) => onPageMenu(e, file)}
      >
        <span className="page-title">{titles[file] ?? basename(file).replace(/\.md$/, '')}</span>
        {unsaved.has(file) && <span className="unsaved-dot" title="Unsaved changes" />}
      </button>
    </li>
  );

  return (
    <nav className="sidebar" aria-label="Pages">
      <div className="sidebar-header">
        <span className="project-name" title={projectName}>
          {projectName}
        </span>
        <button type="button" className="link-button" onClick={() => onNewPage(null)} title="Add a page next to the one that’s open (Ctrl+N)">
          New page
        </button>
        <button type="button" className="link-button" onClick={onOpenFolder} title="Open another documentation folder">
          Open…
        </button>
      </div>
      {search && <SearchPanel titles={titles} focusKey={search.focusKey} saveAll={saveAll} onOpen={onSearchResult} onClose={onCloseSearch} />}
      {!search && anyBuilt && (
        <div className="sidebar-modes" role="tablist" aria-label="Show pages as">
          <button type="button" role="tab" aria-selected={mode === 'contents'} onClick={() => setMode('contents')}>
            Contents
          </button>
          <button type="button" role="tab" aria-selected={mode === 'files'} onClick={() => setMode('files')}>
            Files
          </button>
        </div>
      )}
      {!search && <input className="filter" placeholder="Find a page" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a page" />}
      <div className="tree" hidden={!!search}>
        {matches ? (
          <ul>{matches.map(fileItem)}</ul>
        ) : (
          <>
            {projects.map((project) => (
              <section key={project.id} className="tree-section" aria-label={heading(project)}>
                {headings && (
                  <div className="section-name" title={project.confPy}>
                    {heading(project)}
                  </div>
                )}
                <ProjectPages
                  onPageMenu={onPageMenu}
                  onMove={onMoveInContents}
                  project={project}
                  files={sections.byProject.get(project.id) ?? []}
                  allFiles={allFiles}
                  info={mode === 'contents' ? builds[project.id] : null}
                  current={current}
                  unsaved={unsaved}
                  onOpen={onOpen}
                  fileItem={fileItem}
                />
              </section>
            ))}
            {sections.other.length > 0 && (
              <section className="tree-section" aria-label="Other files">
                {headings && <div className="section-name">Other files</div>}
                <FolderView folder={buildTree(sections.other, '')} depth={0} current={current} fileItem={fileItem} />
              </section>
            )}
          </>
        )}
        {!files.length && <p className="muted pad">No Markdown pages found in this folder.</p>}
      </div>
      {menu && (
        <div className="menu-items page-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {[
            ['Open', () => onOpen(menu.path)],
            ...menu.extra.map((m) => [m.label, m.action]),
            ['History…', () => onHistory(menu.path)],
            ['Rename or move…', () => onRename(menu.path)],
            ['New page here…', () => onNewPage(menu.path.includes('/') ? menu.path.slice(0, menu.path.lastIndexOf('/')) : '')],
            ['Delete page…', () => onDeletePage(menu.path)],
          ].map(([label, action]) => (
            <button
              key={label as string}
              type="button"
              role="menuitem"
              className={label === 'Delete page…' ? 'danger' : undefined}
              onClick={() => {
                setMenu(null);
                (action as () => void)();
              }}
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

interface ProjectPagesProps {
  onPageMenu: (e: React.MouseEvent, path: string, extra?: MenuItem[]) => void;
  onMove: (move: ContentsMove) => Promise<string | null>; // an error, or null
  project: SphinxProject;
  files: string[];
  allFiles: Set<string>;
  info: SphinxInfo | null | undefined; // shown as contents when present
  current: string | null;
  unsaved: Set<string>;
  onOpen: (path: string) => void;
  fileItem: (file: string) => ReactElement;
}

function ProjectPages({ onPageMenu, onMove, project, files, allFiles, info, current, unsaved, onOpen, fileItem }: ProjectPagesProps) {
  // The order of pages just moved, until the next build shows them where they now are.
  const [order, setOrder] = useState<Record<string, string[]>>({});
  useEffect(() => setOrder({}), [info]);
  const toc = useMemo(() => (info ? tocTree(info, order) : null), [info, order]);
  // Entries the writer opened or closed; the rest show the top level, and the way to
  // the current page. Kept by page name, so a new build doesn't reset them.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const ancestors = useMemo(() => (toc && current ? ancestorsOf(toc.root, current) : []), [toc, current]);
  // Opening a page inside a closed entry shows it.
  useEffect(() => {
    if (ancestors.some((d) => chosen[d] === false)) setChosen((c) => ({ ...c, ...Object.fromEntries(ancestors.map((d) => [d, true])) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ancestors]);
  const [drag, setDrag] = useState<TocEntry | null>(null);
  const [dropAt, setDropAt] = useState<DropAt | null>(null);
  const byName = useMemo(() => {
    const map = new Map<string, TocEntry>();
    const add = (e: TocEntry) => {
      map.set(e.docname, e);
      e.children.forEach(add);
    };
    if (toc?.root) add(toc.root);
    toc?.orphans.forEach(add);
    return map;
  }, [toc]);
  if (!toc) return <FolderView folder={buildTree(files, project.dir)} depth={0} current={current} fileItem={fileItem} />;

  const childrenOf = (d: string) => byName.get(d)?.children.map((c) => c.docname) ?? [];
  const within = (d: string, ancestor: string) => {
    for (let e = byName.get(d); e; e = e.parent ? byName.get(e.parent) : undefined) if (e.docname === ancestor) return true;
    return false;
  };
  // What dropping `moved` there would do (and the order to show meanwhile), or null
  // if it can't go there: onto itself or a page inside it, or next to the top page.
  const plan = (moved: TocEntry, at: DropAt): { move: ContentsMove; order: Record<string, string[]>; parent: string } | null => {
    const target = byName.get(at.docname);
    if (!target || within(target.docname, moved.docname)) return null;
    const parentName = at.where === 'into' ? target.docname : target.parent;
    const parent = parentName ? byName.get(parentName) : undefined;
    if (!parentName || !parent || !allFiles.has(parent.source)) return null;
    const siblings = childrenOf(parentName).filter((c) => c !== moved.docname);
    const index = at.where === 'into' ? siblings.length : siblings.indexOf(target.docname) + (at.where === 'after' ? 1 : 0);
    const placed = [...siblings.slice(0, index), moved.docname, ...siblings.slice(index)];
    if (moved.parent === parentName && placed.join('\0') === childrenOf(parentName).join('\0')) return null; // where it is already
    const next = { ...order };
    if (moved.parent) next[moved.parent] = childrenOf(moved.parent).filter((c) => c !== moved.docname);
    next[parentName] = placed;
    const before = placed[index + 1];
    return {
      move: { page: moved.source, from: moved.parent ? byName.get(moved.parent)!.source : null, to: parent.source, before: before ? byName.get(before)!.source : null },
      order: next,
      parent: parentName,
    };
  };
  const apply = async (p: NonNullable<ReturnType<typeof plan>>) => {
    const before = order;
    setOrder(p.order);
    setChosen((c) => ({ ...c, [p.parent]: true })); // show where it went
    if (await onMove(p.move)) setOrder(before); // it didn't work: show it as it was
  };
  const tree: TreeProps = {
    files: allFiles,
    current,
    unsaved,
    onOpen,
    isOpen: (e, depth) => chosen[e.docname] ?? (depth === 0 || ancestors.includes(e.docname)),
    toggle: (e, open) => setChosen((c) => ({ ...c, [e.docname]: open })),
    // The top page stays at the top; every other page (listed or not) can move.
    draggable: (e) => allFiles.has(e.source) && e.docname !== toc.root?.docname,
    dropAt,
    onDragStart: setDrag,
    onDragOver: (e, at) => {
      if (!drag) return false;
      const ok = !!plan(drag, at);
      setDropAt(ok ? at : null);
      return ok;
    },
    onDrop: () => {
      const p = drag && dropAt && plan(drag, dropAt);
      setDrag(null);
      setDropAt(null);
      if (p) void apply(p);
    },
    onDragEnd: () => {
      setDrag(null);
      setDropAt(null);
    },
    // Right-click: Move up / Move down, among the pages next to it.
    onPageMenu: (e, entry) => {
      const siblings = entry.parent ? childrenOf(entry.parent) : [];
      const i = siblings.indexOf(entry.docname);
      const up = i > 0 ? plan(entry, { docname: siblings[i - 1], where: 'before' }) : null;
      const down = i >= 0 && i < siblings.length - 1 ? plan(entry, { docname: siblings[i + 1], where: 'after' }) : null;
      onPageMenu(e, entry.source, [
        ...(up ? [{ label: 'Move up', action: () => void apply(up) }] : []),
        ...(down ? [{ label: 'Move down', action: () => void apply(down) }] : []),
      ]);
    },
  };
  return (
    <>
      {toc.root && <ul>{tocItem(toc.root, tree, 0)}</ul>}
      {toc.orphans.length > 0 && (
        <>
          <div className="folder-name static" title="Pages that no table of contents links to. Drag one into the contents to add it.">
            Not in the contents
          </div>
          <ul>{toc.orphans.map((o) => tocItem(o, tree, 0))}</ul>
        </>
      )}
    </>
  );
}

// Page names from the root down to (not including) the entry for `source`.
function ancestorsOf(root: TocEntry | null, source: string): string[] {
  const path: string[] = [];
  const find = (e: TocEntry): boolean => {
    if (e.source === source) return true;
    path.push(e.docname);
    if (e.children.some(find)) return true;
    path.pop();
    return false;
  };
  return root && find(root) ? path : [];
}

// Where a dragged page would go: before or after a page, or into its contents.
interface DropAt {
  docname: string;
  where: 'before' | 'after' | 'into';
}

interface TreeProps {
  files: Set<string>;
  current: string | null;
  unsaved: Set<string>;
  onOpen: (path: string) => void;
  onPageMenu: (e: React.MouseEvent, entry: TocEntry) => void;
  isOpen: (entry: TocEntry, depth: number) => boolean;
  toggle: (entry: TocEntry, open: boolean) => void;
  draggable: (entry: TocEntry) => boolean;
  dropAt: DropAt | null;
  onDragStart: (entry: TocEntry) => void;
  onDragOver: (e: React.DragEvent, at: DropAt) => boolean; // whether it can go there
  onDrop: () => void;
  onDragEnd: () => void;
}

function tocItem(entry: TocEntry, tree: TreeProps, depth: number): ReactElement {
  const { files, current, unsaved, onOpen } = tree;
  const editable = files.has(entry.source);
  const parent = entry.children.length > 0;
  const open = parent && tree.isOpen(entry, depth);
  const drop = tree.dropAt?.docname === entry.docname ? ` drop-${tree.dropAt.where}` : '';
  return (
    <li key={entry.docname}>
      <div
        className={`toc-row${drop}`}
        style={{ paddingLeft: depth * 14 }}
        draggable={tree.draggable(entry)}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', entry.title);
          tree.onDragStart(entry);
        }}
        onDragOver={(e) => {
          // Top third: before it; bottom third: after it; middle: into its contents.
          const box = e.currentTarget.getBoundingClientRect();
          const y = (e.clientY - box.top) / box.height;
          const where = y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'into';
          if (tree.onDragOver(e, { docname: entry.docname, where })) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          tree.onDrop();
        }}
        onDragEnd={tree.onDragEnd}
      >
        {parent ? (
          <button
            type="button"
            className="toc-toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} the pages in ${entry.title}`}
            title={open ? 'Hide the pages in it' : 'Show the pages in it'}
            onClick={() => tree.toggle(entry, !open)}
          >
            <span className="chevron">{open ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="toc-toggle" aria-hidden="true" />
        )}
        <button
          type="button"
          className={`page${entry.source === current ? ' current' : ''}`}
          title={editable ? `${entry.source} (drag to move it in the contents)` : `${entry.source} isn’t a Markdown page`}
          aria-current={entry.source === current ? 'page' : undefined}
          disabled={!editable}
          onClick={() => onOpen(entry.source)}
          onContextMenu={(e) => editable && tree.onPageMenu(e, entry)}
        >
          <span className="page-title">{entry.title}</span>
          {unsaved.has(entry.source) && <span className="unsaved-dot" title="Unsaved changes" />}
        </button>
      </div>
      {open && <ul>{entry.children.map((c) => tocItem(c, tree, depth + 1))}</ul>}
    </li>
  );
}

function FolderView({ folder, depth, current, fileItem }: { folder: Folder; depth: number; current: string | null; fileItem: (f: string) => ReactElement }) {
  const containsCurrent = !!current && (folder.path === '' || current.startsWith(folder.path + '/'));
  const [isOpen, setOpen] = useState(depth === 0 || containsCurrent);
  // Opening a page in a closed folder shows it.
  useEffect(() => {
    if (containsCurrent) setOpen(true);
  }, [containsCurrent, current]);
  const children = (
    <ul>
      {folder.files.map(fileItem)}
      {folder.folders.map((f) => (
        <li key={f.path}>
          <FolderView folder={f} depth={depth + 1} current={current} fileItem={fileItem} />
        </li>
      ))}
    </ul>
  );
  if (depth === 0) return children;
  return (
    <div className="folder">
      <button type="button" className="folder-name" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
        <span className="chevron">{isOpen ? '▾' : '▸'}</span>
        {folder.name}
      </button>
      {isOpen && children}
    </div>
  );
}
