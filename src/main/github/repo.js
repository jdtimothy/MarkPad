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
