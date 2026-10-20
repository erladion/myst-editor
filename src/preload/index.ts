// Exposes a narrow, typed API to the sandboxed renderer.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { ASSET_SCHEME, type MystApi } from '../shared/api.js';

function on<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: MystApi = {
  initialProject: () => ipcRenderer.invoke('initial-project'),
  chooseProject: () => ipcRenderer.invoke('choose-project'),
  openProject: (folder) => ipcRenderer.invoke('open-project', folder),
  readFile: (rel) => ipcRenderer.invoke('read-file', rel),
  writeFile: (rel, text) => ipcRenderer.invoke('write-file', rel, text),
  assetUrl: (rel) => `${ASSET_SCHEME}://project/${rel.split('/').map(encodeURIComponent).join('/')}`,
  setUnsaved: (unsaved) => ipcRenderer.send('set-unsaved', unsaved),
  closeWindow: () => ipcRenderer.send('close-window'),
  onFilesChanged: (cb) => on('files-changed', cb),
  onMenu: (cb) => on('menu', cb),
  onCloseRequested: (cb) => on('close-requested', () => cb()),
};

contextBridge.exposeInMainWorld('myst', api);
