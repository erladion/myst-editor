// The window's content: the sidebar, the page (formatted, or as Markdown), the status
// bar and the dialogs, put together from the hooks in app/ that do the work.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { OpenProgress } from '../../shared/api';
import type { EnvironmentChoice } from '../../shared/sphinx';
import type { BuildState } from '../../shared/build';
import type { GitInfo } from '../../shared/git';
import { configFor, projectFor } from '../../shared/projects';
import { Editor } from './editor/Editor';
import { nextAlert } from './editor/vale';
import { move as moveFind } from './editor/find';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Banner, StatusBar } from './components/Status';
import { DialogHost, type DialogApi } from './components/Dialogs';
import { EnvironmentDialog, Preview, ProblemsPanel, SphinxChip, SphinxDialog, TrustBanner } from './components/SphinxUi';
import { nextValeRemark, SourceEditor } from './components/SourceEditor';
import { LivePreview } from './components/LivePreview';
import { AdvancedBar } from './components/AdvancedBar';
import { AboutDialog } from './components/About';
import { ProjectSettingsDialog } from './components/ProjectSettings';
import { ExportPdfDialog } from './components/ExportPdf';
import { ShortcutsDialog } from './components/Shortcuts';
import { NewProjectDialog } from './components/NewProject';
import { CommandPalette } from './components/CommandPalette';
import { ChecksChip, ChecksPanel, type PageFindings } from './components/Checks';
import { checksOf, fixFinding, showFinding } from './editor/checks';
import { checkDoc } from '../../core/checks';
import { loadDocument } from '../../core/document';
import { editingFor } from './formats/editing';
import { builderFor } from './builders/builder';
import { pagesOf } from '../../core/format';
import { editorCommands, type PaletteCommand } from './app/palette';
import { ValeChip } from './components/ValeChip';
import { OpeningCard, Welcome } from './components/Welcome';
import { AskPassHost, BranchDialog, CloneDialog, ConflictsDialog, GitChip, GitPanel } from './components/GitUi';
import { NewPageDialog, RenamePageDialog } from './components/PageDialogs';
import { GoToPage, Outline } from './components/Navigation';
import { HistoryDialog } from './components/History';
import { FindBar } from './components/FindBar';
import { loadPlaces } from './places';
import { contentsPages, defaultContents, folderOf, pageFolders } from './pages';
import { problemsIn } from './build';
import { useStoredState } from './app/storedState';
import { useEditorContext } from './app/editorContext';
import { landingPage, useFolder } from './app/folder';
import { usePageActions } from './app/pageActions';
import { useScrollPlaces } from './app/scrollPlaces';
import { usePageHistory } from './app/pageHistory';
import { previewUrlOf, usePreviewBuild, usePreviewFollow } from './app/previews';
import { NO_ALERTS, useVale } from './app/vale';
import { useFind } from './app/find';
import { useEmacs, useShortcuts } from './app/keys';
import { useMainEvents } from './app/menuCommands';
import { useOutline } from './app/outline';
import { useStable } from './app/stable';

const api = window.myst;
const noop = () => () => {};
const zero = () => 0;
const NO_SPHINX: BuildState = { status: { kind: 'off' }, info: null, environment: null };

