// The open folder: the one from the last session (or the command line) at start,
// opening another (saving first, or asking about what couldn't be saved), the page to
// show in it, and the recent folders for the welcome screen.
import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { ProjectInfo } from '../../../shared/api';
import { fromProject } from '../../../shared/projects';
import { Workspace } from '../workspace';
import type { DialogApi } from '../components/Dialogs';
import { loadPlaces } from '../places';

const api = window.myst;

// An IPC error as the writer reads it.
export const plainError = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// The page to show when a folder opens: the first project's root page if there is one.
export function landingPage(info: ProjectInfo): string | null {
  const { files, projects } = info;
  return (
    projects.map((p) => fromProject(p, 'index.md')).find((f) => files.includes(f)) ??
    files.find((f) => f === 'index.md') ??
    files.find((f) => f.endsWith('/index.md')) ??
    files[0] ??
    null
  );
}

// onOpened: a folder was opened; onPageOpened: a page was.
export function useFolder(dialogs: RefObject<DialogApi | null>, onOpened: (project: ProjectInfo) => void, onPageOpened: () => void) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [starting, setStarting] = useState(true);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);

  // Whether it opened.
  const openPage = useCallback(
    async (path: string) => {
      if (!ws) return false;
      try {
        await ws.open(path);
        onPageOpened();
        return true;
      } catch (e) {
        dialogs.current?.notify(`Couldn’t open ${path}: ${e instanceof Error ? e.message : e}`);
        return false;
      }
    },
    [ws, dialogs, onPageOpened],
  );

  const useProject = useCallback(
    async (project: ProjectInfo | null) => {
      if (!project) return;
      setWs((old) => {
        old?.dispose();
        return new Workspace(api, project);
      });
      onOpened(project);
    },
    [onOpened],
  );

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
  }, [ws, dialogs]);

  const chooseFolder = useCallback(async () => {
    if (await canLeave()) await useProject(await api.chooseProject());
  }, [canLeave, useProject]);

  const openFolder = useCallback(
    async (folder: string) => {
      if (!(await canLeave())) return;
      try {
        await useProject(await api.openProject(folder));
      } catch (e) {
        dialogs.current?.notify(`Couldn’t open ${folder}: ${plainError(e)}`);
      }
    },
    [canLeave, useProject, dialogs],
  );

  // A repository just cloned.
  const openCloned = useCallback(
    async (folder: string) => {
      if (ws && !(await ws.saveAll())) return;
      await useProject(await api.openProject(folder));
    },
    [ws, useProject],
  );

  return { ws, starting, recentFolders, openPage, chooseFolder, openFolder, openCloned };
}
