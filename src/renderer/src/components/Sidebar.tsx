// Page tree for the project.
import { useMemo, useState, type ReactElement } from 'react';
import { basename } from '../paths';

interface Props {
  projectName: string;
  files: string[];
  titles: Record<string, string>;
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

function buildTree(files: string[]): Folder {
  const root: Folder = { name: '', path: '', folders: [], files: [] };
  for (const file of files) {
    const parts = file.split('/');
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

export function Sidebar({ projectName, files, titles, current, unsaved, onOpen, onOpenFolder }: Props) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [filter, setFilter] = useState('');
  const matches = filter
    ? files.filter((f) => `${titles[f] ?? ''} ${f}`.toLowerCase().includes(filter.toLowerCase()))
    : null;

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
      <input className="filter" placeholder="Find a page" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a page" />
      <div className="tree">
        {matches ? (
          <ul>{matches.map(fileItem)}</ul>
        ) : (
          <FolderView folder={tree} depth={0} current={current} fileItem={fileItem} />
        )}
        {!files.length && <p className="muted pad">No Markdown pages found in this folder.</p>}
      </div>
    </nav>
  );
}

function FolderView({ folder, depth, current, fileItem }: { folder: Folder; depth: number; current: string | null; fileItem: (f: string) => ReactElement }) {
  const containsCurrent = !!current && current.startsWith(folder.path + '/');
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
