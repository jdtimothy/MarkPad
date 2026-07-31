import { buildTree } from './github-tree.js';

export function createGitHubPanel(container, {
  onError = () => {},
  onOpenFile = async () => {},
} = {}) {
  const dialog = document.getElementById('device-dialog');
  const codeEl = document.getElementById('device-code');
  let account = null;
  let repos = [];
  let branches = [];
  let selectedRepo = localStorage.getItem('gh.repo') || null;
  let selectedBranch = null;
  let tree = [];
  let truncated = false;
  let openPath = null;

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
    await loadRepos();
  }

  async function signOut() {
    await window.markpad.github.signOut();
    account = null;
    repos = [];
    branches = [];
    tree = [];
    render();
  }

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
