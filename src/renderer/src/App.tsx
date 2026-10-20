import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import type { ProjectInfo } from '../../shared/api';
import type { SourceMap } from '../../core/sourcemap';
import { DEFAULT_CONFIG } from '../../core/project-config';
import { Workspace } from './workspace';
import { Editor } from './editor/Editor';
import type { EditorContext } from './editor/context';
import { editLink } from './editor/commands';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Banner, StatusBar } from './components/Status';
import { DialogHost, type DialogApi } from './components/Dialogs';
import { join, resolveRef } from './paths';

const api = window.myst;
const noop = () => () => {};
const zero = () => 0;

// The Markdown page a {doc} role or toctree entry refers to, if it exists.
function findPage(files: string[], from: string | null, ref: string): string | null {
  const target = resolveRef(from, ref);
  if (!target) return null;
  return [target, `${target}.md`, `${target}/index.md`].find((c) => files.includes(c)) ?? null;
}

// The page to show when a project opens.
function landingPage(files: string[]): string | null {
  return files.find((f) => f === 'index.md') ?? files.find((f) => f.endsWith('/index.md')) ?? files[0] ?? null;
}

export function App() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [starting, setStarting] = useState(true);
  const [sourceMode, setSourceMode] = useState(false);
  const [source, setSource] = useState('');
  const dialogs = useRef<DialogApi>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  useSyncExternalStore(ws?.subscribe ?? noop, ws?.getVersion ?? zero);

  const session = ws?.get(ws.current);

  const openPage = useCallback(
    async (path: string) => {
      if (!ws) return;
      try {
        await ws.open(path);
        setSourceMode(false);
      } catch (e) {
        dialogs.current?.notify(`Couldn’t open ${path}: ${e instanceof Error ? e.message : e}`);
      }
    },
    [ws],
  );

  // One context object for the lifetime of the app; node views read it lazily.
  const ctxRef = useRef<{ ws: Workspace | null; openPage: (p: string) => void }>({ ws: null, openPage: () => {} });
  ctxRef.current = { ws, openPage };
  const ctx = useMemo<EditorContext>(() => {
    const current = () => ctxRef.current.ws;
    return {
      ui: {
        editSource: (o) => dialogs.current!.editSource(o),
        editFields: (o) => dialogs.current!.editFields(o),
        editOptions: (o) => dialogs.current!.editOptions(o),
        notify: (m) => dialogs.current!.notify(m),
      },
      get config() {
        return current()?.project.config ?? DEFAULT_CONFIG;
      },
      get filePath() {
        return current()?.current ?? null;
      },
      assetUrl(ref: string) {
        const w = current();
        if (!w || /^(https?:|data:)/.test(ref)) return ref;
        const inSource = resolveRef(w.current, ref);
        const prefix = w.project.sourceDir.slice(w.project.root.length).replace(/^\//, '');
        const rel = inSource === null ? null : join(prefix, inSource);
        return rel === null ? '' : api.assetUrl(rel);
      },
      openDocument(ref: string) {
        const w = current();
        const found = w && findPage(w.project.files, w.current, ref);
        if (found) ctxRef.current.openPage(found);
        else dialogs.current?.notify(`No Markdown page found for “${ref}”`);
      },
      pageTitle(ref: string) {
        const w = current();
        const found = w && findPage(w.project.files, w.current, ref);
        return found ? (w.project.titles[found] ?? null) : null;
      },
      absorb(map: SourceMap) {
        const w = current();
        if (w?.current) w.absorb(w.current, map);
      },
    };
  }, []);

  const useProject = useCallback(async (project: ProjectInfo | null) => {
    if (!project) return;
    setWs((old) => {
      old?.dispose();
      return new Workspace(api, project);
    });
  }, []);

  // Start with the project from the command line or the last session.
  useEffect(() => {
    api
      .initialProject()
      .then(useProject)
      .finally(() => setStarting(false));
  }, [useProject]);

  // Open the landing page of a newly opened project.
  useEffect(() => {
    if (ws && !ws.current) {
      const page = landingPage(ws.project.files);
      if (page) void openPage(page);
    }
  }, [ws, openPage]);

  const chooseFolder = useCallback(async () => {
    if (ws && !(await ws.saveAll())) {
      const ok = await dialogs.current!.confirm({
        title: 'Unsaved changes',
        message: `Some pages couldn’t be saved (${ws.unsavedPaths().join(', ')}). Open another folder anyway and lose those changes?`,
        confirm: 'Discard changes',
      });
      if (!ok) return;
    }
    await useProject(await api.chooseProject());
  }, [ws, useProject]);

  const toggleSource = useCallback(() => {
    if (!ws?.current) return;
    if (sourceMode) {
      ws.setSource(ws.current, source);
      setSourceMode(false);
    } else {
      setSource(ws.sourceOf(ws.current));
      setSourceMode(true);
    }
  }, [ws, sourceMode, source]);

  // Menu commands, external file changes and window closing.
  useEffect(() => {
    const offMenu = api.onMenu((cmd) => {
      if (cmd === 'open-folder') void chooseFolder();
      else if (cmd === 'toggle-source') toggleSource();
      else if (cmd === 'save' && ws?.current) void ws.save(ws.current);
    });
    const offFiles = api.onFilesChanged((e) => void ws?.externalChange(e.changed, e.files, e.titles));
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
      offFiles();
      offClose();
    };
  }, [ws, chooseFolder, toggleSource]);

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

  if (!ws) {
    return (
      <div className="welcome">
        {!starting && (
          <div className="welcome-card">
            <h1>MyST Editor</h1>
            <p>Edit your Sphinx documentation as formatted pages. Your Markdown files are saved exactly as written, apart from what you change.</p>
            <button type="button" className="primary large" onClick={chooseFolder}>
              Open documentation folder
            </button>
          </div>
        )}
        <DialogHost ref={dialogs} />
      </div>
    );
  }

  const unsaved = new Set(ws.unsavedPaths());

  return (
    <div className="app">
      <Sidebar
        projectName={ws.project.name}
        files={ws.project.files}
        titles={ws.project.titles}
        current={ws.current}
        unsaved={unsaved}
        onOpen={openPage}
        onOpenFolder={chooseFolder}
      />
      <main className="main">
        <Toolbar view={session && !sourceMode ? view : null} ctx={ctx} sourceMode={sourceMode} onToggleSource={toggleSource} />
        {session && (
          <Banner
            session={session}
            onSaveAnyway={() => void ws.save(session.path, { force: true })}
            onShowSource={toggleSource}
            onReload={() => void ws.reload(session.path)}
            onKeepMine={() => void ws.save(session.path, { force: true })}
            onRetry={() => void ws.save(session.path, { force: true })}
          />
        )}
        <div className="scroll">
          {session && sourceMode && (
            <textarea className="source-view" value={source} spellCheck={false} aria-label="Markdown source" onChange={(e) => setSource(e.target.value)} />
          )}
          {session && !sourceMode && <Editor key={session.path} state={session.state} ctx={ctx} onChange={onChange} viewRef={viewRef} onView={setView} />}
          {!session && <div className="empty-state muted">Choose a page on the left.</div>}
        </div>
        <StatusBar session={session} config={ws.project.config} confPy={ws.project.confPy} />
      </main>
      <DialogHost ref={dialogs} />
    </div>
  );
}
