const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

function vaultPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

function saveToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS credential encryption is unavailable, so the token cannot be stored.');
  }
  const encrypted = safeStorage.encryptString(token).toString('base64');
  fs.writeFileSync(vaultPath(), JSON.stringify({ encrypted }), 'utf-8');
}

function loadToken() {
  try {
    const { encrypted } = JSON.parse(fs.readFileSync(vaultPath(), 'utf-8'));
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
}

function clearToken() {
  try {
    fs.unlinkSync(vaultPath());
  } catch {
    /* already gone */
  }
}

module.exports = { saveToken, loadToken, clearToken };
