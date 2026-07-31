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
