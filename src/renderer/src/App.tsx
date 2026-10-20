import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import type { ProjectInfo } from '../../shared/api';
import type { EnvironmentChoice, SphinxState } from '../../shared/sphinx';
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
import { EnvironmentDialog, Preview, ProblemsPanel, SphinxChip, SphinxDialog, TrustBanner } from './components/SphinxUi';
import { join, resolveRef } from './paths';
import { docnameOf, problemsIn, resolveLink, resolveRole, suggestTargets } from './sphinx';

const api = window.myst;
const noop = () => () => {};
const zero = () => 0;
const NO_SPHINX: SphinxState = { status: { kind: 'off' }, info: null, environment: null };

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
  const [sphinx, setSphinx] = useState<SphinxState>(NO_SPHINX);
  const [showProblems, setShowProblems] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [reveal, setReveal] = useState<number | null>(null);
  const [sphinxDialog, setSphinxDialog] = useState<'details' | 'environment' | null>(null);
  const dialogs = useRef<DialogApi>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  useSyncExternalStore(ws?.subscribe ?? noop, ws?.getVersion ?? zero);

  const session = ws?.get(ws.current);
  const info = sphinx.info;

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
  const ctxRef = useRef({ ws: null as Workspace | null, openPage: (_p: string) => {}, sphinx: NO_SPHINX });
  ctxRef.current = { ws, openPage, sphinx };
  const listeners = useRef(new Set<() => void>());
  const ctx = useMemo<EditorContext>(() => {
    const current = () => ctxRef.current.ws;
    const build = () => ctxRef.current.sphinx.info;
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
    const apply = (state: SphinxState) => {
      ctxRef.current.sphinx = state;
      setSphinx(state);
      listeners.current.forEach((fn) => fn());
    };
    const off = api.onSphinxState(apply);
    void api.sphinxState().then(apply);
    return off;
  }, []);

  const useProject = useCallback(async (project: ProjectInfo | null) => {
    if (!project) return;
    setWs((old) => {
      old?.dispose();
      return new Workspace(api, project);
    });
    void api.sphinxState().then((s) => {
      ctxRef.current.sphinx = s;
      setSphinx(s);
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

  const showLog = useCallback(async () => {
    const status = sphinx.status;
    const log = await api.sphinxLog();
    const summary = status.kind === 'error' ? `${status.message}\n\n` : '';
    await dialogs.current?.showText({ title: 'Sphinx build', text: `${summary}${log.trim() || 'Nothing logged yet.'}` });
  }, [sphinx]);

  const useEnvironment = useCallback((choice: EnvironmentChoice) => {
    setSphinxDialog(null);
    void api.useEnvironment(choice);
  }, []);

  const openProblem = useCallback(
    async (path: string, line: number | null) => {
      await openPage(path);
      setReveal(line);
    },
    [openPage],
  );

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
  const onRevealed = useCallback(() => setReveal(null), []);

  const pageProblems = useMemo(() => problemsIn(info, session?.path ?? null), [info, session?.path]);

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
  const docname = info && session ? docnameOf(info, session.path) : null;
  const uri = docname ? info?.docs[docname]?.uri : null;
  const previewUrl = uri && info ? `${api.buildUrl(uri)}?built=${info.builtAt}` : null;

  return (
    <div className="app">
      <Sidebar
        projectName={ws.project.name}
        files={ws.project.files}
        titles={ws.project.titles}
        sphinx={info}
        current={ws.current}
        unsaved={unsaved}
        onOpen={openPage}
        onOpenFolder={chooseFolder}
      />
      <main className="main">
        <Toolbar
          view={session && !sourceMode ? view : null}
          ctx={ctx}
          sourceMode={sourceMode}
          onToggleSource={toggleSource}
          previewAvailable={!!info}
          previewOpen={showPreview}
          onTogglePreview={() => setShowPreview(!showPreview)}
        />
        <TrustBanner
          state={sphinx}
          onUse={useEnvironment}
          onChooseOther={() => setSphinxDialog('environment')}
          onDecline={() => void api.declineSphinx()}
        />
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
        <div className={`workarea${showPreview && info ? ' with-preview' : ''}`}>
          <div className="scroll">
            {session && sourceMode && (
              <textarea className="source-view" value={source} spellCheck={false} aria-label="Markdown source" onChange={(e) => setSource(e.target.value)} />
            )}
            {session && !sourceMode && (
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
              />
            )}
            {!session && <div className="empty-state muted">Choose a page on the left.</div>}
          </div>
          {showPreview && info && <Preview url={previewUrl} building={sphinx.status.kind === 'building'} />}
        </div>
        {showProblems && info && (
          <ProblemsPanel
            warnings={info.warnings}
            titles={ws.project.titles}
            current={ws.current}
            onOpen={(path, line) => void openProblem(path, line)}
            onClose={() => setShowProblems(false)}
          />
        )}
        <StatusBar session={session} config={ws.project.config} confPy={ws.project.confPy}>
          <SphinxChip
            state={sphinx}
            problems={info?.warnings.length ?? 0}
            onShowProblems={() => setShowProblems(!showProblems)}
            onShowDetails={() => setSphinxDialog('details')}
            onEnable={() => setSphinxDialog('environment')}
          />
        </StatusBar>
      </main>
      {sphinxDialog === 'details' && (
        <SphinxDialog
          state={sphinx}
          onChangeEnvironment={() => setSphinxDialog('environment')}
          onRebuild={() => {
            void api.rebuild();
            setSphinxDialog(null);
          }}
          onShowLog={() => {
            setSphinxDialog(null);
            void showLog();
          }}
          onClose={() => setSphinxDialog(null)}
        />
      )}
      {sphinxDialog === 'environment' && <EnvironmentDialog state={sphinx} onUse={useEnvironment} onClose={() => setSphinxDialog(null)} />}
      <DialogHost ref={dialogs} />
    </div>
  );
}
