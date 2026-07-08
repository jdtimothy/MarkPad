const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');

const FILE_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] },
];

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
  { name: 'All Files', extensions: ['*'] },
];

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Close guard: the renderer owns dirty state. Ask it before closing;
  // it replies with 'close-confirmed' once the user has decided.
  let closeConfirmed = false;
  win.on('close', (e) => {
    if (!closeConfirmed) {
      e.preventDefault();
      win.webContents.send('close-requested');
    }
  });
  ipcMain.on('close-confirmed', () => {
    closeConfirmed = true;
    win.close();
  });

  // Guard against the renderer navigating (or spawning a new window into)
  // a remote origin, which would re-attach the preload bridge there.
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

ipcMain.handle('dialog:open', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    filters: FILE_FILTERS,
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { path: filePath, name: path.basename(filePath), content };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('dialog:openImage', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    filters: IMAGE_FILTERS,
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  return {
    path: filePath,
    name: path.basename(filePath),
    url: pathToFileURL(filePath).href,
  };
});

ipcMain.handle('file:save', async (_event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:saveAs', async (event, content) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    filters: FILE_FILTERS,
    defaultPath: 'untitled.md',
  });
  if (canceled || !filePath) return null;
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { ok: true, path: filePath, name: path.basename(filePath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:confirmUnsaved', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(parent, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: 'You have unsaved changes.',
    detail: 'Do you want to save them?',
  });
  return response;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
