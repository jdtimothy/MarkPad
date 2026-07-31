const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('markpad', {
  openFile: () => ipcRenderer.invoke('dialog:open'),
  openImage: () => ipcRenderer.invoke('dialog:openImage'),
  saveFile: (path, content) => ipcRenderer.invoke('file:save', path, content),
  saveFileAs: (content) => ipcRenderer.invoke('dialog:saveAs', content),
  confirmUnsaved: () => ipcRenderer.invoke('dialog:confirmUnsaved'),
  onCloseRequested: (cb) => ipcRenderer.on('close-requested', () => cb()),
  confirmClose: () => ipcRenderer.send('close-confirmed'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onWindowStateChanged: (cb) => ipcRenderer.on('window-state-changed', (_event, state) => cb(state)),
  github: {
    connect: () => ipcRenderer.invoke('github:connect'),
    getAccount: () => ipcRenderer.invoke('github:getAccount'),
    signOut: () => ipcRenderer.invoke('github:signOut'),
    openExternal: (url) => ipcRenderer.invoke('github:openExternal', url),
    onDeviceCode: (cb) => ipcRenderer.on('github:device-code', (_e, payload) => cb(payload)),
  },
});
