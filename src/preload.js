const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('markpad', {
  openFile: () => ipcRenderer.invoke('dialog:open'),
  saveFile: (path, content) => ipcRenderer.invoke('file:save', path, content),
  saveFileAs: (content) => ipcRenderer.invoke('dialog:saveAs', content),
  confirmUnsaved: () => ipcRenderer.invoke('dialog:confirmUnsaved'),
  onCloseRequested: (cb) => ipcRenderer.on('close-requested', cb),
  confirmClose: () => ipcRenderer.send('close-confirmed'),
});
