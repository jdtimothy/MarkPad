const { GitHubError } = require('./client.js');

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

async function getHead(client, repo, branch) {
  const ref = await client.request('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;
  const headCommit = await client.request('GET', `/repos/${repo}/git/commits/${headSha}`);
  return { headSha, treeSha: headCommit.tree.sha };
}

// The single write primitive: every save, new post, image upload, rename and
// delete funnels through here, so each becomes one atomic commit.
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

  return { commitSha: newCommit.sha, headSha: newCommit.sha, blobShas };
}

// Returns { sha: null } when the file does not exist yet, so a brand-new post
// is never mistaken for a stale one.
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

module.exports = {
  listRepos,
  listBranches,
  listTree,
  readFile,
  encodePath,
  getHead,
  commit,
  fileSha,
  findPullRequest,
  createPullRequest,
  createBranch,
};
