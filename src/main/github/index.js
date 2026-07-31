const { ipcMain, shell } = require('electron');
const { createClient } = require('./client.js');
const { requestDeviceCode, pollForToken } = require('./auth.js');
const vault = require('./vault.js');

// The OAuth App client ID is a public value and safe to commit. Device flow
// uses no client secret. Replace this placeholder with the real ID after
// registering the app (see README); until then, connect() fails with GitHub's
// own error, which the sidebar surfaces in the error banner.
const CLIENT_ID = 'REPLACE_WITH_OAUTH_APP_CLIENT_ID';

let token = null;
let account = null;

const client = createClient({ fetch, getToken: () => token });
const sleep = (seconds) => new Promise((r) => setTimeout(r, seconds * 1000));

async function fetchAccount() {
  const user = await client.request('GET', '/user');
  account = { login: user.login };
  return account;
}

function registerGitHubHandlers() {
  token = vault.loadToken();

  ipcMain.handle('github:getAccount', async () => {
    if (!token) return null;
    try {
      return await fetchAccount();
    } catch (err) {
      if (err.code === 'unauthorized') {
        token = null;
        account = null;
        vault.clearToken();
      }
      return null;
    }
  });

  ipcMain.handle('github:connect', async (event) => {
    const sender = event.sender;
    try {
      const device = await requestDeviceCode({ fetch, clientId: CLIENT_ID, scope: 'repo' });
      sender.send('github:device-code', {
        userCode: device.userCode,
        verificationUri: device.verificationUri,
      });
      const { accessToken } = await pollForToken({
        fetch,
        clientId: CLIENT_ID,
        deviceCode: device.deviceCode,
        interval: device.interval,
        expiresIn: device.expiresIn,
        sleep,
      });
      token = accessToken;
      vault.saveToken(accessToken);
      return { ok: true, account: await fetchAccount() };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null };
    }
  });

  ipcMain.handle('github:signOut', async () => {
    token = null;
    account = null;
    vault.clearToken();
    return { ok: true };
  });

  ipcMain.handle('github:openExternal', async (_event, url) => {
    if (/^https:\/\/(github\.com|www\.github\.com)\//.test(url)) await shell.openExternal(url);
    return { ok: true };
  });
}

module.exports = { registerGitHubHandlers, getClient: () => client, hasToken: () => Boolean(token) };
