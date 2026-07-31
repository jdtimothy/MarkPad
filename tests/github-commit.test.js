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
