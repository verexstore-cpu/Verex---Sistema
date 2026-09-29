'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Único puente entre la interfaz y el sistema de archivos. No se expone Node a la página.
contextBridge.exposeInMainWorld('api', {
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  openImages: () => ipcRenderer.invoke('dialog:openImages'),
  chooseFolder: (title) => ipcRenderer.invoke('dialog:chooseFolder', title),
  expandPaths: (paths) => ipcRenderer.invoke('fs:expandPaths', paths),
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  exportWrite: (job) => ipcRenderer.invoke('export:write', job),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  confirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts),
  version: () => ipcRenderer.invoke('app:version'),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, paths) => cb(paths)),
});
