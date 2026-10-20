import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import type { OpenProgress, ProjectInfo } from '../../shared/api';
import type { EnvironmentChoice, SphinxState } from '../../shared/sphinx';
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
import { EnvironmentDialog, Preview, ProblemsPanel, SphinxChip, SphinxDialog, TrustBanner } from './components/SphinxUi';
import { SourceEditor } from './components/SourceEditor';
import { LivePreview } from './components/LivePreview';
import { AdvancedBar } from './components/AdvancedBar';
import { AskPassHost, CloneDialog, GitChip, GitPanel } from './components/GitUi';
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
  const [reveal, setReveal] = useState<number | null>(null);
  const [sphinxDialog, setSphinxDialog] = useState<'details' | 'environment' | null>(null);
  const [viewAs, setViewAs] = useState<string[] | null>(null);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitPanel, setGitPanel] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [opening, setOpening] = useState<OpenProgress | null>(null);
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

  // Open the landing page of a newly opened project.
  useEffect(() => {
    if (ws && !ws.current) {
      const page = landingPage(ws.project);
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

  // Menu commands, external file changes and window closing.
  useEffect(() => {
    const offMenu = api.onMenu((cmd) => {
      if (cmd === 'open-folder') void chooseFolder();
      else if (cmd === 'clone') setCloning(true);
      else if (cmd === 'toggle-source') toggleMode();
      else if (cmd === 'save' && ws?.current) void ws.save(ws.current);
    });
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
      offFiles();
      offProject();
      offClose();
    };
  }, [ws, chooseFolder, toggleMode]);

  // Ctrl+/ switches between formatted editing and the Markdown view, wherever focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/' && ws?.current) {
        e.preventDefault();
        toggleMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws, toggleMode]);

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

  const pageProblems = useMemo(() => problemsIn(info, session?.path ?? null), [info, session?.path]);
  // Hooks stay above the welcome screen's early return.
  const previewBuild = usePreviewBuild(pageProject?.id ?? null, info && session ? docnameOf(info, session.path) : null, info?.builtAt ?? null);

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
          </div>
        )}
        {cloning && <CloneDialog onClose={() => setCloning(false)} onCloned={onCloned} />}
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
          />
        ) : (
        <Toolbar
          view={session ? view : null}
          ctx={ctx}
          onMarkdown={toggleMode}
          previewAvailable={!!info}
          previewOpen={showPreview}
          onTogglePreview={() => setShowPreview(!showPreview)}
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
              onLine={setSourceLine}
              goto={gotoLine}
              onGotoDone={onGotoDone}
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
                  <Preview url={previewUrl} building={sphinx.status.kind === 'building'} />
                )}
              </div>
            )}
          </div>
        ) : (
        <div className={`workarea${showPreview && info ? ' with-preview' : ''}`}>
          <div className="scroll">
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
              />
            )}
            {!session && <div className="empty-state muted">Choose a page on the left.</div>}
          </div>
          {showPreview && info && <Preview url={previewUrl} building={sphinx.status.kind === 'building'} />}
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
          <GitChip info={gitInfo} onOpen={() => setGitPanel(true)} />
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
        <GitPanel info={gitInfo} titles={ws.project.titles} saveAll={() => ws.saveAll()} onClose={() => setGitPanel(false)} />
      )}
      {cloning && <CloneDialog onClose={() => setCloning(false)} onCloned={onCloned} />}
      <AskPassHost />
      {sphinxDialog === 'details' && (
        <SphinxDialog
          state={sphinx}
          onChangeEnvironment={() => setSphinxDialog('environment')}
          project={projects.length > 1 ? activeProject?.name : undefined}
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