export function App() {
  const dialogs = useRef<DialogApi>(null);
  // Rich (formatted) editing, or the advanced view: Markdown beside a preview.
  const [mode, setMode] = useStoredState<'rich' | 'markdown'>('mysteditor.mode', 'rich');
  const [advancedPreview, setAdvancedPreview] = useStoredState<'live' | 'built' | 'off'>('mysteditor.advancedPreview', 'live');
  const [sourceLine, setSourceLine] = useState<number | null>(null); // where the writer is in the source
  const [gotoLine, setGotoLine] = useState<number | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  // Changes since the last commit, shown in the page: the page as committed.
  const [changesShown, setChangesShown] = useStoredState<'on' | 'off'>('mysteditor.changes', 'off');
  const changesOn = changesShown === 'on';
  const [changesBase, setChangesBase] = useState<PMNode | null>(null);
  const [changesNote, setChangesNote] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [about, setAbout] = useState(false);
  const closeAbout = useCallback(() => setAbout(false), []);
  const [projectSettings, setProjectSettings] = useState(false);
  const closeProjectSettings = useCallback(() => setProjectSettings(false), []);
  const [exportingPdf, setExportingPdf] = useState(false);
  const closeExportPdf = useCallback(() => setExportingPdf(false), []);
  const [shortcuts, setShortcuts] = useState(false);
  const closeShortcuts = useCallback(() => setShortcuts(false), []);
  // The command palette's own commands, as they were when it opened.
  const [palette, setPalette] = useState<PaletteCommand[] | null>(null);
  const closePalette = useCallback(() => setPalette(null), []);
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
  // Search all pages in the sidebar.
  const [searchAll, setSearchAll] = useState<{ focusKey: number } | null>(null);
  const [cloning, setCloning] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [opening, setOpening] = useState<OpenProgress | null>(null);
  const [goTo, setGoTo] = useState(false);
  const [history, setHistory] = useState<string | null>(null); // the page whose history is shown
  const [renaming, setRenaming] = useState<string | null>(null); // the page being renamed
  const [outline, setOutline] = useStoredState<'shown' | 'hidden'>('mysteditor.outline', 'hidden');
  // The New page dialog, with the folder it starts in (null: the current page's).
  const [newPage, setNewPage] = useState<{ folder: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  useEffect(() => api.onOpenProgress(setOpening), []);

  // The folder, and the editor's view of it (the context needs the folder, and the
  // folder tells it when another one opens).
  const reloadBuilds = useRef(() => {});
  const onFolderOpened = useCallback(() => reloadBuilds.current(), []);
  const onPageOpened = useCallback(() => setSourceLine(null), []);
  const { ws, starting, recentFolders, openPage, chooseFolder, openFolder, openCloned } = useFolder(dialogs, onFolderOpened, onPageOpened);
  const { ctx, buildStates, reloadBuildStates, refreshViews } = useEditorContext(dialogs, ws, openPage);
  reloadBuilds.current = reloadBuildStates;
  useSyncExternalStore(ws?.subscribe ?? noop, ws?.getVersion ?? zero);

  const session = ws?.get(ws.current);
  const projects = ws?.project.projects ?? [];
  // The open page's project; status and dialogs fall back to the first project.
  const pageProject = session ? projectFor(projects, session.path) : null;
  const activeProject = pageProject ?? projects[0] ?? null;
  const sphinx = (activeProject && buildStates[activeProject.id]) || NO_SPHINX;
  const info = (pageProject && buildStates[pageProject.id]?.info) || null;

  // The repository's state, pushed by the main process whenever it may have changed.
  useEffect(() => api.onGitInfo(setGitInfo), []);
  useEffect(() => {
    if (ws) void api.gitInfo().then(setGitInfo);
  }, [ws]);

  const onScroll = useScrollPlaces(ws, scrollRef, mode);
  const goInHistory = usePageHistory(ws, openPage, emacs);

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
    const log = activeProject ? await api.buildLog(activeProject.id) : '';
    const summary = status.kind === 'error' ? `${status.message}\n\n` : '';
    await dialogs.current?.showText({ title: 'Sphinx build', text: `${summary}${log.trim() || 'Nothing logged yet.'}` });
  }, [sphinx, activeProject]);

  const useEnvironment = useCallback((choice: EnvironmentChoice) => {
    setSphinxDialog(null);
    void api.useEnvironment(choice);
  }, []);

  // The page as committed, while changes are shown: again after git's news (a commit).
  const changesPath = changesOn && mode === 'rich' ? (session?.path ?? null) : null;
  useEffect(() => {
    if (!changesPath) {
      setChangesBase(null);
      setChangesNote(null);
      return;
    }
    let live = true;
    void api.pageAtHead(changesPath).then(({ repo, text }) => {
      if (!live) return;
      // Not committed yet: all of it is new.
      setChangesBase(loadDocument(text ?? '', ctx.config).doc);
      setChangesNote(!repo ? 'This folder isn’t a git repository: everything is new.' : text === null ? 'This page isn’t committed yet: all of it is new.' : null);
    });
    return () => {
      live = false;
    };
  }, [changesPath, gitInfo, ctx.config]);

  const openProblem = useCallback(
    async (path: string, line: number | null) => {
      await openPage(path);
      if (mode === 'markdown') setGotoLine(line);
      else setReveal(line);
    },
    [openPage, mode],
  );
  // Every page's checks: open pages as they are now, the rest as saved.
  const checkAll = useCallback(async (): Promise<PageFindings[]> => {
    if (!ws) return [];
    const out: PageFindings[] = [];
    for (const path of ws.project.files) {
      const text = ws.get(path) ? ws.sourceOf(path) : await api.readFile(path).catch(() => null);
      if (text === null) continue;
      const findings = checkDoc(loadDocument(text, configFor(ws.project, path)).doc);
      if (findings.length) out.push({ path, title: ws.project.titles[path] ?? path, findings });
    }
    return out;
  }, [ws]);
  const openFinding = useCallback(
    async (path: string, index: number) => {
      if (!(await openPage(path))) return;
      const v = viewRef.current;
      const f = v && checksOf(v.state)[index];
      if (v && f) showFinding(v, f);
    },
    [openPage],
  );
  // Its commands for the page, when one is open as formatted text.
  const openPalette = useCallback(() => setPalette(editorCommands(ctx, mode === 'rich' ? viewRef.current : null)), [ctx, mode]);

  const closers = useMemo(() => ({ history: () => setHistory(null), renaming: () => setRenaming(null), newPage: () => setNewPage(null) }), []);
  const { deletePage, restoreVersion, renamePage, moveInContentsOf, createPage } = usePageActions(ws, dialogs, openPage, buildStates, closers);

  const { find, setFind, openFind, showMatches } = useFind(viewRef, mode, session?.path ?? null);

  useMainEvents(dialogs, {
    ws,
    openFolder: (folder) => void openFolder(folder),
    refreshViews,
    onMenu: (cmd) => {
      if (cmd === 'open-folder') void chooseFolder();
      else if (cmd === 'clone') setCloning(true);
      else if (cmd === 'new-project') setNewProject(true);
      else if (cmd === 'toggle-source') toggleMode();
      else if (cmd === 'save' && ws?.current) void ws.save(ws.current);
      else if (cmd === 'new-page' && ws) setNewPage({ folder: null });
      else if (cmd === 'delete-page' && ws?.current) void deletePage(ws.current);
      else if (cmd === 'go-to-page' && ws) setGoTo(true);
      else if (cmd === 'go-back') goInHistory('back');
      else if (cmd === 'go-forward') goInHistory('forward');
      else if (cmd === 'page-history' && ws?.current) setHistory(ws.current);
      else if (cmd === 'switch-branch' && ws) setBranchesOpen(true);
      else if (cmd === 'rename-page' && ws?.current) setRenaming(ws.current);
      else if (cmd === 'find') openFind();
      else if (cmd === 'search-pages' && ws) setSearchAll((s) => ({ focusKey: (s?.focusKey ?? 0) + 1 }));
      else if (cmd === 'toggle-emacs') setKeyMode((k) => (k === 'emacs' ? 'standard' : 'emacs'));
      else if (cmd === 'about') setAbout(true);
      else if (cmd === 'project-settings' && ws) setProjectSettings(true);
      else if (cmd === 'export-pdf' && ws) setExportingPdf(true);
      else if (cmd === 'shortcuts') setShortcuts(true);
      else if (cmd === 'command-palette') openPalette();
      else if (cmd === 'toggle-outline') setOutline((o) => (o === 'shown' ? 'hidden' : 'shown'));
    },
  });

  useShortcuts({ emacs, openFind, toggleMode, openPalette, pageOpen: !!ws?.current, ctx, viewRef });
  useEmacs(
    emacs,
    {
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
    },
    viewRef,
  );

  const onChange = useCallback(
    (state: EditorState, docChanged: boolean) => {
      if (ws?.current) ws.update(ws.current, state, docChanged);
    },
    [ws],
  );
  const onRevealed = useCallback(() => setReveal(null), []);
  const onGotoDone = useCallback(() => setGotoLine(null), []);

  const textMode = mode === 'markdown' && session?.text != null;
  const { headings, currentHeading, pickHeading } = useOutline(session, textMode, sourceLine, viewRef, setGotoLine);

  // Pages that could list a new page, worked out once when the dialog opens.
  const newPageContents = useMemo(() => {
    if (!newPage || !ws) return Promise.resolve([] as string[]);
    const project = projectFor(ws.project.projects, ws.current ?? '') ?? ws.project.projects[0] ?? null;
    const built = (project && buildStates[project.id]?.info) || null;
    return contentsPages(ws, project, built, [ws.current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPage, ws]);
  const pageProblems = useMemo(() => problemsIn(info, session?.path ?? null), [info, session?.path]);
  // Hooks stay above the welcome screen's early return.
  const previewBuild = usePreviewBuild(builderFor(pageProject).fragments ? (pageProject?.id ?? null) : null, info, session);
  const notify = useCallback((m: string) => dialogs.current?.notify(m), []);
  const vale = useVale(session?.path ?? null, session?.savedText ?? null, ws?.project.root ?? null, notify);
  const preview = usePreviewFollow(ws, session, showPreview, scrollRef, viewRef);

  // The sidebar's props, unchanged while what it shows is, so it isn't drawn again on
  // every keystroke.
  const unsavedKey = ws ? ws.unsavedPaths().join('\n') : '';
  const unsaved = useMemo(() => new Set(unsavedKey ? unsavedKey.split('\n') : []), [unsavedKey]);
  const builds = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, buildStates[p.id]?.info ?? null])), [projects, buildStates]);
  const sidebar = {
    onOpen: useStable((path: string) => void openPage(path)),
    onOpenFolder: useStable(() => void chooseFolder()),
    onNewPage: useStable((folder: string | null) => setNewPage({ folder })),
    onDeletePage: useStable((path: string) => void deletePage(path)),
    onMoveInContents: useStable(moveInContentsOf),
    onHistory: useStable((path: string) => void openPage(path).then(() => setHistory(path))),
    onRename: useStable((path: string) => setRenaming(path)),
    saveAll: useStable(() => (ws ? ws.saveAll() : Promise.resolve(true))),
    onCloseSearch: useStable(() => setSearchAll(null)),
    onSearchResult: useStable((path: string, line: number, query: string, caseSensitive: boolean) => {
      // The page, at that line; in the formatted view with the find bar showing the matches.
      showMatches(path, query, caseSensitive);
      void openPage(path).then(() => (mode === 'rich' ? setReveal(line) : setGotoLine(line)));
    }),
  };

  if (!ws) {
    return (
      <Welcome opening={opening} starting={starting} recentFolders={recentFolders} onChoose={chooseFolder} onClone={() => setCloning(true)} onNewProject={() => setNewProject(true)} onOpenRecent={(f) => void openFolder(f)}>
        {cloning && (
          <CloneDialog
            onClose={() => setCloning(false)}
            onCloned={(folder) => {
              setCloning(false);
              void openCloned(folder);
            }}
          />
        )}
        {about && <AboutDialog builtWith={null} onClose={closeAbout} />}
        {palette && <CommandPalette commands={palette} onClose={closePalette} />}
        {shortcuts && <ShortcutsDialog emacs={emacs} onClose={closeShortcuts} />}
        {newProject && (
          <NewProjectDialog
            onClose={() => setNewProject(false)}
            onCreated={(folder, note) => {
              setNewProject(false);
              void openCloned(folder).then(() => note && dialogs.current?.notify(note));
            }}
          />
        )}
        <AskPassHost />
        <DialogHost ref={dialogs} />
      </Welcome>
    );
  }

  const previewUrl = previewUrlOf(pageProject?.id ?? null, info, session);
  // Trust and the environment are decided once for all of the folder's projects.
  const trustState = Object.values(buildStates).find((st) => st.status.kind === 'needs-trust') ?? sphinx;
  const allWarnings = Object.values(buildStates).flatMap((st) => st.info?.warnings ?? []);
  const anyBuilt = projects.some((p) => builds[p.id]);
  // Mistakes in .wysie.toml files, once each (a folder-level file applies to every project).
  const settingsProblems = [ws.project.defaultConfig, ...projects.map((p) => p.config)]
    .flatMap((c) => c.editor.problems)
    .filter((p, i, all) => all.findIndex((q) => q.file === p.file && q.message === p.message) === i);

  return (
    // When the pointer comes over something, the window catches up with the latest
    // edits (it hears of them when typing pauses), so buttons and menus show the page as
    // it is before they're clicked. (Not on the click itself: redrawing a button between
    // its mousedown and mouseup would lose the click.)
    <div className="app" onPointerOverCapture={() => ws.flushChanges()}>
      <OpeningCard opening={opening} />
      <Sidebar
        projectName={ws.project.name}
        files={ws.project.files}
        titles={ws.project.titles}
        projects={projects}
        builds={builds}
        current={ws.current}
        unsaved={unsaved}
        search={searchAll}
        {...sidebar}
      />
      <main className="main">
        {mode === 'markdown' ? (
          <AdvancedBar
            source={editingFor(configFor(ws.project, ws.current ?? '')).source.label}
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
            changes={{ on: changesOn, note: changesNote, onToggle: () => setChangesShown(changesOn ? 'off' : 'on') }}
          />
        )}
        <TrustBanner state={trustState} onUse={useEnvironment} onChooseOther={() => setSphinxDialog('environment')} onDecline={() => void api.declineSphinx()} />
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
              syntax={editingFor(configFor(ws.project, session.path)).source}
              problems={pageProblems}
              vale={vale.alerts?.alerts ?? NO_ALERTS}
              onAcceptWord={vale.alerts ? vale.acceptWord : undefined}
              onLine={setSourceLine}
              goto={gotoLine}
              onGotoDone={onGotoDone}
              onImage={ctx.addImage}
              onImageError={(m) => dialogs.current?.notify(m)}
            />
            {advancedPreview !== 'off' && (
              <div className="advanced-preview">
                {advancedPreview === 'live' ? (
                  <LivePreview key={session.path} text={session.text} ctx={ctx} savedText={session.savedText} build={previewBuild} viewAs={viewAs} line={sourceLine} onPick={setGotoLine} />
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
                preview.follow();
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
                  vale={vale.alerts}
                  changesBase={changesBase}
                  onAcceptWord={vale.alerts ? vale.acceptWord : undefined}
                />
              )}
              {!session && <div className="empty-state muted">Choose a page on the left.</div>}
            </div>
            {showPreview && info && <Preview url={previewUrl} building={sphinx.status.kind === 'building'} line={preview.line} />}
            {outline === 'shown' && session && <Outline headings={headings} current={currentHeading} onPick={pickHeading} onClose={() => setOutline('hidden')} />}
          </div>
        )}
        {showChecks && view && mode === 'rich' && (
          <ChecksPanel
            findings={checksOf(view.state)}
            onShow={(f) => showFinding(view, f)}
            onFix={(f) => void fixFinding(view, ctx, f)}
            checkAll={checkAll}
            onOpen={(path, i) => void openFinding(path, i)}
            onClose={() => setShowChecks(false)}
          />
        )}
        {showProblems && anyBuilt && (
          <ProblemsPanel warnings={allWarnings} titles={ws.project.titles} current={ws.current} onOpen={(path, line) => void openProblem(path, line)} onClose={() => setShowProblems(false)} />
        )}
        <StatusBar session={session} config={configFor(ws.project, session?.path ?? '')} marker={pageProject?.marker ?? null}>
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
          {view && mode === 'rich' && session && <ChecksChip count={checksOf(view.state).length} onClick={() => setShowChecks(!showChecks)} />}
          {vale.result && <ValeChip result={vale.result} onNext={() => (textMode ? nextValeRemark() : view && nextAlert(view))} onShowError={(text) => void dialogs.current?.showText({ title: 'Vale', text })} />}
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
      {cloning && (
        <CloneDialog
          onClose={() => setCloning(false)}
          onCloned={(folder) => {
            setCloning(false);
            void openCloned(folder);
          }}
        />
      )}
      {about && <AboutDialog builtWith={info?.builtWith ?? null} onClose={closeAbout} />}
      {palette && <CommandPalette commands={palette} onClose={closePalette} />}
      {shortcuts && <ShortcutsDialog emacs={emacs} onClose={closeShortcuts} />}
      {newProject && (
        <NewProjectDialog
          onClose={() => setNewProject(false)}
          onCreated={(folder, note) => {
            setNewProject(false);
            void openCloned(folder).then(() => note && dialogs.current?.notify(note));
          }}
        />
      )}
      {exportingPdf && <ExportPdfDialog projectId={activeProject?.id ?? null} onClose={closeExportPdf} />}
      {projectSettings && <ProjectSettingsDialog projectId={activeProject?.id ?? null} projectName={projects.length > 1 ? activeProject?.name : undefined} confVariables={(activeProject && buildStates[activeProject.id]?.info?.variables) || null} onClose={closeProjectSettings} />}
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
          contentsDefault={(folder, pages) => defaultContents(ws.project, folder, pages, pageProject)}
          extension={(folder) => pagesOf(configFor(ws.project, folder ? `${folder}/page` : 'page')).extension}
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
