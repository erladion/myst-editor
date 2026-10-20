// Page tree: one section per Sphinx project in the opened folder, plus other files.
import { useMemo, useState, type ReactElement } from 'react';
import type { SphinxProject } from '../../../shared/api';
import type { SphinxInfo } from '../../../shared/sphinx';
import { projectFor } from '../../../shared/projects';
import { basename } from '../paths';
import { tocTree, type TocEntry } from '../sphinx';

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

export function Sidebar({ projectName, files, titles, projects, builds, current, unsaved, onOpen, onOpenFolder }: Props) {
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

  const matches = filter ? files.filter((f) => `${titles[f] ?? ''} ${f}`.toLowerCase().includes(filter.toLowerCase())) : null;
  // Section headings only when there's more than one group of pages.
  const headings = projects.length + (sections.other.length ? 1 : 0) > 1;

  const fileItem = (file: string) => (
    <li key={file}>
      <button
        type="button"
        className={`page${file === current ? ' current' : ''}`}
        title={file}
        aria-current={file === current ? 'page' : undefined}
        onClick={() => onOpen(file)}
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
        <button type="button" className="link-button" onClick={onOpenFolder} title="Open another documentation folder">
          Open…
        </button>
      </div>
      {anyBuilt && (
        <div className="sidebar-modes" role="tablist" aria-label="Show pages as">
          <button type="button" role="tab" aria-selected={mode === 'contents'} onClick={() => setMode('contents')}>
            Contents
          </button>
          <button type="button" role="tab" aria-selected={mode === 'files'} onClick={() => setMode('files')}>
            Files
          </button>
        </div>
      )}
      <input className="filter" placeholder="Find a page" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a page" />
      <div className="tree">
        {matches ? (
          <ul>{matches.map(fileItem)}</ul>
        ) : (
          <>
            {projects.map((project) => (
              <section key={project.id} className="tree-section" aria-label={project.name}>
                {headings && (
                  <div className="section-name" title={project.confPy}>
                    {project.name}
                  </div>
                )}
                <ProjectPages
                  project={project}
                  files={sections.byProject.get(project.id) ?? []}
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
    </nav>
  );
}

interface ProjectPagesProps {
  project: SphinxProject;
  files: string[];
  info: SphinxInfo | null | undefined; // shown as contents when present
  current: string | null;
  unsaved: Set<string>;
  onOpen: (path: string) => void;
  fileItem: (file: string) => ReactElement;
}

function ProjectPages({ project, files, info, current, unsaved, onOpen, fileItem }: ProjectPagesProps) {
  const toc = useMemo(() => (info ? tocTree(info) : null), [info]);
  if (!toc) return <FolderView folder={buildTree(files, project.dir)} depth={0} current={current} fileItem={fileItem} />;
  return (
    <>
      {toc.root && <ul>{tocItem(toc.root, files, current, unsaved, onOpen, 0)}</ul>}
      {toc.orphans.length > 0 && (
        <>
          <div className="folder-name static" title="Pages that no table of contents links to">
            Not in the contents
          </div>
          <ul>{toc.orphans.map((o) => tocItem(o, files, current, unsaved, onOpen, 0))}</ul>
        </>
      )}
    </>
  );
}

function tocItem(entry: TocEntry, files: string[], current: string | null, unsaved: Set<string>, onOpen: (p: string) => void, depth: number): ReactElement {
  const editable = files.includes(entry.source);
  return (
    <li key={entry.docname}>
      <button
        type="button"
        className={`page${entry.source === current ? ' current' : ''}`}
        style={{ paddingLeft: 14 + depth * 14 }}
        title={editable ? entry.source : `${entry.source} isn’t a Markdown page`}
        aria-current={entry.source === current ? 'page' : undefined}
        disabled={!editable}
        onClick={() => onOpen(entry.source)}
      >
        <span className="page-title">{entry.title}</span>
        {unsaved.has(entry.source) && <span className="unsaved-dot" title="Unsaved changes" />}
      </button>
      {entry.children.length > 0 && <ul>{entry.children.map((c) => tocItem(c, files, current, unsaved, onOpen, depth + 1))}</ul>}
    </li>
  );
}

function FolderView({ folder, depth, current, fileItem }: { folder: Folder; depth: number; current: string | null; fileItem: (f: string) => ReactElement }) {
  const containsCurrent = !!current && (folder.path === '' || current.startsWith(folder.path + '/'));
  const [open, setOpen] = useState(depth === 0 || containsCurrent);
  const isOpen = open || containsCurrent;
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
