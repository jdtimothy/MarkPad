# GitHub Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let MarkPad open markdown files straight from a GitHub repository, commit changes back to a chosen branch, create new posts, upload images, rename/delete files, and open a pull request — without a local clone.

**Architecture:** All GitHub HTTP lives in the Electron **main** process; the OAuth token never crosses into the renderer. Reads use the Contents and Trees endpoints. Every write — save, new post, image upload, rename, delete — funnels through one multi-file `commit()` primitive built on the Git Data API (blob → tree → commit → update-ref), which makes commits atomic and gives non-fast-forward conflict detection for free. In the renderer, a new `doc-source.js` abstraction replaces the current hardcoded "a document is a local path" assumption with `{kind:'local'}` and `{kind:'repo'}` implementations.

**Tech Stack:** Electron 43 (main: CommonJS, `require`), plain ES-module renderer bundled by esbuild, Vitest 4 for tests (jsdom opt-in per file), Node 18+ global `fetch`, Electron `safeStorage` for the token vault. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-github-integration-design.md`

## Global Constraints

- **No new npm dependencies.** Use Node's global `fetch` and Electron built-ins only.
- **The token never reaches the renderer.** No IPC handler may return the access token; the renderer receives only the account login and API results.
- **Main-process files use CommonJS** (`require` / `module.exports`) to match `src/main/main.js`. Renderer files use ES modules.
- **Every new module that performs HTTP takes `fetch` as an injected parameter** so tests never touch the network.
- **Preserve the existing security posture:** `contextIsolation: true`, `nodeIntegration: false`, and the `will-navigate` / `setWindowOpenHandler` guards in `src/main/main.js:57-64` stay untouched. The renderer's CSP (`default-src 'self'`) is not to be relaxed.
- **Preserve DOMPurify sanitization** on every rendered-HTML path.
- **`Ctrl+B` is already Bold** (`src/renderer/ui.js:449`). The sidebar toggle is `Ctrl+Shift+B`.
- **Local file editing must keep working unchanged** through every task.
- **Every task ends with `npm test` passing** before its commit.
- API base URLs: `https://api.github.com` for REST, `https://github.com` for the two device-flow endpoints.

---

## File Structure

**Created — main process:**

| File | Responsibility |
|---|---|
| `src/main/github/client.js` | HTTP wrapper: auth header, query building, JSON parsing, status → error-code mapping |
| `src/main/github/auth.js` | Device-flow state machine (pure; injected `fetch` and `sleep`) |
| `src/main/github/vault.js` | Token at rest via `safeStorage` (the only Electron-coupled GitHub file) |
| `src/main/github/repo.js` | Repo/branch/tree/file reads, the `commit()` primitive, branch and PR creation |
| `src/main/github/index.js` | Registers all `ipcMain` handlers; owns the in-memory token |

**Created — renderer:**

| File | Responsibility |
|---|---|
| `src/renderer/github-tree.js` | Pure: flat path list → nested tree, markdown filtering, sorting |
| `src/renderer/github-paths.js` | Pure: slugs, new-post paths, image collision suffixes, link style both ways |
| `src/renderer/repo-config.js` | Per-repo settings (content dir, image dir, link style) in local storage |
| `src/renderer/doc-source.js` | The local-vs-repo document source abstraction |
| `src/renderer/github-panel.js` | Sidebar UI: connect, repo picker, branch picker, file tree, context menu |
| `src/renderer/commit-bar.js` | The commit-message bar and the conflict dialog |

**Modified:** `src/preload.js` (new `github` namespace), `src/main/main.js` (register handlers), `src/renderer/index.js` (delegate to `doc-source`), `src/renderer/index.html` (sidebar, dialogs), `src/renderer/styles.css` (sidebar styling), `src/renderer/ui.js` (image staging hook, sidebar shortcut), `src/renderer/preview.js` (image source resolution).

**Created — tests:** `tests/github-client.test.js`, `tests/github-auth.test.js`, `tests/github-tree.test.js`, `tests/github-commit.test.js`, `tests/github-paths.test.js`, `tests/doc-source.test.js`.

---

# Phase 1 — Connect and Browse

### Task 1: HTTP client with error mapping

**Files:**
- Create: `src/main/github/client.js`
- Test: `tests/github-client.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createClient({ fetch, getToken, apiBase })` → `{ request(method, path, opts) }`. `opts` is `{ body, query }`. Resolves to parsed JSON (or `null` for 204). Rejects with a `GitHubError` having `{ name: 'GitHubError', status, code, message, resetAt }` where `code` is one of `unauthorized | rate_limited | not_found | conflict | unprocessable | offline | http_error`.

- [ ] **Step 1: Write the failing test**

Create `tests/github-client.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createClient } from '../src/main/github/client.js';

function fakeFetch(response, capture = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.init = init;
    return response;
  };
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

describe('createClient', () => {
  it('sends the token and the API version header', async () => {
    const capture = {};
    const client = createClient({
      fetch: fakeFetch(jsonResponse(200, { login: 'octocat' }), capture),
      getToken: () => 'tok_123',
    });
    await client.request('GET', '/user');
    expect(capture.url).toBe('https://api.github.com/user');
    expect(capture.init.headers.Authorization).toBe('Bearer tok_123');
    expect(capture.init.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('builds a query string and JSON-encodes the body', async () => {
    const capture = {};
    const client = createClient({
      fetch: fakeFetch(jsonResponse(201, {}), capture),
      getToken: () => 't',
    });
    await client.request('POST', '/repos/o/r/pulls', {
      query: { head: 'o:feature', state: 'open' },
      body: { title: 'hi' },
    });
    expect(capture.url).toBe('https://api.github.com/repos/o/r/pulls?head=o%3Afeature&state=open');
    expect(capture.init.body).toBe('{"title":"hi"}');
    expect(capture.init.headers['Content-Type']).toBe('application/json');
  });

  it('returns null for 204', async () => {
    const client = createClient({
      fetch: fakeFetch(jsonResponse(204, null)),
      getToken: () => 't',
    });
    expect(await client.request('DELETE', '/x')).toBeNull();
  });

  it('maps 401 to unauthorized', async () => {
    const client = createClient({
      fetch: fakeFetch(jsonResponse(401, { message: 'Bad credentials' })),
      getToken: () => 't',
    });
    await expect(client.request('GET', '/user')).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    });
  });

  it('maps an exhausted rate limit to rate_limited with a reset time', async () => {
    const client = createClient({
      fetch: fakeFetch(jsonResponse(403, { message: 'rate limit' }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1900000000',
      })),
      getToken: () => 't',
    });
    await expect(client.request('GET', '/user')).rejects.toMatchObject({
      code: 'rate_limited',
      resetAt: 1900000000,
    });
  });

  it('maps 403 without an exhausted limit to http_error', async () => {
    const client = createClient({
      fetch: fakeFetch(jsonResponse(403, { message: 'forbidden' }, {
        'x-ratelimit-remaining': '4999',
      })),
      getToken: () => 't',
    });
    await expect(client.request('GET', '/user')).rejects.toMatchObject({
      code: 'http_error',
    });
  });

  it('maps 404, 409 and 422 and keeps GitHub\'s message', async () => {
    const cases = [[404, 'not_found'], [409, 'conflict'], [422, 'unprocessable']];
    for (const [status, code] of cases) {
      const client = createClient({
        fetch: fakeFetch(jsonResponse(status, { message: 'boom' })),
        getToken: () => 't',
      });
      await expect(client.request('GET', '/x')).rejects.toMatchObject({
        code,
        message: 'boom',
      });
    }
  });

  it('maps a network failure to offline', async () => {
    const client = createClient({
      fetch: async () => { throw new TypeError('fetch failed'); },
      getToken: () => 't',
    });
    await expect(client.request('GET', '/x')).rejects.toMatchObject({
      code: 'offline',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/github-client.test.js`
Expected: FAIL — cannot resolve `../src/main/github/client.js`.

- [ ] **Step 3: Write the implementation**

Create `src/main/github/client.js`:

```js
const API_BASE = 'https://api.github.com';

class GitHubError extends Error {
  constructor({ status, code, message, resetAt }) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.code = code;
    this.resetAt = resetAt ?? null;
  }
}

function classify(status, headers) {
  if (status === 401) return 'unauthorized';
  if (status === 403 && headers.get('x-ratelimit-remaining') === '0') return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'unprocessable';
  return 'http_error';
}

function createClient({ fetch, getToken, apiBase = API_BASE }) {
  async function request(method, path, { body, query } = {}) {
    let url = `${apiBase}${path}`;
    if (query) {
      const qs = new URLSearchParams(query).toString();
      if (qs) url += `?${qs}`;
    }
    const headers = {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new GitHubError({
        status: 0,
        code: 'offline',
        message: `Can't reach GitHub (${err.message})`,
      });
    }

    if (res.status === 204) return null;

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const code = classify(res.status, res.headers);
      const reset = res.headers.get('x-ratelimit-reset');
      throw new GitHubError({
        status: res.status,
        code,
        message: payload?.message || `GitHub returned ${res.status}`,
        resetAt: code === 'rate_limited' && reset ? Number(reset) : null,
      });
    }
    return payload;
  }

  return { request };
}

module.exports = { createClient, GitHubError };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/github-client.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — existing tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/main/github/client.js tests/github-client.test.js
git commit -m "feat(github): add API client with error mapping"
```

---

### Task 2: OAuth device-flow state machine

**Files:**
- Create: `src/main/github/auth.js`
- Test: `tests/github-auth.test.js`

**Interfaces:**
- Consumes: nothing (deliberately independent of `client.js` — the device-flow endpoints live on `github.com`, not the API host, and are unauthenticated).
- Produces:
  - `requestDeviceCode({ fetch, clientId, scope })` → `{ deviceCode, userCode, verificationUri, interval, expiresIn }`
  - `pollForToken({ fetch, clientId, deviceCode, interval, expiresIn, sleep })` → `{ accessToken }`; rejects with `Error` whose `.code` is `expired_token`, `access_denied`, or `device_flow_disabled`.

Notes for the implementer: GitHub returns HTTP 200 with an `error` field for the pending states — do not treat a non-2xx status as the signal. `slow_down` responses carry a new, longer `interval` that must be adopted. Both endpoints need `Accept: application/json`, otherwise GitHub replies with form-encoded text.

- [ ] **Step 1: Write the failing test**

Create `tests/github-auth.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { requestDeviceCode, pollForToken } from '../src/main/github/auth.js';

function scriptedFetch(responses, capture = { calls: [] }) {
  return async (url, init) => {
    capture.calls.push({ url, init });
    const body = responses.shift();
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async json() { return body; },
    };
  };
}

describe('requestDeviceCode', () => {
  it('posts the client id and normalizes the response', async () => {
    const capture = { calls: [] };
    const fetch = scriptedFetch([{
      device_code: 'dev123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900,
    }], capture);

    const result = await requestDeviceCode({ fetch, clientId: 'cid', scope: 'repo' });

    expect(capture.calls[0].url).toBe('https://github.com/login/device/code');
    expect(capture.calls[0].init.headers.Accept).toBe('application/json');
    expect(JSON.parse(capture.calls[0].init.body)).toEqual({ client_id: 'cid', scope: 'repo' });
    expect(result).toEqual({
      deviceCode: 'dev123',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      interval: 5,
      expiresIn: 900,
    });
  });
});

