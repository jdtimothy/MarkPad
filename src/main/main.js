const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const FILE_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] },
];

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
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

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

ipcMain.handle('dialog:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
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

ipcMain.handle('file:save', async (_event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:saveAs', async (_event, content) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
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

ipcMain.handle('dialog:confirmUnsaved', async () => {
  const { response } = await dialog.showMessageBox({
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
