import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorView } from 'prosemirror-view';
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { OpenProgress, ProjectInfo } from '../../shared/api';
import type { EnvironmentChoice, SphinxState } from '../../shared/sphinx';
import type { ValeAlert, ValeResult } from '../../shared/vale';
import type { SourceMap } from '../../core/sourcemap';
import { configFor, fromProject, projectFor } from '../../shared/projects';
import { DEFAULT_CONFIG } from '../../core/project-config';
import { Workspace } from './workspace';
import { Editor } from './editor/Editor';
import type { EditorContext } from './editor/context';
import type { PreviewBuild } from './editor/previews';
import { editLink } from './editor/commands';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Banner, StatusBar } from './components/Status';
import { DialogHost, type DialogApi } from './components/Dialogs';
import { EnvironmentDialog, Preview, ProblemsPanel, SphinxChip, SphinxDialog, TrustBanner, type PreviewLine } from './components/SphinxUi';
import { blockLines, lineAtTop } from './editor/scrollsync';
import { nextAlert } from './editor/vale';
import { SourceEditor } from './components/SourceEditor';
import { LivePreview } from './components/LivePreview';
import { AdvancedBar } from './components/AdvancedBar';
import { AboutDialog } from './components/About';
import { AskPassHost, BranchDialog, CloneDialog, ConflictsDialog, GitChip, GitPanel } from './components/GitUi';
import { NewPageDialog, RenamePageDialog, type NewPage, type PageRename } from './components/PageDialogs';
import { GoToPage, Outline, markdownHeadings, type Heading } from './components/Navigation';
import { loadPlaces, rememberPage, rememberScroll } from './places';
import { HistoryDialog, when } from './components/History';
import { FindBar } from './components/FindBar';
import { startEmacs, type EmacsApp } from './emacs';
import { move as moveFind } from './editor/find';
import type { PageVersion } from '../../shared/git';
import { addToContents, contentsPages, defaultContents, folderOf, listingPages, moveInContents, pageFolders, removeFromContents, renameReferences, retitle, type ContentsMove } from './pages';
import type { GitInfo } from '../../shared/git';
import { resolveRef } from './paths';
import { docnameOf, problemsIn, resolveLink, resolveRole, suggestTargets } from './sphinx';

const api = window.myst;
const noop = () => () => {};
const zero = () => 0;
const NO_SPHINX: SphinxState = { status: { kind: 'off' }, info: null, environment: null };

// A per-viewer preference kept in localStorage (which may be unavailable).
function useStoredState<T extends string>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T | ((v: T) => T)) =>
      setValue((prev) => {
        const v = typeof next === 'function' ? next(prev) : next;
        try {
          localStorage.setItem(key, v);
        } catch {
          // not persisted; fine for a preference
        }
        return v;
      }),
    [key],
  );
  return [value, set] as const;
}

// The Markdown page a {doc} role or toctree entry refers to, if it exists.
function findPage(info: ProjectInfo, from: string | null, ref: string): string | null {
  const projectDir = from ? (projectFor(info.projects, from)?.dir ?? '') : '';
  const target = resolveRef(from, ref, projectDir);
  if (!target) return null;
  return [target, `${target}.md`, `${target}/index.md`].find((c) => info.files.includes(c)) ?? null;
}

