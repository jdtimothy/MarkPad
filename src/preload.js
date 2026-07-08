const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('markpad', {});