describe('pollForToken', () => {
  it('waits through authorization_pending and returns the token', async () => {
    const slept = [];
    const fetch = scriptedFetch([
      { error: 'authorization_pending' },
      { error: 'authorization_pending' },
      { access_token: 'gho_abc', token_type: 'bearer' },
    ]);
    const result = await pollForToken({
      fetch, clientId: 'cid', deviceCode: 'dev123',
      interval: 5, expiresIn: 900,
      sleep: async (s) => { slept.push(s); },
    });
    expect(result).toEqual({ accessToken: 'gho_abc' });
    expect(slept).toEqual([5, 5, 5]);
  });

  it('adopts the longer interval after slow_down', async () => {
    const slept = [];
    const fetch = scriptedFetch([
      { error: 'slow_down', interval: 10 },
      { access_token: 'gho_abc' },
    ]);
    await pollForToken({
      fetch, clientId: 'cid', deviceCode: 'd',
      interval: 5, expiresIn: 900,
      sleep: async (s) => { slept.push(s); },
    });
    expect(slept).toEqual([5, 10]);
  });

  it('rejects with access_denied when the user cancels', async () => {
    const fetch = scriptedFetch([{ error: 'access_denied' }]);
    await expect(pollForToken({
      fetch, clientId: 'c', deviceCode: 'd',
      interval: 1, expiresIn: 900, sleep: async () => {},
    })).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('rejects with expired_token when GitHub reports expiry', async () => {
    const fetch = scriptedFetch([{ error: 'expired_token' }]);
    await expect(pollForToken({
      fetch, clientId: 'c', deviceCode: 'd',
      interval: 1, expiresIn: 900, sleep: async () => {},
    })).rejects.toMatchObject({ code: 'expired_token' });
  });

  it('gives up once the elapsed sleep exceeds expiresIn', async () => {
    const fetch = scriptedFetch(Array(100).fill({ error: 'authorization_pending' }));
    await expect(pollForToken({
      fetch, clientId: 'c', deviceCode: 'd',
      interval: 5, expiresIn: 12, sleep: async () => {},
    })).rejects.toMatchObject({ code: 'expired_token' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/github-auth.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/github/auth.js`:

```js
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

function authError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function postJson(fetch, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function requestDeviceCode({ fetch, clientId, scope = 'repo' }) {
  const data = await postJson(fetch, DEVICE_CODE_URL, { client_id: clientId, scope });
  if (data.error) throw authError(data.error, data.error_description || data.error);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval ?? 5,
    expiresIn: data.expires_in ?? 900,
  };
}

async function pollForToken({ fetch, clientId, deviceCode, interval, expiresIn, sleep }) {
  let wait = interval;
  let elapsed = 0;

  while (elapsed < expiresIn) {
    await sleep(wait);
    elapsed += wait;

    const data = await postJson(fetch, TOKEN_URL, {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: GRANT_TYPE,
    });

    if (data.access_token) return { accessToken: data.access_token };

    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      wait = data.interval ?? wait + 5;
      continue;
    }
    throw authError(data.error || 'unknown', data.error_description || 'Device flow failed');
  }
  throw authError('expired_token', 'The device code expired. Try connecting again.');
}

module.exports = { requestDeviceCode, pollForToken };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/github-auth.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/github/auth.js tests/github-auth.test.js
git commit -m "feat(github): add OAuth device-flow state machine"
```

---

### Task 3: Token vault, IPC handlers, and the Connect dialog

This is the first task that produces something visible: you can click "Connect to GitHub", authorize in the browser, and see your login name in the app.

**Files:**
- Create: `src/main/github/vault.js`, `src/main/github/index.js`, `src/renderer/github-panel.js`
- Modify: `src/main/main.js`, `src/preload.js`, `src/renderer/index.html`, `src/renderer/index.js`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: `requestDeviceCode`, `pollForToken` (Task 2); `createClient` (Task 1).
- Produces:
  - Main: `registerGitHubHandlers({ clientId })` — installs all `github:*` IPC handlers.
  - Preload: `window.markpad.github` with `connect()`, `getAccount()`, `signOut()`, `onDeviceCode(cb)`.
  - Renderer: `createGitHubPanel(container, { onError })` → `{ refreshAccount() }`. Later tasks extend this return value.

`vault.js` is the only GitHub file that imports Electron, and it is not unit tested — keep it to the four functions below so there is nothing in it worth testing.

- [ ] **Step 1: Create the token vault**

Create `src/main/github/vault.js`:

```js
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
```

- [ ] **Step 2: Register the IPC handlers**

Create `src/main/github/index.js`. The `CLIENT_ID` constant is the OAuth App client ID — a public value, safe to commit. Replace the placeholder string with the real one after registering the app (see the spec's Prerequisite section); until then, `connect()` fails with GitHub's own `device_flow_disabled`-style error, which the UI surfaces.

```js
const { ipcMain, shell, BrowserWindow } = require('electron');
const { createClient } = require('./client.js');
const { requestDeviceCode, pollForToken } = require('./auth.js');
const vault = require('./vault.js');

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
```

Then in `src/main/main.js`, add the require near the other requires at the top:

```js
const { registerGitHubHandlers } = require('./github/index.js');
```

and call it inside the existing `app.whenReady()` chain at the bottom of the file, replacing `app.whenReady().then(createWindow);` with:

```js
app.whenReady().then(() => {
  registerGitHubHandlers();
  createWindow();
});
```

- [ ] **Step 3: Extend the preload bridge**

In `src/preload.js`, add a `github` key to the object passed to `exposeInMainWorld` (keep every existing key):

```js
  github: {
    connect: () => ipcRenderer.invoke('github:connect'),
    getAccount: () => ipcRenderer.invoke('github:getAccount'),
    signOut: () => ipcRenderer.invoke('github:signOut'),
    openExternal: (url) => ipcRenderer.invoke('github:openExternal', url),
    onDeviceCode: (cb) => ipcRenderer.on('github:device-code', (_e, payload) => cb(payload)),
  },
```

- [ ] **Step 4: Add the sidebar and device-code dialog markup**

In `src/renderer/index.html`, replace the `<main id="content">` block with a version that has the sidebar as a sibling of the panes:

```html
  <main id="content">
    <aside id="gh-sidebar" class="hidden"></aside>
    <div id="editor-pane" class="hidden"></div>
    <div id="preview-pane" contenteditable="true" spellcheck="true"></div>
  </main>
```

Add this dialog just before the closing `</body>`, next to `#url-dialog`:

```html
  <dialog id="device-dialog">
    <h3>Connect to GitHub</h3>
    <p>Enter this code on GitHub to authorize MarkPad:</p>
    <div id="device-code" class="device-code">········</div>
    <div class="dialog-buttons">
      <button id="device-copy" type="button">Copy code</button>
      <button id="device-open" type="button">Open GitHub</button>
      <button id="device-cancel" type="button">Cancel</button>
    </div>
  </dialog>
```

- [ ] **Step 5: Write the panel's connect flow**

Create `src/renderer/github-panel.js`:

```js
export function createGitHubPanel(container, { onError = () => {} } = {}) {
  const dialog = document.getElementById('device-dialog');
  const codeEl = document.getElementById('device-code');
  let account = null;

  window.markpad.github.onDeviceCode(({ userCode, verificationUri }) => {
    codeEl.textContent = userCode;
    codeEl.dataset.uri = verificationUri;
    if (!dialog.open) dialog.showModal();
  });

  document.getElementById('device-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(codeEl.textContent);
  });
  document.getElementById('device-open').addEventListener('click', () => {
    window.markpad.github.openExternal(codeEl.dataset.uri);
  });
  document.getElementById('device-cancel').addEventListener('click', () => dialog.close());

  async function connect() {
    const result = await window.markpad.github.connect();
    dialog.close();
    if (!result.ok) {
      onError(`GitHub sign-in failed: ${result.error}`);
      return;
    }
    account = result.account;
    render();
  }

  async function signOut() {
    await window.markpad.github.signOut();
    account = null;
    render();
  }

  function render() {
    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'gh-header';
    if (!account) {
      const button = document.createElement('button');
      button.textContent = 'Connect to GitHub';
      button.addEventListener('click', connect);
      header.append(button);
    } else {
      const who = document.createElement('span');
      who.className = 'gh-login';
      who.textContent = account.login;
      const out = document.createElement('button');
      out.textContent = 'Sign out';
      out.addEventListener('click', signOut);
      header.append(who, out);
    }
    container.append(header);
  }

  async function refreshAccount() {
    account = await window.markpad.github.getAccount();
    render();
  }

  render();
  return { refreshAccount, isConnected: () => Boolean(account) };
}
```

- [ ] **Step 6: Wire the panel into the renderer**

In `src/renderer/index.js`, add the import alongside the existing ones:

```js
import { createGitHubPanel } from './github-panel.js';
```

and after the `fmPanel = createFrontmatterPanel(...)` assignment, add:

```js
const ghPanel = createGitHubPanel(document.getElementById('gh-sidebar'), {
  onError: (msg) => ui.showError(msg),
});
ghPanel.refreshAccount();
```

- [ ] **Step 7: Add the sidebar toggle shortcut**

In `src/renderer/ui.js`, inside the `shortcuts` object at line ~448, add a `b`-with-shift branch by replacing the `b: actions.bold,` line with:

```js
      b: e.shiftKey
        ? () => document.getElementById('gh-sidebar')?.classList.toggle('hidden')
        : actions.bold,
```

- [ ] **Step 8: Style the sidebar**

In `src/renderer/styles.css`, append:

```css
#gh-sidebar {
  width: 260px;
  flex: 0 0 260px;
  overflow-y: auto;
  padding: 10px;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 13px;
}
#gh-sidebar.hidden { display: none; }
.gh-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.gh-login { font-weight: 600; flex: 1; }
.device-code {
  font-family: monospace;
  font-size: 26px;
  letter-spacing: 4px;
  text-align: center;
  padding: 12px;
}
```

- [ ] **Step 9: Verify by hand**

Run: `npm start`
Expected: `Ctrl+Shift+B` shows and hides a sidebar containing a "Connect to GitHub" button. `Ctrl+B` still bolds text. Opening, editing and saving a local file all behave exactly as before. (Clicking Connect fails until the real client ID is in place — that is expected at this step, and the error appears in the red banner rather than crashing.)

- [ ] **Step 10: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/main/github src/main/main.js src/preload.js src/renderer/github-panel.js src/renderer/index.js src/renderer/index.html src/renderer/styles.css
git commit -m "feat(github): add token vault, IPC handlers and connect flow"
```

---

### Task 4: Nested tree builder

**Files:**
- Create: `src/renderer/github-tree.js`
- Test: `tests/github-tree.test.js`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `buildTree(entries)` where `entries` is the raw `tree` array from GitHub (`{ path, type, sha }`). Returns an array of nodes: `{ type: 'dir', name, path, children }` or `{ type: 'file', name, path, sha }`. Only `.md`/`.markdown` blobs are kept; directories containing none are dropped; directories sort before files, each alphabetically (case-insensitive).

- [ ] **Step 1: Write the failing test**

Create `tests/github-tree.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildTree } from '../src/renderer/github-tree.js';

const entry = (path, type = 'blob', sha = 'sha-' + path) => ({ path, type, sha });

describe('buildTree', () => {
  it('nests files under their directories', () => {
    const tree = buildTree([
      entry('content/posts/hello.md'),
      entry('content/posts', 'tree'),
      entry('content', 'tree'),
    ]);
    expect(tree).toEqual([{
      type: 'dir',
      name: 'content',
      path: 'content',
      children: [{
        type: 'dir',
        name: 'posts',
        path: 'content/posts',
        children: [{
          type: 'file',
          name: 'hello.md',
          path: 'content/posts/hello.md',
          sha: 'sha-content/posts/hello.md',
        }],
      }],
    }]);
  });

  it('keeps only markdown files', () => {
    const tree = buildTree([
      entry('README.md'),
      entry('notes.markdown'),
      entry('logo.png'),
      entry('index.html'),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['README.md', 'notes.markdown']);
  });

  it('drops directories with no markdown inside', () => {
    const tree = buildTree([
      entry('static', 'tree'),
      entry('static/logo.png'),
      entry('posts/a.md'),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['posts']);
  });

  it('sorts directories before files, each alphabetically and case-insensitively', () => {
    const tree = buildTree([
      entry('zebra.md'),
      entry('Apple.md'),
      entry('drafts/x.md'),
      entry('Blog/y.md'),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['Blog', 'drafts', 'Apple.md', 'zebra.md']);
  });

  it('handles an empty listing', () => {
    expect(buildTree([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/github-tree.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/github-tree.js`:

```js
const MARKDOWN = /\.(md|markdown)$/i;

export function buildTree(entries) {
  const root = { children: new Map() };

  for (const item of entries) {
    if (item.type !== 'blob' || !MARKDOWN.test(item.path)) continue;
    const parts = item.path.split('/');
    const fileName = parts.pop();
    let node = root;
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, { type: 'dir', name: part, path: prefix, children: new Map() });
      }
      node = node.children.get(part);
    }
    node.children.set(fileName, {
      type: 'file',
      name: fileName,
      path: item.path,
      sha: item.sha,
    });
  }

  return toArray(root);
}

function toArray(node) {
  const list = [...node.children.values()].map((child) =>
    child.type === 'dir'
      ? { type: 'dir', name: child.name, path: child.path, children: toArray(child) }
      : child
  );
  list.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return list;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/github-tree.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
npm test
git add src/renderer/github-tree.js tests/github-tree.test.js
git commit -m "feat(github): add nested markdown tree builder"
```

---

### Task 5: Repo, branch and file reads + the sidebar tree

After this task you can pick a repo and branch, browse markdown files in the sidebar, and open one into the editor. Saving still writes locally only — Task 8 changes that.

**Files:**
- Create: `src/main/github/repo.js`
- Modify: `src/main/github/index.js`, `src/preload.js`, `src/renderer/github-panel.js`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: `getClient()` (Task 3), `buildTree` (Task 4).
- Produces (main, all async):
  - `listRepos(client)` → `[{ fullName, defaultBranch }]`
  - `listBranches(client, repo)` → `[{ name }]`
  - `listTree(client, repo, branch)` → `{ entries, truncated }` (raw GitHub entries)
  - `readFile(client, repo, branch, path)` → `{ content, sha }` with `content` decoded UTF-8
- Produces (preload): `window.markpad.github.listRepos/listBranches/listTree/readFile`.
- Produces (renderer): the panel gains `onOpenFile` in its options and `getSelection()` → `{ repo, branch } | null`.

- [ ] **Step 1: Write the read operations**

Create `src/main/github/repo.js`:

```js
async function listRepos(client) {
  const repos = await client.request('GET', '/user/repos', {
    query: { sort: 'updated', per_page: '100', affiliation: 'owner,collaborator,organization_member' },
  });
  return repos.map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch }));
}

async function listBranches(client, repo) {
  const branches = await client.request('GET', `/repos/${repo}/branches`, {
    query: { per_page: '100' },
  });
  return branches.map((b) => ({ name: b.name }));
}

async function listTree(client, repo, branch) {
  const data = await client.request('GET', `/repos/${repo}/git/trees/${encodeURIComponent(branch)}`, {
    query: { recursive: '1' },
  });
  return { entries: data.tree || [], truncated: Boolean(data.truncated) };
}

async function readFile(client, repo, branch, path) {
  const data = await client.request('GET', `/repos/${repo}/contents/${encodePath(path)}`, {
    query: { ref: branch },
  });
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha,
  };
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

module.exports = { listRepos, listBranches, listTree, readFile, encodePath };
```

- [ ] **Step 2: Expose them over IPC**

In `src/main/github/index.js`, add `const repoApi = require('./repo.js');` to the requires, and register these handlers inside `registerGitHubHandlers` alongside the existing ones. The `wrap` helper converts a thrown `GitHubError` into a plain object, because Error instances do not survive IPC structured cloning:

```js
  const wrap = (fn) => async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || 'http_error', resetAt: err.resetAt ?? null };
    }
  };

  ipcMain.handle('github:listRepos', wrap(() => repoApi.listRepos(client)));
  ipcMain.handle('github:listBranches', wrap((repo) => repoApi.listBranches(client, repo)));
  ipcMain.handle('github:listTree', wrap((repo, branch) => repoApi.listTree(client, repo, branch)));
  ipcMain.handle('github:readFile', wrap((repo, branch, path) => repoApi.readFile(client, repo, branch, path)));
```

- [ ] **Step 3: Extend the preload bridge**

Add to the `github` object in `src/preload.js`:

```js
    listRepos: () => ipcRenderer.invoke('github:listRepos'),
    listBranches: (repo) => ipcRenderer.invoke('github:listBranches', repo),
    listTree: (repo, branch) => ipcRenderer.invoke('github:listTree', repo, branch),
    readFile: (repo, branch, path) => ipcRenderer.invoke('github:readFile', repo, branch, path),
```

- [ ] **Step 4: Render pickers and the file tree**

Rewrite `src/renderer/github-panel.js`'s `render()` and add the state below. Keep the connect/sign-out code from Task 3 unchanged; this replaces only `render()` and adds new functions. The full new module body after the device-code wiring:

```js
  let repos = [];
  let branches = [];
  let selectedRepo = localStorage.getItem('gh.repo') || null;
  let selectedBranch = null;
  let tree = [];
  let truncated = false;
  let openPath = null;

  // Unwraps the { ok, data } envelope from main, reporting failures once.
  // Implements the spec's error table: rate limits name their reset time, and
  // an expired token drops the UI back to the Connect button.
  async function call(promise) {
    const result = await promise;
    if (result?.ok) return result.data;

    if (result?.code === 'rate_limited' && result.resetAt) {
      const at = new Date(result.resetAt * 1000).toLocaleTimeString();
      onError(`GitHub rate limit reached. It resets at ${at}.`);
    } else if (result?.code === 'unauthorized') {
      onError('Your GitHub sign-in expired. Please connect again.');
      await window.markpad.github.signOut(); // clears the vault
      account = null;
      repos = [];
      branches = [];
      tree = [];
      render();
    } else if (result?.code === 'offline') {
      onError("Can't reach GitHub — your edits are still here.");
    } else {
      onError(`GitHub: ${result?.error || 'request failed'}`);
    }
    return null;
  }

  async function loadRepos() {
    repos = (await call(window.markpad.github.listRepos())) || [];
    render();
  }

  async function selectRepo(fullName) {
    selectedRepo = fullName;
    localStorage.setItem('gh.repo', fullName);
    branches = (await call(window.markpad.github.listBranches(fullName))) || [];
    const preferred = localStorage.getItem(`gh.branch.${fullName}`);
    const fallback = repos.find((r) => r.fullName === fullName)?.defaultBranch;
    const names = branches.map((b) => b.name);
    await selectBranch(names.includes(preferred) ? preferred : fallback || names[0]);
  }

  async function selectBranch(name) {
    selectedBranch = name;
    if (selectedRepo && name) localStorage.setItem(`gh.branch.${selectedRepo}`, name);
    await loadTree();
  }

  async function loadTree() {
    if (!selectedRepo || !selectedBranch) return;
    const data = await call(window.markpad.github.listTree(selectedRepo, selectedBranch));
    tree = data ? buildTree(data.entries) : [];
    truncated = Boolean(data?.truncated);
    render();
  }

  async function openFile(path) {
    const data = await call(window.markpad.github.readFile(selectedRepo, selectedBranch, path));
    if (!data) return;
    openPath = path;
    await onOpenFile({
      repo: selectedRepo,
      branch: selectedBranch,
      path,
      sha: data.sha,
      content: data.content,
    });
    render();
  }

  function renderNodes(nodes, parent, depth) {
    for (const node of nodes) {
      const row = document.createElement('div');
      row.className = `gh-node gh-${node.type}`;
      row.style.paddingLeft = `${depth * 12}px`;
      row.textContent = node.name;
      row.dataset.path = node.path;
      if (node.type === 'file') {
        if (node.path === openPath) row.classList.add('open');
        row.addEventListener('click', () => openFile(node.path));
        parent.append(row);
      } else {
        const kids = document.createElement('div');
        row.addEventListener('click', () => kids.classList.toggle('hidden'));
        parent.append(row, kids);
        renderNodes(node.children, kids, depth + 1);
      }
    }
  }
```

and replace `render()` with:

```js
  function render() {
    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'gh-header';

    if (!account) {
      const button = document.createElement('button');
      button.textContent = 'Connect to GitHub';
      button.addEventListener('click', connect);
      header.append(button);
      container.append(header);
      return;
    }

    const who = document.createElement('span');
    who.className = 'gh-login';
    who.textContent = account.login;
    const out = document.createElement('button');
    out.textContent = 'Sign out';
    out.addEventListener('click', signOut);
    header.append(who, out);
    container.append(header);

    const repoSelect = document.createElement('select');
    repoSelect.className = 'gh-select';
    repoSelect.append(new Option('Choose a repository…', ''));
    for (const r of repos) {
      repoSelect.append(new Option(r.fullName, r.fullName, false, r.fullName === selectedRepo));
    }
    repoSelect.addEventListener('change', () => selectRepo(repoSelect.value));
    container.append(repoSelect);

    if (selectedRepo) {
      const branchSelect = document.createElement('select');
      branchSelect.className = 'gh-select';
      for (const b of branches) {
        branchSelect.append(new Option(b.name, b.name, false, b.name === selectedBranch));
      }
      branchSelect.addEventListener('change', () => selectBranch(branchSelect.value));
      container.append(branchSelect);
    }

    if (truncated) {
      const warn = document.createElement('div');
      warn.className = 'gh-warning';
      warn.textContent = 'This repository is too large to list completely.';
      container.append(warn);
    }

    const treeEl = document.createElement('div');
    treeEl.className = 'gh-tree';
    renderNodes(tree, treeEl, 0);
    container.append(treeEl);
  }
```

Update the module's signature and its return value:

```js
import { buildTree } from './github-tree.js';

export function createGitHubPanel(container, { onError = () => {}, onOpenFile = async () => {} } = {}) {
```

```js
  async function refreshAccount() {
    account = await window.markpad.github.getAccount();
    render();
    if (account) {
      await loadRepos();
      if (selectedRepo) await selectRepo(selectedRepo);
    }
  }

  render();
  return {
    refreshAccount,
    isConnected: () => Boolean(account),
    getSelection: () => (selectedRepo && selectedBranch ? { repo: selectedRepo, branch: selectedBranch } : null),
    reloadTree: loadTree,
    setOpenPath: (path) => { openPath = path; render(); },
  };
}
```

Also change `connect()`'s success branch to load repos: after `account = result.account;` add `await loadRepos();`.

- [ ] **Step 5: Style the tree**

Append to `src/renderer/styles.css`:

```css
.gh-select { width: 100%; margin-bottom: 8px; }
.gh-tree { user-select: none; }
.gh-node { padding: 3px 4px; border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gh-node:hover { background: rgba(255, 255, 255, 0.08); }
.gh-node.open { background: rgba(120, 170, 255, 0.22); }
.gh-dir { font-weight: 600; }
.gh-warning { color: #e0b050; margin-bottom: 6px; }
```

- [ ] **Step 6: Open files into the editor**

In `src/renderer/index.js`, pass an `onOpenFile` handler to `createGitHubPanel`. It mirrors the existing `openFile()` but takes content from GitHub. Add above the `createGitHubPanel` call:

```js
async function openRepoFile({ repo, branch, path, sha, content }) {
  if (!(await guardDirty())) return;
  const normalized = content.replace(/\r\n/g, '\n');
  const { fm, body } = splitFrontmatter(normalized);
  fmPanel.setFrontmatter(fm);
  setDoc(view, body);
  await ui.refreshRendered();
  currentPath = null;
  markSaved(null, path.split('/').pop());
}
```

and pass it: `createGitHubPanel(document.getElementById('gh-sidebar'), { onError: (msg) => ui.showError(msg), onOpenFile: openRepoFile })`.

This is deliberately temporary — Task 7 replaces the `currentPath = null` line with a proper document source. Leaving it explicit keeps this task independently testable.

- [ ] **Step 7: Verify by hand**

Run: `npm start`
Expected: after connecting, the repo dropdown lists your repos; choosing one lists branches and shows a tree of markdown files; clicking a file loads it into the editor with its frontmatter split into the panel. The status bar shows the file name.

- [ ] **Step 8: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/main/github/repo.js src/main/github/index.js src/preload.js src/renderer/github-panel.js src/renderer/index.js src/renderer/styles.css
git commit -m "feat(github): browse repos, branches and markdown files in a sidebar"
```

---

# Phase 2 — Commit

### Task 6: The multi-file commit primitive

**Files:**
- Modify: `src/main/github/repo.js`
- Test: `tests/github-commit.test.js`

**Interfaces:**
- Consumes: the `client` shape from Task 1 (only `request` is used, so tests pass a fake).
- Produces: `commit(client, { repo, branch, message, files, expectedHeadSha })` where `files` is an array of `{ path, content }` (create/update, `content` is a UTF-8 string), `{ path, contentBase64 }` (binary, used by images in Task 12), or `{ path, delete: true }`. Returns `{ commitSha, headSha, blobShas }`, where `blobShas` maps each written path to its new blob SHA. Throws a `GitHubError` with `code: 'conflict'` if `expectedHeadSha` is given and the branch has moved.

`blobShas` exists so the caller can refresh the `baseSha` it uses for stale-file detection. Without it, the SHA recorded at open time would go stale the moment you commit, and every subsequent save would report a false conflict.

Request sequence, in order: `GET /git/ref/heads/{branch}` → `GET /git/commits/{headSha}` → one `POST /git/blobs` per non-delete file → `POST /git/trees` → `POST /git/commits` → `PATCH /git/refs/heads/{branch}`.

- [ ] **Step 1: Write the failing test**

Create `tests/github-commit.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { commit } from '../src/main/github/repo.js';

// Records every request and replies with canned data keyed by "METHOD path".
function fakeClient(overrides = {}) {
  const calls = [];
  const responses = {
    'GET /repos/o/r/git/ref/heads/main': { object: { sha: 'head1' } },
    'GET /repos/o/r/git/commits/head1': { sha: 'head1', tree: { sha: 'tree1' } },
    'POST /repos/o/r/git/blobs': { sha: 'blob1' },
    'POST /repos/o/r/git/trees': { sha: 'tree2' },
    'POST /repos/o/r/git/commits': { sha: 'commit2' },
    'PATCH /repos/o/r/git/refs/heads/main': { object: { sha: 'commit2' } },
    ...overrides,
  };
  return {
    calls,
    request: async (method, path, opts) => {
      calls.push({ method, path, opts });
      const key = `${method} ${path}`;
      if (!(key in responses)) throw new Error(`unexpected request: ${key}`);
      const value = responses[key];
      return typeof value === 'function' ? value(calls.length) : value;
    },
  };
}

describe('commit', () => {
  it('creates blob, tree, commit and moves the ref', async () => {
    const client = fakeClient();
    const result = await commit(client, {
      repo: 'o/r',
      branch: 'main',
      message: 'Update post',
      files: [{ path: 'content/a.md', content: '# hi' }],
    });

    expect(client.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /repos/o/r/git/ref/heads/main',
      'GET /repos/o/r/git/commits/head1',
      'POST /repos/o/r/git/blobs',
      'POST /repos/o/r/git/trees',
      'POST /repos/o/r/git/commits',
      'PATCH /repos/o/r/git/refs/heads/main',
    ]);
    expect(result).toEqual({
      commitSha: 'commit2',
      headSha: 'commit2',
      blobShas: { 'content/a.md': 'blob1' },
    });
  });

  it('reports a blob sha for every written file but not for deletes', async () => {
    const client = fakeClient();
    const result = await commit(client, {
      repo: 'o/r', branch: 'main', message: 'm',
      files: [
        { path: 'new.md', content: 'N' },
        { path: 'old.md', delete: true },
      ],
    });
    expect(result.blobShas).toEqual({ 'new.md': 'blob1' });
  });

  it('base64-encodes text content when creating the blob', async () => {
    const client = fakeClient();
    await commit(client, {
      repo: 'o/r', branch: 'main', message: 'm',
      files: [{ path: 'a.md', content: '# hi' }],
    });
    const blob = client.calls.find((c) => c.path.endsWith('/git/blobs'));
    expect(blob.opts.body).toEqual({
      content: Buffer.from('# hi', 'utf-8').toString('base64'),
      encoding: 'base64',
    });
  });

  it('passes pre-encoded binary content straight through', async () => {
    const client = fakeClient();
    await commit(client, {
      repo: 'o/r', branch: 'main', message: 'm',
      files: [{ path: 'img.png', contentBase64: 'AAEC' }],
    });
    const blob = client.calls.find((c) => c.path.endsWith('/git/blobs'));
    expect(blob.opts.body).toEqual({ content: 'AAEC', encoding: 'base64' });
  });

  it('puts every file in one tree, with base_tree set to the head tree', async () => {
    const client = fakeClient();
    await commit(client, {
      repo: 'o/r', branch: 'main', message: 'm',
      files: [
        { path: 'a.md', content: 'A' },
        { path: 'b.md', content: 'B' },
      ],
    });
    const tree = client.calls.find((c) => c.path.endsWith('/git/trees'));
    expect(tree.opts.body.base_tree).toBe('tree1');
    expect(tree.opts.body.tree).toEqual([
      { path: 'a.md', mode: '100644', type: 'blob', sha: 'blob1' },
      { path: 'b.md', mode: '100644', type: 'blob', sha: 'blob1' },
    ]);
    expect(client.calls.filter((c) => c.path.endsWith('/git/blobs'))).toHaveLength(2);
  });

  it('represents a delete as a null sha and creates no blob for it', async () => {
    const client = fakeClient();
    await commit(client, {
      repo: 'o/r', branch: 'main', message: 'm',
      files: [
        { path: 'new.md', content: 'N' },
        { path: 'old.md', delete: true },
      ],
    });
    const tree = client.calls.find((c) => c.path.endsWith('/git/trees'));
    expect(tree.opts.body.tree).toEqual([
      { path: 'new.md', mode: '100644', type: 'blob', sha: 'blob1' },
      { path: 'old.md', mode: '100644', type: 'blob', sha: null },
    ]);
    expect(client.calls.filter((c) => c.path.endsWith('/git/blobs'))).toHaveLength(1);
  });

  it('parents the commit on the current head and refuses a forced update', async () => {
    const client = fakeClient();
    await commit(client, {
      repo: 'o/r', branch: 'main', message: 'Update post',
      files: [{ path: 'a.md', content: 'A' }],
    });
    const made = client.calls.find((c) => c.path.endsWith('/git/commits') && c.method === 'POST');
    expect(made.opts.body).toEqual({ message: 'Update post', tree: 'tree2', parents: ['head1'] });
    const patch = client.calls.find((c) => c.method === 'PATCH');
    expect(patch.opts.body).toEqual({ sha: 'commit2', force: false });
  });

  it('throws a conflict when the branch moved past the expected head', async () => {
    const client = fakeClient({
      'GET /repos/o/r/git/ref/heads/main': { object: { sha: 'someoneElse' } },
    });
    await expect(commit(client, {
      repo: 'o/r', branch: 'main', message: 'm',
      files: [{ path: 'a.md', content: 'A' }],
      expectedHeadSha: 'head1',
    })).rejects.toMatchObject({ code: 'conflict' });
    expect(client.calls).toHaveLength(1);
  });

  it('encodes branch names containing slashes in the ref path', async () => {
    const client = fakeClient({
      'GET /repos/o/r/git/ref/heads/feat%2Fx': { object: { sha: 'head1' } },
      'PATCH /repos/o/r/git/refs/heads/feat%2Fx': { object: { sha: 'commit2' } },
    });
    await commit(client, {
      repo: 'o/r', branch: 'feat/x', message: 'm',
      files: [{ path: 'a.md', content: 'A' }],
    });
    expect(client.calls[0].path).toBe('/repos/o/r/git/ref/heads/feat%2Fx');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/github-commit.test.js`
Expected: FAIL — `commit` is not exported from `repo.js`.

- [ ] **Step 3: Write the implementation**

Add to `src/main/github/repo.js` (and add `commit` and `getHead` to its `module.exports`). Note `GitHubError` is required at the top of the file: `const { GitHubError } = require('./client.js');`

```js
async function getHead(client, repo, branch) {
  const ref = await client.request('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;
  const headCommit = await client.request('GET', `/repos/${repo}/git/commits/${headSha}`);
  return { headSha, treeSha: headCommit.tree.sha };
}

async function commit(client, { repo, branch, message, files, expectedHeadSha }) {
  const ref = await client.request('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;

  if (expectedHeadSha && headSha !== expectedHeadSha) {
    throw new GitHubError({
      status: 409,
      code: 'conflict',
      message: 'The branch has moved since you loaded it.',
    });
  }

  const headCommit = await client.request('GET', `/repos/${repo}/git/commits/${headSha}`);

  const tree = [];
  const blobShas = {};
  for (const file of files) {
    if (file.delete) {
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const content = file.contentBase64 ?? Buffer.from(file.content, 'utf-8').toString('base64');
    const blob = await client.request('POST', `/repos/${repo}/git/blobs`, {
      body: { content, encoding: 'base64' },
    });
    blobShas[file.path] = blob.sha;
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await client.request('POST', `/repos/${repo}/git/trees`, {
    body: { base_tree: headCommit.tree.sha, tree },
  });
  const newCommit = await client.request('POST', `/repos/${repo}/git/commits`, {
    body: { message, tree: newTree.sha, parents: [headSha] },
  });
  await client.request('PATCH', `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    body: { sha: newCommit.sha, force: false },
  });

  return { commitSha: newCommit.sha, headSha: newCommit.sha, blobShas };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/github-commit.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
npm test
git add src/main/github/repo.js tests/github-commit.test.js
git commit -m "feat(github): add atomic multi-file commit primitive"
```

---

### Task 7: The document source abstraction

**Files:**
- Create: `src/renderer/doc-source.js`
- Test: `tests/doc-source.test.js`
- Modify: `src/renderer/index.js`

**Interfaces:**
- Consumes: `window.markpad.saveFile` / `saveFileAs` (existing), `window.markpad.github.commit` (added in Task 8; `doc-source.js` calls it through an injected `api` object so it is testable now).
- Produces:
  - `localSource(path, name)` → source
  - `repoSource({ repo, branch, path, baseSha, headSha })` → source
  - Every source exposes `kind`, `name()`, `save(content, opts)` → `{ ok, source?, error?, conflict? }`, and `describe()` → a short label for the status bar.
  - `createSources(api)` factory returning `{ localSource, repoSource }`, where `api` defaults to `window.markpad`.

- [ ] **Step 1: Write the failing test**

Create `tests/doc-source.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createSources } from '../src/renderer/doc-source.js';

function stubApi(overrides = {}) {
  return {
    saveFile: async () => ({ ok: true }),
    saveFileAs: async () => ({ ok: true, path: 'C:/new.md', name: 'new.md' }),
    github: { commit: async () => ({ ok: true, data: { headSha: 'c2' } }) },
    ...overrides,
  };
}

describe('localSource', () => {
  it('saves through the local file API', async () => {
    const seen = [];
    const { localSource } = createSources(stubApi({
      saveFile: async (path, content) => { seen.push([path, content]); return { ok: true }; },
    }));
    const source = localSource('C:/a.md', 'a.md');
    const result = await source.save('# hi');
    expect(result.ok).toBe(true);
    expect(seen).toEqual([['C:/a.md', '# hi']]);
    expect(source.kind).toBe('local');
    expect(source.name()).toBe('a.md');
  });

  it('reports a failed local save', async () => {
    const { localSource } = createSources(stubApi({
      saveFile: async () => ({ ok: false, error: 'EACCES' }),
    }));
    expect(await localSource('C:/a.md', 'a.md').save('x')).toEqual({ ok: false, error: 'EACCES' });
  });
});

describe('repoSource', () => {
  const base = { repo: 'o/r', branch: 'main', path: 'content/a.md', baseSha: 'b1', headSha: 'h1' };

  it('commits with the message and the expected head', async () => {
    const seen = [];
    const { repoSource } = createSources(stubApi({
      github: {
        commit: async (args) => { seen.push(args); return { ok: true, data: { headSha: 'h2' } }; },
      },
    }));
    const result = await repoSource(base).save('# hi', { message: 'Update it' });

    expect(seen[0]).toEqual({
      repo: 'o/r',
      branch: 'main',
      message: 'Update it',
      files: [{ path: 'content/a.md', content: '# hi' }],
      expectedHeadSha: 'h1',
    });
    expect(result.ok).toBe(true);
  });

  it('returns a source carrying the new head sha', async () => {
    const { repoSource } = createSources(stubApi());
    const result = await repoSource(base).save('# hi', { message: 'm' });
    expect(result.source.headSha).toBe('c2');
    expect(result.source.path).toBe('content/a.md');
  });

  it('refreshes baseSha from the new blob sha so the next save is not a false conflict', async () => {
    const { repoSource } = createSources(stubApi({
      github: {
        commit: async () => ({
          ok: true,
          data: { headSha: 'c2', blobShas: { 'content/a.md': 'b2' } },
        }),
      },
    }));
    const result = await repoSource(base).save('# hi', { message: 'm' });
    expect(result.source.baseSha).toBe('b2');
  });

  it('keeps the old baseSha when the commit reports no blob for this path', async () => {
    const { repoSource } = createSources(stubApi());
    const result = await repoSource(base).save('# hi', { message: 'm' });
    expect(result.source.baseSha).toBe('b1');
  });

  it('drops the expected head when forced, so the commit re-parents', async () => {
    const seen = [];
    const { repoSource } = createSources(stubApi({
      github: { commit: async (a) => { seen.push(a); return { ok: true, data: { headSha: 'h2' } }; } },
    }));
    await repoSource(base).save('x', { message: 'm', force: true });
    expect(seen[0].expectedHeadSha).toBeNull();
  });

  it('flags a conflict distinctly from other errors', async () => {
    const { repoSource } = createSources(stubApi({
      github: { commit: async () => ({ ok: false, code: 'conflict', error: 'moved' }) },
    }));
    expect(await repoSource(base).save('x', { message: 'm' })).toMatchObject({
      ok: false,
      conflict: true,
    });
  });

  it('does not flag non-conflict failures as conflicts', async () => {
    const { repoSource } = createSources(stubApi({
      github: { commit: async () => ({ ok: false, code: 'offline', error: 'no net' }) },
    }));
    const result = await repoSource(base).save('x', { message: 'm' });
    expect(result.conflict).toBeFalsy();
    expect(result.error).toBe('no net');
  });

  it('sends extra staged files alongside the document', async () => {
    const seen = [];
    const { repoSource } = createSources(stubApi({
      github: { commit: async (a) => { seen.push(a); return { ok: true, data: { headSha: 'h2' } }; } },
    }));
    await repoSource(base).save('# hi', {
      message: 'm',
      extraFiles: [{ path: 'static/x.png', contentBase64: 'AA' }],
    });
    expect(seen[0].files).toEqual([
      { path: 'content/a.md', content: '# hi' },
      { path: 'static/x.png', contentBase64: 'AA' },
    ]);
  });

  it('names itself after the file, and describes repo and branch', () => {
    const { repoSource } = createSources(stubApi());
    const source = repoSource(base);
    expect(source.name()).toBe('a.md');
    expect(source.describe()).toBe('o/r @ main');
    expect(source.kind).toBe('repo');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/doc-source.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/doc-source.js`:

```js
// A document source knows where the buffer came from and how to write it back.
// Local files go through the native dialogs; repo files become commits.
export function createSources(api) {
  function localSource(path, name) {
    return {
      kind: 'local',
      path,
      name: () => name,
      describe: () => 'Local file',
      async save(content) {
        const result = await api.saveFile(path, content);
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, source: localSource(path, name) };
      },
    };
  }

  function repoSource({ repo, branch, path, baseSha, headSha }) {
    return {
      kind: 'repo',
      repo,
      branch,
      path,
      baseSha,
      headSha,
      name: () => path.split('/').pop(),
      describe: () => `${repo} @ ${branch}`,
      async save(content, { message, extraFiles = [], force = false } = {}) {
        const result = await api.github.commit({
          repo,
          branch,
          message,
          files: [{ path, content }, ...extraFiles],
          expectedHeadSha: force ? null : headSha,
        });
        if (!result.ok) {
          return { ok: false, error: result.error, conflict: result.code === 'conflict' };
        }
        return {
          ok: true,
          source: repoSource({
            repo,
            branch,
            path,
            // Refresh the blob sha so the next save's stale-file check
            // compares against what we just wrote, not what we opened.
            baseSha: result.data.blobShas?.[path] ?? baseSha,
            headSha: result.data.headSha,
          }),
        };
      },
    };
  }

  return { localSource, repoSource };
}

export const { localSource, repoSource } = createSources(
  typeof window !== 'undefined' ? window.markpad : {}
);
```

Note the `expectedHeadSha: force ? null : headSha` line — this is what the conflict dialog's "Overwrite" choice uses in Task 9.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/doc-source.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Route `index.js` through sources**

In `src/renderer/index.js`, add the import:

```js
import { createSources } from './doc-source.js';
```

Directly after the imports, add:

```js
const sources = createSources(window.markpad);
let source = null; // null = a new unsaved buffer
```

Replace `let currentPath = null;` and `let currentName = 'untitled.md';` with a single `let currentName = 'untitled.md';` (the path now lives in the source), then update these functions:

```js
function markSaved(newSource, name) {
  source = newSource;
  currentName = name;
  savedDoc = fullDoc();
  refreshTitle();
}
```

```js
async function newFile() {
  if (!(await guardDirty())) return;
  fmPanel.setFrontmatter(null);
  setDoc(view, '');
  await ui.refreshRendered();
  markSaved(null, 'untitled.md');
}
```

```js
async function openFile() {
  if (!(await guardDirty())) return;
  const result = await window.markpad.openFile();
  if (!result) return;
  if (result.error) {
    ui.showError(`Could not open file: ${result.error}`);
    return;
  }
  const normalized = result.content.replace(/\r\n/g, '\n');
  const { fm, body } = splitFrontmatter(normalized);
  fmPanel.setFrontmatter(fm);
  setDoc(view, body);
  await ui.refreshRendered();
  markSaved(sources.localSource(result.path, result.name), result.name);
}
```

```js
async function save() {
  if (!source) return saveAs();
  const result = await source.save(fullDoc());
  if (!result.ok) {
    ui.showError(`Could not save file: ${result.error}`);
    return false;
  }
  markSaved(result.source, currentName);
  return true;
}
```

```js
async function saveAs() {
  const result = await window.markpad.saveFileAs(fullDoc());
  if (!result) return false; // cancelled
  if (!result.ok) {
    ui.showError(`Could not save file: ${result.error}`);
    return false;
  }
  markSaved(sources.localSource(result.path, result.name), result.name);
  return true;
}
```

Finally, update `openRepoFile` from Task 5 to build a repo source. It needs the head sha, so it takes one more field (supplied in Task 8; until then pass `null` and saving falls back to Save As):

```js
async function openRepoFile({ repo, branch, path, sha, headSha, content }) {
  if (!(await guardDirty())) return;
  const normalized = content.replace(/\r\n/g, '\n');
  const { fm, body } = splitFrontmatter(normalized);
  fmPanel.setFrontmatter(fm);
  setDoc(view, body);
  await ui.refreshRendered();
  markSaved(
    sources.repoSource({ repo, branch, path, baseSha: sha, headSha }),
    path.split('/').pop()
  );
}
```

- [ ] **Step 6: Verify local editing still works**

Run: `npm start`
Expected: New / Open / Save / Save As on local files behave exactly as before — this is the regression that matters most in this task. Confirm the title bar's dirty asterisk still appears and clears.

- [ ] **Step 7: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/renderer/doc-source.js tests/doc-source.test.js src/renderer/index.js
git commit -m "refactor: route saving through a document source abstraction"
```

---

### Task 8: Commit on Ctrl+S

**Files:**
- Create: `src/renderer/commit-bar.js`
- Modify: `src/main/github/index.js`, `src/preload.js`, `src/renderer/github-panel.js`, `src/renderer/index.js`, `src/renderer/index.html`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: `commit` (Task 6), `repoSource` (Task 7).
- Produces:
  - Preload/IPC: `window.markpad.github.commit({ repo, branch, message, files, expectedHeadSha })` → `{ ok, data: { commitSha, headSha } }` or `{ ok: false, error, code }`; `window.markpad.github.getHead(repo, branch)` → `{ ok, data: { headSha, treeSha } }`.
  - Renderer: `createCommitBar(container)` → `{ ask(defaultMessage) }` resolving to the message string, or `null` if cancelled.

- [ ] **Step 1: Expose commit and getHead over IPC**

In `src/main/github/index.js`, add inside `registerGitHubHandlers`:

```js
  ipcMain.handle('github:commit', wrap((args) => repoApi.commit(client, args)));
  ipcMain.handle('github:getHead', wrap((repo, branch) => repoApi.getHead(client, repo, branch)));
```

In `src/preload.js`, add to the `github` object:

```js
    commit: (args) => ipcRenderer.invoke('github:commit', args),
    getHead: (repo, branch) => ipcRenderer.invoke('github:getHead', repo, branch),
```

- [ ] **Step 2: Add the commit bar markup**

In `src/renderer/index.html`, add immediately after the `#error-banner` div:

```html
  <div id="commit-bar" class="hidden">
    <label for="commit-message">Commit message</label>
    <input id="commit-message" type="text" />
    <button id="commit-go" type="button">Commit</button>
    <button id="commit-cancel" type="button">Cancel</button>
  </div>
```

- [ ] **Step 3: Write the commit bar**

Create `src/renderer/commit-bar.js`:

```js
export function createCommitBar() {
  const bar = document.getElementById('commit-bar');
  const input = document.getElementById('commit-message');
  const go = document.getElementById('commit-go');
  const cancel = document.getElementById('commit-cancel');
  let resolve = null;

  function close(value) {
    bar.classList.add('hidden');
    const done = resolve;
    resolve = null;
    done?.(value);
  }

  go.addEventListener('click', () => close(input.value.trim() || input.placeholder));
  cancel.addEventListener('click', () => close(null));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go.click(); }
    if (e.key === 'Escape') { e.preventDefault(); close(null); }
  });

  // Resolves with the message, or null if the user cancels.
  function ask(defaultMessage) {
    return new Promise((r) => {
      resolve = r;
      input.value = defaultMessage;
      input.placeholder = defaultMessage;
      bar.classList.remove('hidden');
      input.focus();
      input.select();
    });
  }

  return { ask };
}
```

- [ ] **Step 4: Style the bar**

Append to `src/renderer/styles.css`:

```css
#commit-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(120, 170, 255, 0.14);
}
#commit-bar.hidden { display: none; }
#commit-message { flex: 1; }
```

- [ ] **Step 5: Make `save()` commit for repo sources**

In `src/renderer/index.js`, import and instantiate the bar:

```js
import { createCommitBar } from './commit-bar.js';
```

```js
const commitBar = createCommitBar();
```

Replace `save()` with a version that prompts for repo-backed documents:

```js
async function save() {
  if (!source) return saveAs();

  let options = {};
  if (source.kind === 'repo') {
    const message = await commitBar.ask(`Update ${source.path}`);
    if (message === null) return false; // cancelled
    options = { message };
  }

  const result = await source.save(fullDoc(), options);
  if (!result.ok) {
    ui.showError(`Could not save: ${result.error}`);
    return false;
  }
  markSaved(result.source, currentName);
  if (source.kind === 'repo') ghPanel.reloadTree();
  return true;
}
```

Note `ghPanel` is declared after `save()` in the current file order; move the `const ghPanel = createGitHubPanel(...)` assignment above the file-action functions so it is initialized before `save()` can run. It is only *called* from inside a function, so hoisting is not strictly required, but keeping declaration order honest avoids a temporal-dead-zone trap if anyone later calls `save()` at module top level.

- [ ] **Step 6: Supply the head sha when opening a repo file**

In `src/renderer/github-panel.js`, change `openFile` to fetch the branch head alongside the file:

```js
  async function openFile(path) {
    const [data, head] = await Promise.all([
      call(window.markpad.github.readFile(selectedRepo, selectedBranch, path)),
      call(window.markpad.github.getHead(selectedRepo, selectedBranch)),
    ]);
    if (!data || !head) return;
    openPath = path;
    await onOpenFile({
      repo: selectedRepo,
      branch: selectedBranch,
      path,
      sha: data.sha,
      headSha: head.headSha,
      content: data.content,
    });
    render();
  }
```

- [ ] **Step 7: Verify by hand**

Run: `npm start`
Expected: open a markdown file from a repo, edit it, press `Ctrl+S` — the commit bar appears prefilled with `Update <path>`; pressing Enter commits and the dirty asterisk clears. Confirm on github.com that a commit landed on the selected branch with your message. Press `Ctrl+S` and then Escape to confirm cancelling leaves the document dirty and creates no commit. Confirm `Ctrl+S` on a *local* file still saves silently with no commit bar.

- [ ] **Step 8: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/main/github/index.js src/preload.js src/renderer/commit-bar.js src/renderer/github-panel.js src/renderer/index.js src/renderer/index.html src/renderer/styles.css
git commit -m "feat(github): commit the current document on Ctrl+S"
```

---

### Task 9: Conflict detection and dialog

**Files:**
- Modify: `src/renderer/commit-bar.js`, `src/renderer/index.js`, `src/renderer/index.html`, `src/main/github/repo.js`, `src/main/github/index.js`, `src/preload.js`
- Test: `tests/github-commit.test.js` (extend)

**Interfaces:**
- Consumes: `commit` with `expectedHeadSha` (Task 6), `repoSource.save(..., { force })` (Task 7).
- Produces: `askConflict()` exported from `commit-bar.js`, resolving to `'overwrite' | 'reload' | 'browse' | 'cancel'`; `window.markpad.github.fileSha(repo, branch, path)` → `{ ok, data: { sha } }` (null `sha` when the file does not exist).

- [ ] **Step 1: Write the failing test for stale-file detection**

Append to `tests/github-commit.test.js`:

```js
describe('commit conflict signalling', () => {
  it('surfaces a non-fast-forward ref rejection as a conflict', async () => {
    const client = fakeClient();
    const original = client.request;
    client.request = async (method, path, opts) => {
      if (method === 'PATCH') {
        const err = new Error('Update is not a fast forward');
        err.code = 'unprocessable';
        err.status = 422;
        throw err;
      }
      return original(method, path, opts);
    };
    await expect(commit(client, {
      repo: 'o/r', branch: 'main', message: 'm',
      files: [{ path: 'a.md', content: 'A' }],
    })).rejects.toMatchObject({ code: 'conflict' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/github-commit.test.js -t "non-fast-forward"`
Expected: FAIL — the error surfaces with code `unprocessable`, not `conflict`.

- [ ] **Step 3: Translate the rejection in `repo.js`**

In `src/main/github/repo.js`, wrap the `PATCH` call inside `commit`:

```js
  try {
    await client.request('PATCH', `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      body: { sha: newCommit.sha, force: false },
    });
  } catch (err) {
    // GitHub reports a rejected non-fast-forward update as 422.
    if (err.status === 422 && /fast forward/i.test(err.message)) {
      throw new GitHubError({
        status: 409,
        code: 'conflict',
        message: 'Someone else pushed to this branch while you were editing.',
      });
    }
    throw err;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/github-commit.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Add the stale-file check**

Add to `src/main/github/repo.js` and its exports:

```js
async function fileSha(client, repo, branch, path) {
  try {
    const data = await client.request('GET', `/repos/${repo}/contents/${encodePath(path)}`, {
      query: { ref: branch },
    });
    return { sha: data.sha };
  } catch (err) {
    if (err.code === 'not_found') return { sha: null };
    throw err;
  }
}
```

Register it in `src/main/github/index.js`:

```js
  ipcMain.handle('github:fileSha', wrap((repo, branch, path) => repoApi.fileSha(client, repo, branch, path)));
```

and in `src/preload.js`:

```js
    fileSha: (repo, branch, path) => ipcRenderer.invoke('github:fileSha', repo, branch, path),
```

- [ ] **Step 6: Add the conflict dialog markup**

In `src/renderer/index.html`, add next to the other dialogs:

```html
  <dialog id="conflict-dialog">
    <h3>This file changed on GitHub</h3>
    <p id="conflict-detail">Someone else committed to this file since you opened it.</p>
    <div class="dialog-buttons">
      <button id="conflict-overwrite" type="button">Overwrite</button>
      <button id="conflict-reload" type="button">Reload from GitHub</button>
      <button id="conflict-browse" type="button">Open on GitHub</button>
      <button id="conflict-cancel" type="button">Cancel</button>
    </div>
  </dialog>
```

- [ ] **Step 7: Implement the dialog**

Add to `src/renderer/commit-bar.js`:

```js
export function askConflict(detail) {
  const dialog = document.getElementById('conflict-dialog');
  document.getElementById('conflict-detail').textContent = detail;
  return new Promise((resolve) => {
    const choose = (value) => () => { dialog.close(); resolve(value); };
    const buttons = [
      ['conflict-overwrite', 'overwrite'],
      ['conflict-reload', 'reload'],
      ['conflict-browse', 'browse'],
      ['conflict-cancel', 'cancel'],
    ].map(([id, value]) => {
      const el = document.getElementById(id);
      const handler = choose(value);
      el.addEventListener('click', handler, { once: true });
      return [el, handler];
    });
    dialog.addEventListener('close', () => {
      for (const [el, handler] of buttons) el.removeEventListener('click', handler);
      resolve('cancel');
    }, { once: true });
    dialog.showModal();
  });
}
```

- [ ] **Step 8: Handle conflicts in `save()`**

In `src/renderer/index.js`, import `askConflict` and extend `save()`. Replace the repo branch of `save()` with:

```js
async function save() {
  if (!source) return saveAs();
  if (source.kind !== 'repo') {
    const result = await source.save(fullDoc());
    if (!result.ok) {
      ui.showError(`Could not save file: ${result.error}`);
      return false;
    }
    markSaved(result.source, currentName);
    return true;
  }

  const message = await commitBar.ask(`Update ${source.path}`);
  if (message === null) return false;

  // Stale-file guard: has this exact file moved since we opened it?
  const current = await window.markpad.github.fileSha(source.repo, source.branch, source.path);
  const stale = current.ok && current.data.sha && current.data.sha !== source.baseSha;

  let result = stale
    ? { ok: false, conflict: true, error: 'File changed on GitHub' }
    : await source.save(fullDoc(), { message });

  if (!result.ok && result.conflict) {
    const choice = await askConflict(
      `${source.path} changed on GitHub since you opened it.`
    );
    if (choice === 'cancel') return false;
    if (choice === 'browse') {
      window.markpad.github.openExternal(
        `https://github.com/${source.repo}/blob/${source.branch}/${source.path}`
      );
      return false;
    }
    if (choice === 'reload') {
      await reloadFromGitHub();
      return false;
    }
    result = await source.save(fullDoc(), { message, force: true });
  }

  if (!result.ok) {
    ui.showError(`Could not commit: ${result.error}`);
    return false;
  }
  markSaved(result.source, currentName);
  ghPanel.reloadTree();
  return true;
}

async function reloadFromGitHub() {
  const [file, head] = await Promise.all([
    window.markpad.github.readFile(source.repo, source.branch, source.path),
    window.markpad.github.getHead(source.repo, source.branch),
  ]);
  if (!file.ok || !head.ok) {
    ui.showError(`Could not reload: ${file.error || head.error}`);
    return;
  }
  const { fm, body } = splitFrontmatter(file.data.content.replace(/\r\n/g, '\n'));
  fmPanel.setFrontmatter(fm);
  setDoc(view, body);
  await ui.refreshRendered();
  markSaved(
    sources.repoSource({
      repo: source.repo,
      branch: source.branch,
      path: source.path,
      baseSha: file.data.sha,
      headSha: head.data.headSha,
    }),
    currentName
  );
}
```

Note "Overwrite" re-commits with `force: true`, which drops `expectedHeadSha` so the commit re-parents onto whatever head exists now. This overwrites the other person's version of *this file* while preserving their other changes, because the tree is built with `base_tree` set to the current head tree.

- [ ] **Step 9: Verify by hand**

Run: `npm start`
Expected: open a file from a repo, then edit and commit that same file on github.com in the browser. Back in MarkPad, edit and press `Ctrl+S` — the conflict dialog appears. Test all four buttons: Cancel leaves the buffer dirty with no commit; Open on GitHub opens the file in your browser; Reload replaces the buffer with GitHub's version and clears the dirty flag; Overwrite commits your version on top.

- [ ] **Step 10: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/main/github src/preload.js src/renderer/commit-bar.js src/renderer/index.js src/renderer/index.html tests/github-commit.test.js
git commit -m "feat(github): detect and resolve commit conflicts"
```

---

# Phase 3 — File Management

### Task 10: Path helpers and new posts

**Files:**
- Create: `src/renderer/github-paths.js`
- Test: `tests/github-paths.test.js`
- Modify: `src/renderer/github-panel.js`, `src/renderer/index.js`, `src/renderer/index.html`

**Interfaces:**
- Consumes: `repoSource` (Task 7).
- Produces:
  - `slugify(text)` → lowercase hyphenated ASCII slug
  - `newPostPath(contentDir, title)` → `"<contentDir>/<slug>.md"`
  - `uniquePath(path, existingPaths)` → the path with `-1`, `-2`, … inserted before the extension until unused
  - `guessDirs(paths)` → `{ contentDir, imageDir }` chosen from known candidates present in the repo

- [ ] **Step 1: Write the failing test**

Create `tests/github-paths.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { slugify, newPostPath, uniquePath, guessDirs } from '../src/renderer/github-paths.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('My First Post')).toBe('my-first-post');
  });
  it('strips punctuation and collapses separators', () => {
    expect(slugify("What's New?  Really -- lots!")).toBe('whats-new-really-lots');
  });
  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --hello--  ')).toBe('hello');
  });
  it('falls back to "untitled" when nothing survives', () => {
    expect(slugify('!!!')).toBe('untitled');
  });
});

describe('newPostPath', () => {
  it('joins the content dir and the slug', () => {
    expect(newPostPath('content/posts', 'Hello World')).toBe('content/posts/hello-world.md');
  });
  it('tolerates a trailing slash on the dir', () => {
    expect(newPostPath('content/posts/', 'Hi')).toBe('content/posts/hi.md');
  });
  it('handles an empty content dir', () => {
    expect(newPostPath('', 'Hi')).toBe('hi.md');
  });
});

describe('uniquePath', () => {
  it('returns the path unchanged when it is free', () => {
    expect(uniquePath('static/a.png', ['static/b.png'])).toBe('static/a.png');
  });
  it('suffixes before the extension on collision', () => {
    expect(uniquePath('static/a.png', ['static/a.png'])).toBe('static/a-1.png');
  });
  it('keeps counting past existing suffixes', () => {
    expect(uniquePath('static/a.png', ['static/a.png', 'static/a-1.png'])).toBe('static/a-2.png');
  });
  it('handles names with no extension', () => {
    expect(uniquePath('static/README', ['static/README'])).toBe('static/README-1');
  });
});

describe('guessDirs', () => {
  it('prefers src/content over content when both exist', () => {
    expect(guessDirs(['src/content/a.md', 'content/b.md']).contentDir).toBe('src/content');
  });
  it('finds a posts directory', () => {
    expect(guessDirs(['posts/a.md']).contentDir).toBe('posts');
  });
  it('picks an image directory from known candidates', () => {
    expect(guessDirs(['static/img/logo.png', 'content/a.md']).imageDir).toBe('static');
  });
  it('falls back to repo root and an images folder when nothing matches', () => {
    expect(guessDirs(['a.md'])).toEqual({ contentDir: '', imageDir: 'images' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/github-paths.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/github-paths.js`:

```js
const CONTENT_CANDIDATES = ['src/content', 'content', '_posts', 'posts', 'src/pages'];
const IMAGE_CANDIDATES = ['static', 'public', 'assets', 'src/assets', 'images'];

export function slugify(text) {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

export function newPostPath(contentDir, title) {
  const dir = contentDir.replace(/\/+$/, '');
  const file = `${slugify(title)}.md`;
  return dir ? `${dir}/${file}` : file;
}

export function uniquePath(path, existingPaths) {
  const taken = new Set(existingPaths);
  if (!taken.has(path)) return path;
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  const hasExt = dot > slash;
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : '';
  let n = 1;
  while (taken.has(`${stem}-${n}${ext}`)) n += 1;
  return `${stem}-${n}${ext}`;
}

export function guessDirs(paths) {
  const dirs = new Set();
  for (const path of paths) {
    const parts = path.split('/');
    parts.pop();
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      dirs.add(prefix);
    }
  }
  return {
    contentDir: CONTENT_CANDIDATES.find((c) => dirs.has(c)) ?? '',
    imageDir: IMAGE_CANDIDATES.find((c) => dirs.has(c)) ?? 'images',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/github-paths.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Add the new-post dialog markup**

In `src/renderer/index.html`, add next to the other dialogs:

```html
  <dialog id="path-dialog">
    <form method="dialog">
      <label id="path-label" for="path-input">File path</label>
      <input id="path-input" type="text" />
      <div class="dialog-buttons">
        <button value="cancel">Cancel</button>
        <button value="ok" id="path-ok">Create</button>
      </div>
    </form>
  </dialog>
```

- [ ] **Step 6: Add the "New post" control**

In `src/renderer/github-panel.js`, add a path prompt and a `+` button. Add near the top of the module:

```js
import { guessDirs, uniquePath } from './github-paths.js';
```

```js
  let allPaths = [];
  let dirs = { contentDir: '', imageDir: 'images' };

  function askPath(labelText, initial, okText) {
    const dialog = document.getElementById('path-dialog');
    const input = document.getElementById('path-input');
    document.getElementById('path-label').textContent = labelText;
    document.getElementById('path-ok').textContent = okText;
    input.value = initial;
    dialog.returnValue = 'cancel';
    dialog.showModal();
    const slash = initial.lastIndexOf('/');
    const dot = initial.lastIndexOf('.');
    input.setSelectionRange(slash + 1, dot > slash ? dot : initial.length);
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => {
        resolve(dialog.returnValue === 'ok' ? input.value.trim() : null);
      }, { once: true });
    });
  }

  async function newPost() {
    const dir = dirs.contentDir;
    const initial = dir ? `${dir}/untitled.md` : 'untitled.md';
    const path = await askPath('New post path', initial, 'Create');
    if (!path) return;
    await onNewFile({
      repo: selectedRepo,
      branch: selectedBranch,
      path: uniquePath(path, allPaths),
    });
  }
```

In `loadTree()`, record the flat path list and directory guesses after the tree is built:

```js
    allPaths = data ? data.entries.filter((e) => e.type === 'blob').map((e) => e.path) : [];
    dirs = guessDirs(allPaths);
```

In `render()`, add the button to the header when a repo is selected — insert just before `container.append(treeEl);`:

```js
    const actions = document.createElement('div');
    actions.className = 'gh-actions';
    if (selectedRepo && selectedBranch) {
      const add = document.createElement('button');
      add.textContent = '+ New post';
      add.addEventListener('click', newPost);
      actions.append(add);
    }
    container.append(actions);
```

Extend the panel's signature with `onNewFile` and its return value with `getDirs`:

```js
export function createGitHubPanel(container, {
  onError = () => {},
  onOpenFile = async () => {},
  onNewFile = async () => {},
} = {}) {
```

```js
    getDirs: () => dirs,
    getPaths: () => allPaths,
```

- [ ] **Step 7: Handle new posts in `index.js`**

Add to `src/renderer/index.js` and pass it as `onNewFile`:

```js
async function newRepoFile({ repo, branch, path }) {
  if (!(await guardDirty())) return;
  const head = await window.markpad.github.getHead(repo, branch);
  if (!head.ok) {
    ui.showError(`Could not start a new post: ${head.error}`);
    return;
  }
  fmPanel.setFrontmatter(null);
  setDoc(view, '');
  await ui.refreshRendered();
  // baseSha null means "this file does not exist on GitHub yet", so the
  // stale-file guard in save() correctly skips the conflict check.
  markSaved(
    sources.repoSource({ repo, branch, path, baseSha: null, headSha: head.data.headSha }),
    path.split('/').pop()
  );
  savedDoc = null; // a brand-new post starts dirty so Ctrl+S has something to do
  refreshTitle();
}
```

- [ ] **Step 8: Verify by hand**

Run: `npm start`
Expected: "+ New post" prompts with a prefilled path, the slug portion selected. Accepting opens an empty document titled with your filename, marked dirty. `Ctrl+S` commits it as a new file, and it appears in the sidebar tree after the refresh. Verify on github.com that the file was created.

- [ ] **Step 9: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/renderer/github-paths.js tests/github-paths.test.js src/renderer/github-panel.js src/renderer/index.js src/renderer/index.html
git commit -m "feat(github): create new posts in a repo"
```

---

### Task 11: Rename and delete

**Files:**
- Modify: `src/renderer/github-panel.js`, `src/renderer/index.js`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: `window.markpad.github.commit` (Task 8), `askPath` (Task 10), `readFile` (Task 5).
- Produces: the panel's options gain `onRenamed({ repo, branch, oldPath, newPath })` and `onDeleted({ repo, branch, path })`, so `index.js` can update or close the open document.

- [ ] **Step 1: Add the context menu**

In `src/renderer/github-panel.js`, add to the file-row branch of `renderNodes` (right after the `click` listener):

```js
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, node.path);
        });
```

and add these functions to the module:

```js
  function showContextMenu(x, y, path) {
    document.querySelector('.gh-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'gh-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    for (const [label, handler] of [
      ['Rename…', () => renameFile(path)],
      ['Delete…', () => deleteFile(path)],
    ]) {
      const item = document.createElement('button');
      item.textContent = label;
      item.addEventListener('click', () => { menu.remove(); handler(); });
      menu.append(item);
    }

    document.body.append(menu);
    setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
  }

  async function renameFile(path) {
    const target = await askPath('Rename to', path, 'Rename');
    if (!target || target === path) return;
    const newPath = uniquePath(target, allPaths);

    const file = await call(window.markpad.github.readFile(selectedRepo, selectedBranch, path));
    if (!file) return;

    // One commit: write the content at the new path, drop the old one.
    const result = await call(window.markpad.github.commit({
      repo: selectedRepo,
      branch: selectedBranch,
      message: `Rename ${path} to ${newPath}`,
      files: [
        { path: newPath, content: file.content },
        { path, delete: true },
      ],
      expectedHeadSha: null,
    }));
    if (!result) return;

    await onRenamed({ repo: selectedRepo, branch: selectedBranch, oldPath: path, newPath });
    if (openPath === path) openPath = newPath;
    await loadTree();
  }

  async function deleteFile(path) {
    if (!window.confirm(`Delete ${path} from ${selectedRepo}?`)) return;
    const result = await call(window.markpad.github.commit({
      repo: selectedRepo,
      branch: selectedBranch,
      message: `Delete ${path}`,
      files: [{ path, delete: true }],
      expectedHeadSha: null,
    }));
    if (!result) return;
    await onDeleted({ repo: selectedRepo, branch: selectedBranch, path });
    if (openPath === path) openPath = null;
    await loadTree();
  }
```

Add `onRenamed` and `onDeleted` to the panel's destructured options, both defaulting to `async () => {}`.

- [ ] **Step 2: Style the menu**

Append to `src/renderer/styles.css`:

```css
.gh-menu {
  position: fixed;
  z-index: 100;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  padding: 4px;
  border-radius: 6px;
  background: #2a2d33;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}
.gh-menu button { text-align: left; padding: 6px 10px; background: none; border: 0; color: inherit; }
.gh-menu button:hover { background: rgba(255, 255, 255, 0.1); }
```

- [ ] **Step 3: Keep the open document in sync**

In `src/renderer/index.js`, pass these two handlers to `createGitHubPanel`:

```js
async function onRepoFileRenamed({ repo, branch, oldPath, newPath }) {
  if (source?.kind !== 'repo' || source.path !== oldPath) return;
  const head = await window.markpad.github.getHead(repo, branch);
  const file = await window.markpad.github.fileSha(repo, branch, newPath);
  currentName = newPath.split('/').pop();
  source = sources.repoSource({
    repo,
    branch,
    path: newPath,
    baseSha: file.ok ? file.data.sha : null,
    headSha: head.ok ? head.data.headSha : source.headSha,
  });
  refreshTitle();
}

async function onRepoFileDeleted({ repo, branch, path }) {
  if (source?.kind !== 'repo' || source.path !== path) return;
  // The buffer stays open but is no longer backed by anything on GitHub.
  source = null;
  currentName = `${path.split('/').pop()} (deleted)`;
  refreshTitle();
}
```

- [ ] **Step 4: Verify by hand**

Run: `npm start`
Expected: right-clicking a file in the tree offers Rename and Delete. Renaming the currently open file updates the title bar and leaves the buffer intact; check on github.com that the rename is a **single** commit containing both the addition and the deletion. Deleting the open file leaves your text on screen but detaches it, so `Ctrl+S` falls through to Save As.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/renderer/github-panel.js src/renderer/index.js src/renderer/styles.css
git commit -m "feat(github): rename and delete repo files"
```

---

# Phase 4 — Publishing

### Task 12: Image staging and upload

**Files:**
- Create: `src/renderer/repo-config.js`
- Modify: `src/main/main.js`, `src/main/github/index.js`, `src/preload.js`, `src/renderer/ui.js`, `src/renderer/preview.js`, `src/renderer/index.js`, `src/renderer/github-paths.js`, `src/renderer/github-panel.js`, `src/renderer/styles.css`
- Test: `tests/github-paths.test.js` (extend)

**Interfaces:**
- Consumes: `uniquePath` (Task 10), `commit` with `contentBase64` (Task 6).
- Produces:
  - `imageLink(postPath, imagePath, style)` in `github-paths.js` → the markdown URL for an image, where `style` is `'relative'` or `'site-absolute'`
  - `repoPathForLink(postPath, src, knownPaths)` in `github-paths.js` → the inverse of `imageLink`
  - `loadConfig(repo, guesses)` / `saveConfig(repo, config)` in `repo-config.js`; the panel gains `getConfig()` (replacing Task 10's `getDirs()`)
  - Main: `dialog:openImageData` → `{ name, base64, dataUrl }`; `github:readAsset(repo, branch, path)` → `{ dataUrl }`
  - Renderer: `ui.setImageHandler(fn)` — when set, the toolbar's image action calls `fn()` instead of using a `file://` URL; `setAssetResolver(fn)` exported from `preview.js`

- [ ] **Step 1: Write the failing test for link styles**

Append to `tests/github-paths.test.js`:

```js
import { imageLink, repoPathForLink } from '../src/renderer/github-paths.js';

describe('imageLink', () => {
  it('builds a site-absolute link stripped of the publish root', () => {
    expect(imageLink('content/posts/a.md', 'static/img/x.png', 'site-absolute'))
      .toBe('/img/x.png');
  });
  it('leaves a non-publish-root prefix intact when site-absolute', () => {
    expect(imageLink('content/a.md', 'assets/x.png', 'site-absolute'))
      .toBe('/assets/x.png');
  });
  it('builds a relative link from the post to the image', () => {
    expect(imageLink('content/posts/a.md', 'content/posts/img/x.png', 'relative'))
      .toBe('img/x.png');
  });
  it('walks up out of the post directory when needed', () => {
    expect(imageLink('content/posts/a.md', 'static/x.png', 'relative'))
      .toBe('../../static/x.png');
  });
  it('handles a post at the repo root', () => {
    expect(imageLink('a.md', 'images/x.png', 'relative')).toBe('images/x.png');
  });
});

describe('repoPathForLink', () => {
  it('reverses a relative link back to a repo path', () => {
    expect(repoPathForLink('content/posts/a.md', '../../static/x.png', []))
      .toBe('static/x.png');
  });
  it('resolves a same-directory link', () => {
    expect(repoPathForLink('content/a.md', 'img/x.png', [])).toBe('content/img/x.png');
  });
  it('restores the publish root a site-absolute link stripped', () => {
    expect(repoPathForLink('content/a.md', '/img/x.png', ['static/img/x.png']))
      .toBe('static/img/x.png');
  });
  it('leaves a site-absolute link alone when it already matches a real path', () => {
    expect(repoPathForLink('content/a.md', '/assets/x.png', ['assets/x.png']))
      .toBe('assets/x.png');
  });
  it('falls back to the bare path when nothing matches', () => {
    expect(repoPathForLink('content/a.md', '/img/x.png', [])).toBe('img/x.png');
  });
});
```

`repoPathForLink` is the inverse of `imageLink`. It has to exist because the site-absolute style deletes information — `static/img/x.png` becomes `/img/x.png` — so recovering the repo path means testing the known file list against each publish root.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/github-paths.test.js -t imageLink`
Expected: FAIL — `imageLink` is not exported.

- [ ] **Step 3: Implement `imageLink`**

Add to `src/renderer/github-paths.js`:

```js
// Directories a static-site generator publishes at the site root.
const PUBLISH_ROOTS = ['static', 'public'];

export function imageLink(postPath, imagePath, style) {
  if (style === 'site-absolute') {
    const root = PUBLISH_ROOTS.find((r) => imagePath.startsWith(`${r}/`));
    return `/${root ? imagePath.slice(root.length + 1) : imagePath}`;
  }

  const from = postPath.split('/').slice(0, -1);
  const to = imagePath.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1;
  const up = Array(from.length - shared).fill('..');
  return [...up, ...to.slice(shared)].join('/');
}

// The inverse of imageLink: given a markdown image URL, find the repo path.
export function repoPathForLink(postPath, src, knownPaths = []) {
  if (src.startsWith('/')) {
    const bare = src.slice(1);
    const known = new Set(knownPaths);
    if (known.has(bare)) return bare;
    for (const root of PUBLISH_ROOTS) {
      if (known.has(`${root}/${bare}`)) return `${root}/${bare}`;
    }
    return bare;
  }
  const parts = postPath.split('/').slice(0, -1);
  for (const segment of src.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/github-paths.test.js`
Expected: PASS (25 tests).

- [ ] **Step 5: Read image bytes in main**

In `src/main/main.js`, add a handler beside the existing `dialog:openImage`:

```js
ipcMain.handle('dialog:openImageData', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    filters: IMAGE_FILTERS,
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  try {
    const bytes = await fs.readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext;
    const base64 = bytes.toString('base64');
    return {
      name: path.basename(filePath),
      base64,
      dataUrl: `data:image/${mime};base64,${base64}`,
    };
  } catch (err) {
    return { error: err.message };
  }
});
```

In `src/main/github/index.js`, add an asset reader so committed images can render in preview (this is what keeps private repos working and the renderer origin-clean):

```js
  ipcMain.handle('github:readAsset', wrap(async (repo, branch, path) => {
    const data = await client.request('GET', `/repos/${repo}/contents/${repoApi.encodePath(path)}`, {
      query: { ref: branch },
    });
    const ext = path.split('.').pop().toLowerCase();
    const mime = ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext;
    return { dataUrl: `data:image/${mime};base64,${data.content.replace(/\n/g, '')}` };
  }));
```

Add both to `src/preload.js` — `openImageData: () => ipcRenderer.invoke('dialog:openImageData')` at the top level, and `readAsset: (repo, branch, path) => ipcRenderer.invoke('github:readAsset', repo, branch, path)` inside `github`.

- [ ] **Step 6: Let the preview resolve image sources**

In `src/renderer/preview.js`, add a resolver hook. Replace the module's top with:

```js
let resolveAsset = null;

// index.js installs a resolver when a repo document is open, so that both
// staged (uncommitted) and already-committed images render in the preview.
export function setAssetResolver(fn) {
  resolveAsset = fn;
}
```

and inside `renderPreview`, after the mermaid loop, add:

```js
  if (resolveAsset) {
    for (const img of container.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (!src || /^(https?:|data:|file:)/i.test(src)) continue;
      const resolved = await resolveAsset(src);
      if (resolved) img.setAttribute('src', resolved);
    }
  }
```

- [ ] **Step 7: Stage images from the toolbar**

In `src/renderer/ui.js`, add a settable handler above `initUI`:

```js
let imageHandler = null;

export function setImageHandler(fn) {
  imageHandler = fn;
}
```

and change the first lines of `insertImage()` (currently `src/renderer/ui.js:353-358`) to consult it:

```js
  async function insertImage() {
    const renderedSelection = mode === 'preview' ? saveRenderedSelection() : null;
    let image = null;
    if (imageHandler) image = await imageHandler();
    else if (window.markpad?.openImage) image = await window.markpad.openImage();

    const url = image?.url || await askUrl('Image URL');
```

The handler returns the same `{ url, name }` shape the existing code expects, so nothing below changes.

- [ ] **Step 8: Add the per-repo settings row**

The directory guesses from Task 10 are a starting point, not a decision. This makes all four per-repo settings editable and persistent, as the spec requires. Nothing is written into the user's repository.

Create `src/renderer/repo-config.js`:

```js
// Per-repo settings live in MarkPad's own storage, never in the user's repo.
const DEFAULTS = { contentDir: '', imageDir: 'images', imageLinkStyle: 'relative' };

export function loadConfig(repo, guesses = {}) {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(`gh.config.${repo}`) || '{}');
  } catch {
    stored = {};
  }
  return { ...DEFAULTS, ...guesses, ...stored };
}

export function saveConfig(repo, config) {
  localStorage.setItem(`gh.config.${repo}`, JSON.stringify(config));
}
```

In `src/renderer/github-panel.js`, import it and replace the bare `dirs` state with a config object:

```js
import { loadConfig, saveConfig } from './repo-config.js';
```

```js
  let config = { contentDir: '', imageDir: 'images', imageLinkStyle: 'relative' };
```

In `loadTree()`, replace the `dirs = guessDirs(allPaths);` line from Task 10 with:

```js
    config = loadConfig(selectedRepo, guessDirs(allPaths));
```

Replace every other reference to `dirs.contentDir` / `dirs.imageDir` with `config.contentDir` / `config.imageDir`, and change the panel's returned `getDirs` to `getConfig: () => config`.

Add the settings row, appending it in `render()` just before `container.append(treeEl);`:

```js
    if (selectedRepo) {
      const settings = document.createElement('details');
      settings.className = 'gh-settings';
      const summary = document.createElement('summary');
      summary.textContent = 'Repository settings';
      settings.append(summary);

      const fields = [
        ['contentDir', 'New posts folder', 'text'],
        ['imageDir', 'Images folder', 'text'],
        ['imageLinkStyle', 'Image links', 'select'],
      ];
      for (const [key, label, kind] of fields) {
        const wrap = document.createElement('label');
        wrap.textContent = label;
        let input;
        if (kind === 'select') {
          input = document.createElement('select');
          input.append(
            new Option('Relative to the post', 'relative', false, config[key] === 'relative'),
            new Option('Absolute from site root', 'site-absolute', false, config[key] === 'site-absolute')
          );
        } else {
          input = document.createElement('input');
          input.type = 'text';
          input.value = config[key];
        }
        input.addEventListener('change', () => {
          config = { ...config, [key]: input.value };
          saveConfig(selectedRepo, config);
        });
        wrap.append(input);
        settings.append(wrap);
      }
      container.append(settings);
    }
```

Append to `src/renderer/styles.css`:

```css
.gh-settings { margin: 8px 0; }
.gh-settings summary { cursor: pointer; padding: 4px 0; }
.gh-settings label { display: block; margin: 6px 0; font-size: 12px; }
.gh-settings input, .gh-settings select { width: 100%; }
```

- [ ] **Step 9: Wire staging into `index.js`**

Add to `src/renderer/index.js`:

```js
import { setAssetResolver } from './preview.js';
import { setImageHandler } from './ui.js';
import { imageLink, repoPathForLink, uniquePath } from './github-paths.js';

// Images chosen for a repo document wait here until the next commit.
let pendingImages = []; // [{ path, base64, dataUrl }]

setImageHandler(async () => {
  if (source?.kind !== 'repo') return null;
  const picked = await window.markpad.openImageData();
  if (!picked || picked.error) {
    if (picked?.error) ui.showError(`Could not read image: ${picked.error}`);
    return null;
  }
  const { imageDir, imageLinkStyle } = ghPanel.getConfig();
  const taken = [...ghPanel.getPaths(), ...pendingImages.map((i) => i.path)];
  const path = uniquePath(imageDir ? `${imageDir}/${picked.name}` : picked.name, taken);
  pendingImages.push({ path, base64: picked.base64, dataUrl: picked.dataUrl });
  return { url: imageLink(source.path, path, imageLinkStyle), name: picked.name };
});

setAssetResolver(async (src) => {
  if (source?.kind !== 'repo') return null;
  const known = [...ghPanel.getPaths(), ...pendingImages.map((i) => i.path)];
  const resolved = repoPathForLink(source.path, src, known);
  const staged = pendingImages.find((i) => i.path === resolved);
  if (staged) return staged.dataUrl;
  const asset = await window.markpad.github.readAsset(source.repo, source.branch, resolved);
  return asset.ok ? asset.data.dataUrl : null;
});
```

In `save()`, include the staged images in the commit and clear them afterwards. Change the two `source.save(fullDoc(), ...)` calls in the repo branch to pass `extraFiles`:

```js
  const extraFiles = pendingImages.map((i) => ({ path: i.path, contentBase64: i.base64 }));
```

```js
    : await source.save(fullDoc(), { message, extraFiles });
```

```js
    result = await source.save(fullDoc(), { message, extraFiles, force: true });
```

and after `markSaved(result.source, currentName);` in the repo branch add:

```js
  pendingImages = [];
```

Also clear `pendingImages = []` at the top of `newFile()`, `openFile()`, `openRepoFile()` and `newRepoFile()`, so staged images never leak between documents.

- [ ] **Step 10: Verify by hand**

Run: `npm start`
Expected: with a repo file open, the toolbar's image button opens the native picker; the chosen image appears immediately in the rendered preview and a relative markdown link is inserted. `Ctrl+S` produces **one** commit on github.com containing both the post and the image file. Existing committed images in a post also render in preview. With a *local* file open, the image button behaves exactly as it did before.

- [ ] **Step 11: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/main/main.js src/main/github/index.js src/preload.js src/renderer/ui.js src/renderer/preview.js src/renderer/index.js src/renderer/github-paths.js src/renderer/repo-config.js src/renderer/github-panel.js src/renderer/styles.css tests/github-paths.test.js
git commit -m "feat(github): stage and commit images alongside posts"
```

---

### Task 13: Create a pull request

**Files:**
- Modify: `src/main/github/repo.js`, `src/main/github/index.js`, `src/preload.js`, `src/renderer/github-panel.js`, `src/renderer/index.html`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: `client` (Task 1), the panel's `selectedRepo`/`selectedBranch` (Task 5).
- Produces:
  - `findPullRequest(client, repo, branch, owner)` → `{ url } | null`
  - `createPullRequest(client, { repo, head, base, title, body })` → `{ url }`
  - `createBranch(client, repo, name, fromSha)` → `{ ok: true }`
  - Preload: `github.findPullRequest`, `github.createPullRequest`, `github.createBranch`

- [ ] **Step 1: Add the PR operations**

Add to `src/main/github/repo.js` and its exports:

```js
async function findPullRequest(client, repo, branch, owner) {
  const prs = await client.request('GET', `/repos/${repo}/pulls`, {
    query: { head: `${owner}:${branch}`, state: 'open' },
  });
  return prs.length ? { url: prs[0].html_url, number: prs[0].number } : null;
}

async function createPullRequest(client, { repo, head, base, title, body }) {
  const pr = await client.request('POST', `/repos/${repo}/pulls`, {
    body: { head, base, title, body },
  });
  return { url: pr.html_url, number: pr.number };
}

async function createBranch(client, repo, name, fromSha) {
  await client.request('POST', `/repos/${repo}/git/refs`, {
    body: { ref: `refs/heads/${name}`, sha: fromSha },
  });
  return { name };
}
```

- [ ] **Step 2: Expose them**

In `src/main/github/index.js`:

```js
  ipcMain.handle('github:findPullRequest', wrap((repo, branch) =>
    repoApi.findPullRequest(client, repo, branch, account?.login)));
  ipcMain.handle('github:createPullRequest', wrap((args) => repoApi.createPullRequest(client, args)));
  ipcMain.handle('github:createBranch', wrap((repo, name, fromSha) =>
    repoApi.createBranch(client, repo, name, fromSha)));
```

In `src/preload.js`, add to `github`:

```js
    findPullRequest: (repo, branch) => ipcRenderer.invoke('github:findPullRequest', repo, branch),
    createPullRequest: (args) => ipcRenderer.invoke('github:createPullRequest', args),
    createBranch: (repo, name, fromSha) => ipcRenderer.invoke('github:createBranch', repo, name, fromSha),
```

- [ ] **Step 3: Add the PR dialog markup**

In `src/renderer/index.html`, next to the other dialogs:

```html
  <dialog id="pr-dialog">
    <form method="dialog">
      <label for="pr-title">Pull request title</label>
      <input id="pr-title" type="text" />
      <label for="pr-body">Description</label>
      <textarea id="pr-body" rows="4"></textarea>
      <label for="pr-base">Merge into</label>
      <input id="pr-base" type="text" />
      <div class="dialog-buttons">
        <button value="cancel">Cancel</button>
        <button value="ok" id="pr-ok">Create pull request</button>
      </div>
    </form>
  </dialog>
```

- [ ] **Step 4: Add the PR action and a "New branch" option**

In `src/renderer/github-panel.js`, add:

```js
  function defaultBranchOf(repo) {
    return repos.find((r) => r.fullName === repo)?.defaultBranch || 'main';
  }

  async function createPr() {
    const base = defaultBranchOf(selectedRepo);
    const existing = await call(window.markpad.github.findPullRequest(selectedRepo, selectedBranch));
    if (existing) {
      window.markpad.github.openExternal(existing.url);
      return;
    }

    const dialog = document.getElementById('pr-dialog');
    document.getElementById('pr-title').value = selectedBranch;
    document.getElementById('pr-body').value = '';
    document.getElementById('pr-base').value = base;
    dialog.returnValue = 'cancel';
    dialog.showModal();
    const ok = await new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    });
    if (!ok) return;

    const pr = await call(window.markpad.github.createPullRequest({
      repo: selectedRepo,
      head: selectedBranch,
      base: document.getElementById('pr-base').value.trim(),
      title: document.getElementById('pr-title').value.trim() || selectedBranch,
      body: document.getElementById('pr-body').value,
    }));
    if (pr) window.markpad.github.openExternal(pr.url);
  }

  async function newBranch() {
    const name = window.prompt('New branch name');
    if (!name) return;
    const head = await call(window.markpad.github.getHead(selectedRepo, selectedBranch));
    if (!head) return;
    const created = await call(window.markpad.github.createBranch(selectedRepo, name, head.headSha));
    if (!created) return;
    branches = (await call(window.markpad.github.listBranches(selectedRepo))) || [];
    await selectBranch(name);
  }
```

In `render()`, extend the `actions` block built in Task 10 so it also holds these two buttons:

```js
      const branchButton = document.createElement('button');
      branchButton.textContent = 'New branch';
      branchButton.addEventListener('click', newBranch);
      actions.append(branchButton);

      if (selectedBranch !== defaultBranchOf(selectedRepo)) {
        const prButton = document.createElement('button');
        prButton.textContent = 'Create PR';
        prButton.addEventListener('click', createPr);
        actions.append(prButton);
      }
```

- [ ] **Step 5: Style the action row**

Append to `src/renderer/styles.css`:

```css
.gh-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.gh-actions button { flex: 1 1 auto; }
#pr-dialog textarea { width: 100%; }
```

- [ ] **Step 6: Verify by hand**

Run: `npm start`
Expected: "New branch" creates a branch from the current one and switches to it. On a non-default branch, "Create PR" appears; commit something to that branch, click it, fill the dialog, and the PR opens in your browser. Clicking "Create PR" a second time for the same branch opens the *existing* PR rather than erroring.

- [ ] **Step 7: Run the suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/main/github src/preload.js src/renderer/github-panel.js src/renderer/index.html src/renderer/styles.css
git commit -m "feat(github): create branches and pull requests"
```

---

### Task 14: Documentation

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Document the OAuth App setup in the README**

Add a "GitHub integration" section covering: registering an OAuth App, enabling device flow, where to put the client ID (`CLIENT_ID` in `src/main/github/index.js`), the `repo` scope caveat, and the `Ctrl+Shift+B` sidebar shortcut.

- [ ] **Step 2: Add a CHANGELOG entry**

Follow the existing format; summarize the feature as "Edit, commit and publish markdown files directly from a GitHub repository."

- [ ] **Step 3: Extend CLAUDE.md's Architecture section**

Add a short subsection after "Document composition and dirty tracking" explaining: all GitHub HTTP lives in main and the token never reaches the renderer; every write goes through the single `commit()` primitive in `src/main/github/repo.js`; and `doc-source.js` is the local-vs-repo seam that `index.js` delegates to.

- [ ] **Step 4: Commit**

```bash
npm test
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "docs: document the GitHub integration"
```

---

## Manual Verification Checklist

Run through this after Task 14, with the real OAuth App client ID in place:

- [ ] Connect via device flow; the login name appears in the sidebar
- [ ] Restart the app — you are still signed in (token survives in the vault)
- [ ] Sign out, restart — you are signed out
- [ ] Switch repos and branches; the tree reloads each time
- [ ] Open a post, edit, `Ctrl+S`, confirm the commit on github.com
- [ ] Cancel the commit bar with Escape — no commit, document stays dirty
- [ ] Create a new post, commit it, see it appear in the tree
- [ ] Insert an image; post and image land in one commit
- [ ] Change the image link style to "Absolute from site root" in Repository settings; a newly inserted image still previews correctly, and the setting survives a restart
- [ ] Rename a file — one commit, both changes
- [ ] Delete a file
- [ ] Create a branch, commit to it, open a PR; click Create PR again and get the existing one
- [ ] Force a conflict (edit the same file on github.com) and exercise all four dialog buttons
- [ ] Turn off networking and press `Ctrl+S` — a clear error, no lost text
- [ ] Local files: New / Open / Save / Save As / close-with-unsaved-changes all behave as before