// The page to show when a folder opens: the first project's root page if there is one.
// A name for a picture pasted from the clipboard (browsers call them all image.png).
function imageName(file: File): string {
  const ext = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[file.type] ?? 'png';
  if (file.name && file.name !== 'image.png' && /\.[a-z0-9]+$/i.test(file.name)) return file.name;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `screenshot-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

function landingPage(info: ProjectInfo): string | null {
  const { files, projects } = info;
  return (
    projects.map((p) => fromProject(p, 'index.md')).find((f) => files.includes(f)) ??
    files.find((f) => f === 'index.md') ??
    files.find((f) => f.endsWith('/index.md')) ??
    files[0] ??
    null
  );
}

// Stable while the page and build are the same, so cards don't reload their previews.
const NO_ALERTS: ValeAlert[] = [];

// Vale in the status bar: how many remarks it has on the page (a click goes to the
// next), or that it failed. Nothing when it isn't installed or set up for the page.
function ValeChip({ result, onNext, onShowError }: { result: ValeResult; onNext: () => void; onShowError: (text: string) => void }) {
  if (result.status === 'unavailable') {
    if (result.reason !== 'failed') return null;
    return (
      <button type="button" className="chip-button has-problems" onClick={() => onShowError(result.message)}>
        Vale failed
      </button>
    );
  }
  const n = result.alerts.length;
  return (
    <button type="button" className="chip-button vale-chip" title={n ? 'Checked with Vale: go to the next remark' : 'Checked with Vale'} onClick={onNext} disabled={!n}>
      {n ? `Style: ${n} remark${n === 1 ? '' : 's'}` : 'Style: no remarks'}
    </button>
  );
}

// Vale's alerts for the open page: checked when it opens and after each save, if Vale
// is installed and configured for it (otherwise the result says why not).
function useVale(path: string | null, savedText: string | null) {
  const [found, setFound] = useState<{ path: string; text: string; result: ValeResult } | null>(null);
  useEffect(() => {
    if (!path || savedText === null) return;
    let stale = false;
    const timer = setTimeout(() => {
      void api.valeLint(path).then(
        (result) => !stale && setFound({ path, text: savedText, result }),
        () => {},
      );
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [path, savedText]);
  return found && found.path === path ? found : null;
}

function usePreviewBuild(project: string | null, docname: string | null, builtAt: number | null): PreviewBuild | null {
  return useMemo(() => {
    if (!project || !docname || !builtAt) return null;
    const base = api.buildUrl(project, '_mysteditor/fragment.html');
    return { url: (from, to) => `${base}?doc=${encodeURIComponent(docname)}&from=${from}&to=${to}&built=${builtAt}` };
  }, [project, docname, builtAt]);
}

export function App() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [starting, setStarting] = useState(true);
  // Rich (formatted) editing, or the advanced view: Markdown beside a preview.
  const [mode, setMode] = useStoredState<'rich' | 'markdown'>('mysteditor.mode', 'rich');
  const [advancedPreview, setAdvancedPreview] = useStoredState<'live' | 'built' | 'off'>('mysteditor.advancedPreview', 'live');
  const [sourceLine, setSourceLine] = useState<number | null>(null); // where the writer is in the source
  const [gotoLine, setGotoLine] = useState<number | null>(null);
  // Build state per Sphinx project id.
  const [sphinxStates, setSphinxStates] = useState<Record<string, SphinxState>>({});
  const [showProblems, setShowProblems] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [about, setAbout] = useState(false);
  const closeAbout = useCallback(() => setAbout(false), []);
  const [reveal, setReveal] = useState<number | null>(null);
  const [sphinxDialog, setSphinxDialog] = useState<'details' | 'environment' | null>(null);
  const [viewAs, setViewAs] = useState<string[] | null>(null);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitPanel, setGitPanel] = useState(false);
  const [conflicts, setConflicts] = useState(false); // settling what clashed when getting the latest
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [keyMode, setKeyMode] = useStoredState<'standard' | 'emacs'>('mysteditor.keys', 'standard');
  const emacs = keyMode === 'emacs';
  const [echo, setEcho] = useState<string | null>(null); // a pending Emacs prefix, like C-x-
  // The find bar over the formatted view: what was selected when it opened, and a
  // counter that refocuses it when Ctrl+F is pressed again.
  const [find, setFind] = useState<{ initial: string; focus: number; caseSensitive?: boolean } | null>(null);
  // Search all pages in the sidebar, and a search to show in the page being opened from it.
  const [searchAll, setSearchAll] = useState<{ focusKey: number } | null>(null);
  const pendingFind = useRef<{ path: string; query: string; caseSensitive: boolean } | null>(null);
  const [cloning, setCloning] = useState(false);
  const [opening, setOpening] = useState<OpenProgress | null>(null);
  const [goTo, setGoTo] = useState(false);
  const [history, setHistory] = useState<string | null>(null); // the page whose history is shown
  const [renaming, setRenaming] = useState<string | null>(null); // the page being renamed
  const [outline, setOutline] = useStoredState<'shown' | 'hidden'>('mysteditor.outline', 'hidden');
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The New page dialog, with the folder it starts in (null: the current page's).
  const [newPage, setNewPage] = useState<{ folder: string | null } | null>(null);
  useEffect(() => api.onOpenProgress(setOpening), []);
  const dialogs = useRef<DialogApi>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  useSyncExternalStore(ws?.subscribe ?? noop, ws?.getVersion ?? zero);

  const session = ws?.get(ws.current);
  const projects = ws?.project.projects ?? [];
  // The open page's project; status and dialogs fall back to the first project.
  const pageProject = session ? projectFor(projects, session.path) : null;
  const activeProject = pageProject ?? projects[0] ?? null;
  const sphinx = (activeProject && sphinxStates[activeProject.id]) || NO_SPHINX;
  const info = (pageProject && sphinxStates[pageProject.id]?.info) || null;

  const openPage = useCallback(
    async (path: string) => {
      if (!ws) return;
      try {
        await ws.open(path);
        setSourceLine(null);
      } catch (e) {
        dialogs.current?.notify(`Couldn’t open ${path}: ${e instanceof Error ? e.message : e}`);
      }
    },
    [ws],
  );

  // One context object for the lifetime of the app; node views read it lazily.
  const ctxRef = useRef({ ws: null as Workspace | null, openPage: (_p: string) => {}, states: {} as Record<string, SphinxState> });
  ctxRef.current = { ws, openPage, states: sphinxStates };
  const listeners = useRef(new Set<() => void>());
  const ctx = useMemo<EditorContext>(() => {
    const current = () => ctxRef.current.ws;
    const pageProject = () => {
      const w = current();
      return w?.current ? projectFor(w.project.projects, w.current) : null;
    };
    // Cross-references resolve within the open page's own project.
    const build = () => {
      const p = pageProject();
      return (p && ctxRef.current.states[p.id]?.info) || null;
    };
    return {
      ui: {
        editSource: (o) => dialogs.current!.editSource(o),
        editFields: (o) => dialogs.current!.editFields(o),
        editOptions: (o) => dialogs.current!.editOptions(o),
        editCondition: (o) => dialogs.current!.editCondition(o),
        notify: (m) => dialogs.current!.notify(m),
      },
      get config() {
        const w = current();
        return w ? configFor(w.project, w.current ?? '') : DEFAULT_CONFIG;
      },
      get filePath() {
        return current()?.current ?? null;
      },
      chooseImage() {
        const page = current()?.current;
        return page ? api.chooseImage(page) : Promise.resolve(null);
      },
      async addImage(file: File) {
        const page = current()?.current;
        if (!page) throw new Error('No page is open');
        // A file from disk is referenced (or copied in); a picture from the clipboard
        // has no file, so it's saved under a dated name.
        const path = api.filePath(file);
        if (path) return api.addImageFile(page, path);
        return api.addImageData(page, imageName(file), new Uint8Array(await file.arrayBuffer()));
      },
      assetUrl(ref: string) {
        const w = current();
        if (!w || /^(https?:|data:)/.test(ref)) return ref;
        const rel = resolveRef(w.current, ref, pageProject()?.dir ?? '');
        return rel === null ? '' : api.assetUrl(rel);
      },
      openDocument(ref: string) {
        const w = current();
        const found = w && findPage(w.project, w.current, ref);
        if (found) ctxRef.current.openPage(found);
        else dialogs.current?.notify(`No Markdown page found for “${ref}”`);
      },
      pageTitle(ref: string) {
        const w = current();
        const found = w && findPage(w.project, w.current, ref);
        return found ? (w.project.titles[found] ?? null) : null;
      },
      absorb(map: SourceMap) {
        const w = current();
        if (w?.current) w.absorb(w.current, map);
      },
      resolveRole: (role, target) => resolveRole(build(), current()?.current ?? null, role, target),
      resolveLink: (href) => resolveLink(build(), current()?.current ?? null, href),
      suggest: (role) => suggestTargets(build(), current()?.current ?? null, role),
      subscribe(listener) {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    };
  }, []);

  // Build results: keep them, and let node views refresh their cross-references.
  useEffect(() => {
    const refresh = (states: Record<string, SphinxState>) => {
      ctxRef.current.states = states;
      setSphinxStates(states);
      listeners.current.forEach((fn) => fn());
    };
    const off = api.onSphinxState(({ project, state }) => refresh({ ...ctxRef.current.states, [project]: state }));
    void api.sphinxState().then(refresh);
    return off;
  }, []);

  const useProject = useCallback(async (project: ProjectInfo | null) => {
    if (!project) return;
    setWs((old) => {
      old?.dispose();
      return new Workspace(api, project);
    });
    void api.sphinxState().then((states) => {
      ctxRef.current.states = states;
      setSphinxStates(states);
    });
  }, []);

  // The repository's state, pushed by the main process whenever it may have changed.
  useEffect(() => api.onGitInfo(setGitInfo), []);
  useEffect(() => {
    if (ws) void api.gitInfo().then(setGitInfo);
  }, [ws]);

  // Start with the project from the command line or the last session.
  useEffect(() => {
    api
      .initialProject()
      .then(useProject)
      .finally(() => setStarting(false));
  }, [useProject]);

  // Open the page last open in this folder, or else its landing page.
  useEffect(() => {
    if (ws && !ws.current) {
      const last = loadPlaces(ws.project.root).page;
      const page = last && ws.project.files.includes(last) ? last : landingPage(ws.project);
      if (page) void openPage(page);
    }
  }, [ws, openPage]);

  // Remember the open page, and where each page was scrolled to.
  const current = ws?.current ?? null;
  useEffect(() => {
    if (ws && current) rememberPage(ws.project.root, current);
  }, [ws, current]);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onScroll = useCallback(() => {
    clearTimeout(scrollTimer.current);
    const el = scrollRef.current;
    if (!ws || !current || !el) return;
    const top = el.scrollTop;
    scrollTimer.current = setTimeout(() => rememberScroll(ws.project.root, current, top), 250);
  }, [ws, current]);
  // Back where it was, once the page's editor is there (it mounts first).
  useEffect(() => {
    const el = scrollRef.current;
    if (!ws || !current || !el) return;
    const top = loadPlaces(ws.project.root).scroll[current] ?? 0;
    el.scrollTop = top;
    // Again once images and previews have their size.
    const again = setTimeout(() => el.scrollTop < top && (el.scrollTop = top), 400);
    return () => clearTimeout(again);
  }, [ws, current, mode]);

  // Recent folders, for the welcome screen.
  useEffect(() => {
    if (!ws) void api.recentFolders().then(setRecentFolders);
  }, [ws]);

  // Before opening another folder: save, or ask about what couldn't be saved.
  const canLeave = useCallback(async () => {
    if (!ws || (await ws.saveAll())) return true;
    return dialogs.current!.confirm({
      title: 'Unsaved changes',
      message: `Some pages couldn’t be saved (${ws.unsavedPaths().join(', ')}). Open another folder anyway and lose those changes?`,
      confirm: 'Discard changes',
    });
  }, [ws]);

  const chooseFolder = useCallback(async () => {
    if (await canLeave()) await useProject(await api.chooseProject());
  }, [canLeave, useProject]);

  const openFolder = useCallback(
    async (folder: string) => {
      if (!(await canLeave())) return;
      try {
        await useProject(await api.openProject(folder));
      } catch (e) {
        dialogs.current?.notify(`Couldn’t open ${folder}: ${String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
      }
    },
    [canLeave, useProject],
  );

  const onCloned = useCallback(
    async (folder: string) => {
      setCloning(false);
      if (ws && !(await ws.saveAll())) return;
      await useProject(await api.openProject(folder));
    },
    [ws, useProject],
  );

  const toggleMode = useCallback(() => {
    setMode((m) => (m === 'rich' ? 'markdown' : 'rich'));
  }, [setMode]);

  // Pages follow the mode: as text in the advanced view, as formatted content otherwise.
  useEffect(() => {
    if (!ws || !session) return;
    if (mode === 'markdown' && session.text === null) ws.enterTextMode(session.path);
    if (mode === 'rich' && session.text !== null) ws.leaveTextMode(session.path);
  }, [ws, session, mode]);

  const showLog = useCallback(async () => {
    const status = sphinx.status;
    const log = activeProject ? await api.sphinxLog(activeProject.id) : '';
    const summary = status.kind === 'error' ? `${status.message}\n\n` : '';
    await dialogs.current?.showText({ title: 'Sphinx build', text: `${summary}${log.trim() || 'Nothing logged yet.'}` });
  }, [sphinx, activeProject]);

  const useEnvironment = useCallback((choice: EnvironmentChoice) => {
    setSphinxDialog(null);
    void api.useEnvironment(choice);
  }, []);

  const openProblem = useCallback(
    async (path: string, line: number | null) => {
      await openPage(path);
      if (mode === 'markdown') setGotoLine(line);
      else setReveal(line);
    },
    [openPage, mode],
  );

  // Delete a page: to the trash, and out of the tables of contents that list it.
  const deletePage = useCallback(
    async (path: string) => {
      if (!ws) return;
      const project = projectFor(ws.project.projects, path);
      const info = (project && ctxRef.current.states[project.id]?.info) || null;
      const listing = await listingPages(ws, project, info, path);
      const title = ws.project.titles[path] ?? path;
      const ok = await dialogs.current!.confirm({
        title: 'Delete page',
        message:
          `Delete “${title}” (${path})? It goes to the trash, so it can be restored from there.` +
          (listing.length ? ` It will also be taken out of the table of contents of ${listing.map((p) => `“${ws.project.titles[p] ?? p}”`).join(', ')}.` : '') +
          ' Links to it from other pages will show as problems.',
        confirm: 'Delete page',
      });
      if (!ok) return;
      try {
        const { trashed } = await api.deletePage(path, false);
        if (!trashed) {
          const forGood = await dialogs.current!.confirm({
            title: 'No trash here',
            message: `This system has no trash to move “${title}” to. Delete it permanently instead? This can’t be undone (unless it’s committed in git).`,
            confirm: 'Delete permanently',
          });
          if (!forGood) return;
          await api.deletePage(path, true);
        }
      } catch (e) {
        dialogs.current?.notify(`Couldn’t delete ${path}: ${e instanceof Error ? e.message : e}`);
        return;
      }
      const failed = await removeFromContents(ws, project, listing, path);
      if (failed.length) dialogs.current?.notify(`Remove “${title}” from the contents of ${failed.join(', ')} yourself: those pages are open as Markdown or couldn’t be saved.`);
      const wasCurrent = ws.current === path;
      ws.close(path);
      if (wasCurrent) {
        const next = landingPage({ ...ws.project, files: ws.project.files.filter((f) => f !== path) });
        if (next) void openPage(next);
      }
    },
    [ws, openPage],
  );

  // Put an earlier version of a page back, keeping the page as it is now in its
  // history first, so this can be undone the same way.
  const restoreVersion = useCallback(
    async (path: string, text: string, version: PageVersion) => {
      if (!ws) return;
      const title = ws.project.titles[path] ?? path;
      const ok = await dialogs.current!.confirm({
        title: 'Restore this version',
        message: `Replace “${title}” with the version from ${when(version.date)}? The page as it is now is kept in its history, so you can go back to it.`,
        confirm: 'Restore',
      });
      if (!ok) return;
      try {
        await ws.save(path);
        await api.snapshotPage(path);
        if (!(await ws.restore(path, text))) throw new Error('it couldn’t be saved');
        setHistory(null);
      } catch (e) {
        dialogs.current?.notify(`Couldn’t restore ${path}: ${String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
      }
    },
    [ws],
  );

  // Rename or move a page: its title, its file, and every reference to it.
  const renamePage = useCallback(
    async (from: string, { title, path }: PageRename) => {
      if (!ws) return;
      if (!(await ws.saveAll())) throw new Error('Some pages couldn’t be saved. Fix them first.');
      const project = projectFor(ws.project.projects, from);
      if (title !== (ws.project.titles[from] ?? '') && !(await ws.edit(from, (state) => retitle(state, title)))) throw new Error('The page is open as Markdown: change its heading there.');
      if (path !== from) {
        await api.renamePage(from, path);
        ws.close(from);
        const failed = await renameReferences(ws, project, from, path);
        if (failed.length) dialogs.current?.notify(`Update the links to it in ${failed.join(', ')} yourself: those pages are open as Markdown or couldn’t be saved.`);
      }
      setRenaming(null);
      await openPage(path);
    },
    [ws, openPage],
  );

  // Move a page in the contents (dragged in the sidebar, or Move up / down).
  const moveInContentsOf = useCallback(
    async (move: ContentsMove) => {
      if (!ws) return 'No folder is open.';
      const problem = await moveInContents(ws, projectFor(ws.project.projects, move.to), move).catch((e) => String(e instanceof Error ? e.message : e));
      if (problem) dialogs.current?.notify(problem);
      return problem;
    },
    [ws],
  );

  const createPage = useCallback(
    async ({ title, path, contents }: NewPage) => {
      if (!ws) return;
      await api.createPage(path, `# ${title}\n`);
      const project = projectFor(ws.project.projects, path);
      setNewPage(null);
      if (contents && !(await addToContents(ws, project, contents, path))) {
        dialogs.current?.notify(`Add the new page to the contents of ${contents} yourself: it’s open as Markdown or couldn’t be saved.`);
      }
      await openPage(path);
    },
    [ws, openPage],
  );

  // Ctrl+F finds in the formatted view (the Markdown view's editor has its own search).
  const openFind = useCallback(() => {
    const v = viewRef.current;
    if (!v || mode !== 'rich') return false;
    const { from, to } = v.state.selection;
    const selected = v.state.doc.textBetween(from, to, ' ');
    setFind((f) => ({ initial: selected && !selected.includes('\n') ? selected : (f?.initial ?? ''), focus: (f?.focus ?? 0) + 1 }));
    return true;
  }, [mode]);
  // Menu commands, external file changes and window closing.
  useEffect(() => {
    const offMenu = api.onMenu((cmd) => {
      if (cmd === 'open-folder') void chooseFolder();
      else if (cmd === 'clone') setCloning(true);
      else if (cmd === 'toggle-source') toggleMode();
      else if (cmd === 'save' && ws?.current) void ws.save(ws.current);
      else if (cmd === 'new-page' && ws) setNewPage({ folder: null });
      else if (cmd === 'delete-page' && ws?.current) void deletePage(ws.current);
      else if (cmd === 'go-to-page' && ws) setGoTo(true);
      else if (cmd === 'page-history' && ws?.current) setHistory(ws.current);
      else if (cmd === 'switch-branch' && ws) setBranchesOpen(true);
      else if (cmd === 'rename-page' && ws?.current) setRenaming(ws.current);
      else if (cmd === 'find') openFind();
      else if (cmd === 'search-pages' && ws) setSearchAll((s) => ({ focusKey: (s?.focusKey ?? 0) + 1 }));
      else if (cmd === 'toggle-emacs') setKeyMode((k) => (k === 'emacs' ? 'standard' : 'emacs'));
      else if (cmd === 'about') setAbout(true);
      else if (cmd === 'toggle-outline') setOutline((o) => (o === 'shown' ? 'hidden' : 'shown'));
    });
    const offRecent = api.onOpenFolderPath((folder) => void openFolder(folder));
    const offFiles = api.onFilesChanged((e) => void ws?.externalChange(e.changed, e.files, e.titles));
    const offProject = api.onProjectChanged(({ project }) => {
      ws?.updateProject(project);
      listeners.current.forEach((fn) => fn());
    });
    const offClose = api.onCloseRequested(async () => {
      if (!ws || (await ws.saveAll())) return api.closeWindow();
      const ok = await dialogs.current!.confirm({
        title: 'Unsaved changes',
        message: `These pages couldn’t be saved: ${ws.unsavedPaths().join(', ')}. Close anyway and lose those changes?`,
        confirm: 'Close without saving',
      });
      if (ok) api.closeWindow();
    });
    return () => {
      offMenu();
      offRecent();
      offFiles();
      offProject();
      offClose();
    };
  }, [ws, chooseFolder, openFolder, toggleMode, deletePage, setOutline, openFind, setKeyMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!emacs && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && openFind()) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFind, emacs]);

  // Emacs keys: the menu leaves them alone, and the window reads them (see emacs.ts).
  // The app's side goes through a ref, so the keys always reach the current state.
  const emacsApp = useRef<EmacsApp>(null!);
  emacsApp.current = {
    save: () => void (ws?.current && ws.save(ws.current)),
    goToPage: () => ws && setGoTo(true),
    openFolder: () => void chooseFolder(),
    toggleMarkdown: () => ws?.current && toggleMode(),
    findInPage: (forward) => {
      const v = viewRef.current;
      if (find && v) v.dispatch(moveFind(v.state, forward ? 1 : -1));
      else openFind();
    },
    closeFind: () => {
      if (!find) return false;
      setFind(null);
      viewRef.current?.focus();
      return true;
    },
    prefix: setEcho,
  };
  useEffect(() => {
    api.setEmacsKeys(emacs);
    if (!emacs) return;
    const proxy = new Proxy({} as EmacsApp, { get: (_t, key: keyof EmacsApp) => (...args: never[]) => (emacsApp.current[key] as (...a: never[]) => unknown)(...args) });
    return startEmacs(() => viewRef.current, proxy);
  }, [emacs]);
  // A new page (or view) starts without the find bar, unless it was opened from a search.
  useEffect(() => {
    const pending = pendingFind.current;
    if (pending && pending.path === session?.path && mode === 'rich') {
      pendingFind.current = null;
      setFind((f) => ({ initial: pending.query, caseSensitive: pending.caseSensitive, focus: (f?.focus ?? 0) + 1 }));
    } else setFind(null);
  }, [session?.path, mode]);

  // Ctrl+/ switches between formatted editing and the Markdown view, wherever focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!emacs && (e.ctrlKey || e.metaKey) && e.key === '/' && ws?.current) {
        e.preventDefault();
        toggleMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws, toggleMode, emacs]);

  // Ctrl+K for links (needs the dialog, so it lives here rather than in the keymap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const view = viewRef.current;
      if (view && view.hasFocus() && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        void editLink(ctx, view.state, (cmd) => {
          cmd(view.state, view.dispatch, view);
          view.focus();
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx]);

  const onChange = useCallback(
    (state: EditorState, docChanged: boolean) => {
      if (ws?.current) ws.update(ws.current, state, docChanged);
    },
    [ws],
  );
  const onRevealed = useCallback(() => setReveal(null), []);
  const onGotoDone = useCallback(() => setGotoLine(null), []);

  // The open page's headings for the outline: top-level ones (Sphinx's sections) in the
  // formatted view, # lines in the Markdown view.
  const textMode = mode === 'markdown' && session?.text != null;
  const headings = useMemo<Heading[]>(() => {
    if (!session) return [];
    if (textMode) return markdownHeadings(session.text!);
    const out: Heading[] = [];
    session.state.doc.forEach((node, offset) => {
      if (node.type.name === 'heading') out.push({ level: node.attrs.level, text: node.textContent, at: offset });
    });
    return out;
  }, [session, session?.state.doc, session?.text, textMode]);
  const where = textMode ? (sourceLine ?? 1) : (session?.state.selection.from ?? 0);
  const currentHeading = useMemo(() => {
    let found: number | null = null;
    headings.forEach((h, i) => {
      if (h.at <= where) found = i;
    });
    return found;
  }, [headings, where]);
  const pickHeading = useCallback(
    (h: Heading) => {
      if (textMode) return setGotoLine(h.at);
      const v = viewRef.current;
      if (!v) return;
      (v.nodeDOM(h.at) as HTMLElement | null)?.scrollIntoView({ block: 'start' });
      v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(h.at + 1))));
      v.focus();
    },
    [textMode],
  );

  // Pages that could list a new page, worked out once when the dialog opens.
  const newPageContents = useMemo(() => {
    if (!newPage || !ws) return Promise.resolve([] as string[]);
    const project = projectFor(ws.project.projects, ws.current ?? '') ?? ws.project.projects[0] ?? null;
    const built = (project && sphinxStates[project.id]?.info) || null;
    return contentsPages(ws, project, built, [ws.current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPage, ws]);
  const pageProblems = useMemo(() => problemsIn(info, session?.path ?? null), [info, session?.path]);
  // Hooks stay above the welcome screen's early return.
  const previewBuild = usePreviewBuild(pageProject?.id ?? null, info && session ? docnameOf(info, session.path) : null, info?.builtAt ?? null);
  const valeFound = useVale(session?.path ?? null, session?.savedText ?? null);
  const vale = useMemo(
    () => (valeFound?.result.status === 'ok' ? { text: valeFound.text, alerts: valeFound.result.alerts } : null),
    [valeFound],
  );
  // The Sphinx preview follows the formatted view's scrolling (the Markdown view
  // reports its line itself).
  const [richLine, setRichLine] = useState<PreviewLine>(null);
  const savedLines = useMemo(
    () => (ws && session && showPreview ? blockLines(session.savedText, configFor(ws.project, session.path)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, session?.path, session?.savedText, showPreview],
  );
  const followFrame = useRef(0);
  const followScroll = useCallback(() => {
    cancelAnimationFrame(followFrame.current);
    followFrame.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      const v = viewRef.current;
      if (el && v && savedLines) setRichLine(lineAtTop(v, el, savedLines));
    });
  }, [savedLines]);
  useEffect(followScroll, [followScroll]);

  const openingCard = opening && (
    <div className="opening" role="status" aria-live="polite">
      <div className="welcome-card">
        <div className="spinner large" aria-hidden="true" />
        <h2>Opening {opening.folder.split(/[\\/]/).pop()}</h2>
        <p>
          {opening.step}…{opening.detail && <span className="muted"> {opening.detail}</span>}
        </p>
      </div>
    </div>
  );

  if (!ws) {
    return (
      <div className="welcome">
        {openingCard}
        {!starting && !opening && (
          <div className="welcome-card">
            <h1>MyST Editor</h1>
            <p>Edit your Sphinx documentation as formatted pages. Your Markdown files are saved exactly as written, apart from what you change.</p>
            <button type="button" className="primary large" onClick={chooseFolder}>
              Open documentation folder
            </button>
            <button type="button" className="large secondary" onClick={() => setCloning(true)}>
              Get from a repository…
            </button>
            {recentFolders.length > 0 && (
              <section className="recent-folders" aria-label="Recent folders">
                <h2>Recent</h2>
                <ul>
                  {recentFolders.map((folder) => (
                    <li key={folder}>
                      <button type="button" className="link-button" title={folder} onClick={() => void openFolder(folder)}>
                        <span className="recent-name">{folder.split(/[\\/]/).filter(Boolean).pop()}</span>
                        <span className="recent-path">{folder}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
        {cloning && <CloneDialog onClose={() => setCloning(false)} onCloned={onCloned} />}
        {about && <AboutDialog sphinx={null} onClose={closeAbout} />}
        <AskPassHost />
        <DialogHost ref={dialogs} />
      </div>
    );
  }

  const unsaved = new Set(ws.unsavedPaths());
  const docname = info && session ? docnameOf(info, session.path) : null;
  const uri = docname ? info?.docs[docname]?.uri : null;
  const previewUrl = uri && info && pageProject ? `${api.buildUrl(pageProject.id, uri)}?built=${info.builtAt}` : null;
  // Trust and the environment are decided once for all of the folder's projects.
  const trustState = Object.values(sphinxStates).find((st) => st.status.kind === 'needs-trust') ?? sphinx;
  const builds = Object.fromEntries(projects.map((p) => [p.id, sphinxStates[p.id]?.info ?? null]));
  const allWarnings = Object.values(sphinxStates).flatMap((st) => st.info?.warnings ?? []);
  const anyBuilt = projects.some((p) => builds[p.id]);
  // Mistakes in .mysteditor.toml files, once each (a folder-level file applies to every project).
  const settingsProblems = [ws.project.defaultConfig, ...projects.map((p) => p.config)]
    .flatMap((c) => c.editor.problems)
    .filter((p, i, all) => all.findIndex((q) => q.file === p.file && q.message === p.message) === i);

  return (
    <div className="app">
      {openingCard}
      <Sidebar
        projectName={ws.project.name}
        files={ws.project.files}
        titles={ws.project.titles}
        projects={projects}
        builds={builds}
        current={ws.current}
        unsaved={unsaved}
        onOpen={openPage}
        onOpenFolder={chooseFolder}
        onNewPage={(folder) => setNewPage({ folder })}
        onDeletePage={(path) => void deletePage(path)}
        onMoveInContents={moveInContentsOf}
        onHistory={(path) => void openPage(path).then(() => setHistory(path))}
        onRename={(path) => setRenaming(path)}
        search={searchAll}
        saveAll={() => ws.saveAll()}
        onCloseSearch={() => setSearchAll(null)}
        onSearchResult={(path, line, query, caseSensitive) => {
          // The page, at that line; in the formatted view with the find bar showing the matches.
          if (mode === 'rich') {
            if (path === ws.current) setFind((f) => ({ initial: query, caseSensitive, focus: (f?.focus ?? 0) + 1 }));
            else pendingFind.current = { path, query, caseSensitive };
          }
          void openPage(path).then(() => (mode === 'rich' ? setReveal(line) : setGotoLine(line)));
        }}
      />
      <main className="main">
        {mode === 'markdown' ? (
          <AdvancedBar
            preview={advancedPreview}
            onPreview={setAdvancedPreview}
            built={!!info}
            onRich={toggleMode}
            conditions={ctx.config.editor.conditions}
            viewAs={viewAs}
            onViewAs={setViewAs}
            onHistory={() => ws.current && setHistory(ws.current)}
          />
        ) : (
        <Toolbar
          view={session ? view : null}
          ctx={ctx}
          onMarkdown={toggleMode}
          previewAvailable={!!info}
          previewOpen={showPreview}
          onTogglePreview={() => setShowPreview(!showPreview)}
          onHistory={() => ws.current && setHistory(ws.current)}
          viewAs={viewAs}
          onViewAs={setViewAs}
        />
        )}
        <TrustBanner
          state={trustState}
          onUse={useEnvironment}
          onChooseOther={() => setSphinxDialog('environment')}
          onDecline={() => void api.declineSphinx()}
        />
        {session && (
          <Banner
            session={session}
            onSaveAnyway={() => void ws.save(session.path, { force: true })}
            onShowSource={() => mode === 'rich' && toggleMode()}
            onReload={() => void ws.reload(session.path)}
            onKeepMine={() => void ws.save(session.path, { force: true })}
            onRetry={() => void ws.save(session.path, { force: true })}
          />
        )}
        {mode === 'markdown' && session && session.text !== null ? (
          <div className="advanced">
            <SourceEditor
              key={session.path}
              text={session.text}
              onChange={(text) => ws.setText(session.path, text)}
              problems={pageProblems}
              vale={vale?.alerts ?? NO_ALERTS}
              onLine={setSourceLine}
              goto={gotoLine}
              onGotoDone={onGotoDone}
              onImage={ctx.addImage}
              onImageError={(m) => dialogs.current?.notify(m)}
            />
            {advancedPreview !== 'off' && (
              <div className="advanced-preview">
                {advancedPreview === 'live' ? (
                  <LivePreview
                    key={session.path}
                    text={session.text}
                    ctx={ctx}
                    savedText={session.savedText}
                    build={previewBuild}
                    viewAs={viewAs}
                    line={sourceLine}
                    onPick={setGotoLine}
                  />
                ) : (
                  <Preview url={previewUrl} building={sphinx.status.kind === 'building'} line={sourceLine} />
                )}
              </div>
            )}
            {outline === 'shown' && <Outline headings={headings} current={currentHeading} onPick={pickHeading} onClose={() => setOutline('hidden')} />}
          </div>
        ) : (
        <div className={`workarea${showPreview && info ? ' with-preview' : ''}`}>
          <div
            className="scroll"
            ref={scrollRef}
            onScroll={() => {
              onScroll();
              followScroll();
            }}
          >
            {find && view && <FindBar key={`${find.initial}|${find.caseSensitive}`} view={view} initial={find.initial} caseSensitive={find.caseSensitive} focusKey={find.focus} onClose={() => setFind(null)} />}
            {session && (
              <Editor
                key={session.path}
                state={session.state}
                ctx={ctx}
                onChange={onChange}
                viewRef={viewRef}
                onView={setView}
                problems={pageProblems}
                savedText={session.savedText}
                reveal={reveal}
                onRevealed={onRevealed}
                viewAs={viewAs}
                build={previewBuild}
                vale={vale}
              />
            )}
            {!session && <div className="empty-state muted">Choose a page on the left.</div>}
          </div>
          {showPreview && info && <Preview url={previewUrl} building={sphinx.status.kind === 'building'} line={richLine} />}
          {outline === 'shown' && session && <Outline headings={headings} current={currentHeading} onPick={pickHeading} onClose={() => setOutline('hidden')} />}
        </div>
        )}
        {showProblems && anyBuilt && (
          <ProblemsPanel
            warnings={allWarnings}
            titles={ws.project.titles}
            current={ws.current}
            onOpen={(path, line) => void openProblem(path, line)}
            onClose={() => setShowProblems(false)}
          />
        )}
        <StatusBar session={session} config={configFor(ws.project, session?.path ?? '')} confPy={pageProject?.confPy ?? null}>
          {settingsProblems.length > 0 && (
            <button
              type="button"
              className="chip-button has-problems"
              onClick={() =>
                void dialogs.current?.showText({
                  title: 'Editor settings',
                  text: settingsProblems.map((p) => `${p.file}: ${p.message}`).join('\n'),
                })
              }
            >
              Settings: {settingsProblems.length} problem{settingsProblems.length === 1 ? '' : 's'}
            </button>
          )}
          {echo && (
            <span className="emacs-echo" aria-live="polite" title="Waiting for the rest of an Emacs key (C-g cancels)">
              {echo}
            </span>
          )}
          {valeFound && <ValeChip result={valeFound.result} onNext={() => view && nextAlert(view)} onShowError={(text) => void dialogs.current?.showText({ title: 'Vale', text })} />}
          <GitChip info={gitInfo} onOpen={() => (gitInfo?.operation ? setConflicts(true) : setGitPanel(true))} onBranches={() => setBranchesOpen(true)} />
          <SphinxChip
            state={sphinx}
            project={projects.length > 1 ? activeProject?.name : undefined}
            problems={allWarnings.length}
            onShowProblems={() => setShowProblems(!showProblems)}
            onShowDetails={() => setSphinxDialog('details')}
            onEnable={() => setSphinxDialog('environment')}
          />
        </StatusBar>
      </main>
      {gitPanel && gitInfo?.status && (
        <GitPanel
          info={gitInfo}
          titles={ws.project.titles}
          saveAll={() => ws.saveAll()}
          confirm={(o) => dialogs.current!.confirm(o)}
          onConflicts={() => {
            setGitPanel(false);
            setConflicts(true);
          }}
          onClose={() => setGitPanel(false)}
        />
      )}
      {branchesOpen && gitInfo?.repoRoot && (
        <BranchDialog
          info={gitInfo}
          saveAll={() => ws.saveAll()}
          onSwitched={(operation, m) => {
            setBranchesOpen(false);
            // The files are another branch's now: read the pages again, staying on the
            // same page if that branch has it.
            const was = ws.current;
            ws.closeAll();
            const page = was && ws.project.files.includes(was) ? was : landingPage(ws.project);
            if (page) void openPage(page);
            if (operation) setConflicts(true);
            else dialogs.current?.notify(m);
          }}
          onClose={() => setBranchesOpen(false)}
        />
      )}
      {conflicts && gitInfo?.repoRoot && (
        <ConflictsDialog
          info={gitInfo}
          titles={ws.project.titles}
          onDone={(m) => {
            setConflicts(false);
            dialogs.current?.notify(m);
          }}
          onClose={() => setConflicts(false)}
        />
      )}
      {cloning && <CloneDialog onClose={() => setCloning(false)} onCloned={onCloned} />}
      {about && <AboutDialog sphinx={info?.sphinxVersion ?? null} onClose={closeAbout} />}
      <AskPassHost />
      {renaming && (
        <RenamePageDialog
          path={renaming}
          title={ws.project.titles[renaming] ?? ''}
          folders={pageFolders(ws.project).filter((f) => {
            // Its own project only: another project's build wouldn't have it.
            const own = projectFor(ws.project.projects, renaming);
            return !own?.dir || f === own.dir || f.startsWith(own.dir + '/');
          })}
          files={new Set(ws.project.files)}
          onRename={(change) => renamePage(renaming, change)}
          onClose={() => setRenaming(null)}
        />
      )}
      {history && ws.get(history) && (
        <HistoryDialog
          path={history}
          title={ws.project.titles[history] ?? history}
          current={ws.sourceOf(history)}
          ctx={ctx}
          onRestore={(text, version) => void restoreVersion(history, text, version)}
          onClose={() => setHistory(null)}
        />
      )}
      {goTo && <GoToPage files={ws.project.files} titles={ws.project.titles} recent={loadPlaces(ws.project.root).recent} onOpen={(p) => void openPage(p)} onClose={() => setGoTo(false)} />}
      {newPage && (
        <NewPageDialog
          folders={pageFolders(ws.project)}
          folder={newPage.folder ?? folderOf(ws.current, pageProject)}
          files={new Set(ws.project.files)}
          titles={ws.project.titles}
          contentsPages={newPageContents}
          contentsDefault={(folder, pages) => defaultContents(ws.project, folder, pages)}
          onCreate={createPage}
          onClose={() => setNewPage(null)}
        />
      )}
      {sphinxDialog === 'details' && (
        <SphinxDialog
          state={sphinx}
          onChangeEnvironment={() => setSphinxDialog('environment')}
          project={projects.length > 1 ? activeProject?.name : undefined}
          projectId={activeProject?.id ?? null}
          onRebuild={() => {
            if (activeProject) void api.rebuild(activeProject.id);
            setSphinxDialog(null);
          }}
          onShowLog={() => {
            setSphinxDialog(null);
            void showLog();
          }}
          onClose={() => setSphinxDialog(null)}
        />
      )}
      {sphinxDialog === 'environment' && (
        <EnvironmentDialog state={trustState.status.kind === 'needs-trust' ? trustState : sphinx} projects={projects.length} onUse={useEnvironment} onClose={() => setSphinxDialog(null)} />
      )}
      <DialogHost ref={dialogs} />
    </div>
  );
}
