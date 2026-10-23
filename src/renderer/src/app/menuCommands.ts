// What the main process tells the window: menu commands, folders chosen from Open
// Recent, files changed on disk, the project's settings changing, and the window
// being closed (saving first, or asking about what couldn't be saved).
import { useEffect, useRef, type RefObject } from 'react';
import type { MenuCommand } from '../../../shared/api';
import type { Workspace } from '../workspace';
import type { DialogApi } from '../components/Dialogs';

const api = window.myst;

interface Handlers {
  ws: Workspace | null;
  onMenu: (cmd: MenuCommand) => void;
  openFolder: (folder: string) => void;
  // The project's settings changed: node views read them again.
  refreshViews: () => void;
}

export function useMainEvents(dialogs: RefObject<DialogApi | null>, handlers: Handlers) {
  // Through a ref, so the subscriptions stay and always reach the current state.
  const current = useRef(handlers);
  current.current = handlers;
  useEffect(() => {
    const offMenu = api.onMenu((cmd) => current.current.onMenu(cmd));
    const offRecent = api.onOpenFolderPath((folder) => current.current.openFolder(folder));
    const offFiles = api.onFilesChanged((e) => void current.current.ws?.externalChange(e.changed, e.files, e.titles));
    const offProject = api.onProjectChanged(({ project }) => {
      current.current.ws?.updateProject(project);
      current.current.refreshViews();
    });
    const offClose = api.onCloseRequested(async () => {
      const { ws } = current.current;
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
  }, [dialogs]);
}
