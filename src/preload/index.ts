// Exposes a narrow, typed API to the sandboxed renderer.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { ASSET_SCHEME, BUILD_SCHEME, type MystApi } from '../shared/api.js';

function on<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: MystApi = {
  initialProject: () => ipcRenderer.invoke('initial-project'),
  chooseProject: () => ipcRenderer.invoke('choose-project'),
  openProject: (folder) => ipcRenderer.invoke('open-project', folder),
  chooseImage: (page) => ipcRenderer.invoke('choose-image', page),
  readFile: (rel) => ipcRenderer.invoke('read-file', rel),
  writeFile: (rel, text) => ipcRenderer.invoke('write-file', rel, text),
  assetUrl: (rel) => `${ASSET_SCHEME}://project/${rel.split('/').map(encodeURIComponent).join('/')}`,
  setUnsaved: (unsaved) => ipcRenderer.send('set-unsaved', unsaved),
  closeWindow: () => ipcRenderer.send('close-window'),
  onFilesChanged: (cb) => on('files-changed', cb),
  onOpenProgress: (cb) => on('open-progress', cb),
  onProjectChanged: (cb) => on('project-changed', cb),
  onMenu: (cb) => on('menu', cb),
  onCloseRequested: (cb) => on('close-requested', () => cb()),
  sphinxState: () => ipcRenderer.invoke('sphinx-state'),
  onSphinxState: (cb) => on('sphinx-state', cb),
  useEnvironment: (choice) => ipcRenderer.invoke('sphinx-use', choice),
  pythonCandidates: () => ipcRenderer.invoke('sphinx-candidates'),
  browsePython: () => ipcRenderer.invoke('sphinx-browse-python'),
  declineSphinx: () => ipcRenderer.invoke('sphinx-decline'),
  rebuild: (project) => ipcRenderer.invoke('sphinx-rebuild', project),
  sphinxLog: (project) => ipcRenderer.invoke('sphinx-log', project),
  gitInfo: () => ipcRenderer.invoke('git-info'),
  onGitInfo: (cb) => on('git-info', cb),
  gitClone: (url, parent) => ipcRenderer.invoke('git-clone', url, parent),
  onGitProgress: (cb) => on('git-progress', cb),
  chooseFolder: (title) => ipcRenderer.invoke('choose-folder', title),
  defaultCloneFolder: () => ipcRenderer.invoke('default-clone-folder'),
  gitCommit: (paths, message, push) => ipcRenderer.invoke('git-commit', paths, message, push),
  gitPush: () => ipcRenderer.invoke('git-push'),
  gitPull: () => ipcRenderer.invoke('git-pull'),
  gitSetIdentity: (name, email, global) => ipcRenderer.invoke('git-set-identity', name, email, global),
  onAskPass: (cb) => on('askpass', cb),
  answerAskPass: (id, answer) => ipcRenderer.send('askpass-answer', id, answer),
  buildUrl: (project, uri) => `${BUILD_SCHEME}://${project}/${uri.split('/').map(encodeURIComponent).join('/')}`,
};

contextBridge.exposeInMainWorld('myst', api);
