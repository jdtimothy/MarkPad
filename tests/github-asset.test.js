import { describe, it, expect } from 'vitest';
import { readAsset } from '../src/main/github/repo.js';

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    request: async (method, path, opts) => {
      calls.push({ method, path, opts });
      const key = `${method} ${path}`;
      if (!(key in responses)) throw new Error(`unexpected request: ${key}`);
      return responses[key];
    },
  };
}

const LISTING = [
  { name: 'other.png', type: 'file', sha: 'shaOther', size: 10 },
  { name: 'big.jpg', type: 'file', sha: 'shaBig', size: 3220976 },
];

describe('readAsset', () => {
  it('resolves the sha from the directory listing and reads the blob', async () => {
    const client = fakeClient({
      'GET /repos/o/r/contents/src/assets/blog': LISTING,
      'GET /repos/o/r/git/blobs/shaBig': { content: 'QUJD', encoding: 'base64' },
    });

    const result = await readAsset(client, 'o/r', 'main', 'src/assets/blog/big.jpg');

    expect(result).toEqual({ base64: 'QUJD', size: 3220976 });
    // The Contents API is never asked for the file itself — that is the
    // endpoint that silently truncates above 1 MB.
    expect(client.calls.map((c) => c.path)).toEqual([
      '/repos/o/r/contents/src/assets/blog',
      '/repos/o/r/git/blobs/shaBig',
    ]);
  });

  it('passes the branch as the ref when listing', async () => {
    const client = fakeClient({
      'GET /repos/o/r/contents/src/assets/blog': LISTING,
      'GET /repos/o/r/git/blobs/shaBig': { content: 'QQ==' },
    });
    await readAsset(client, 'o/r', 'feature', 'src/assets/blog/big.jpg');
    expect(client.calls[0].opts.query).toEqual({ ref: 'feature' });
  });

  it('strips the newlines GitHub wraps base64 with', async () => {
    const client = fakeClient({
      'GET /repos/o/r/contents/d': [{ name: 'a.png', type: 'file', sha: 's', size: 1 }],
      'GET /repos/o/r/git/blobs/s': { content: 'QUJ\nDRE\nVG\n' },
    });
    const result = await readAsset(client, 'o/r', 'main', 'd/a.png');
    expect(result.base64).toBe('QUJDREVG');
  });

  it('reads a file at the repository root', async () => {
    const client = fakeClient({
      'GET /repos/o/r/contents/': [{ name: 'logo.png', type: 'file', sha: 'sL', size: 4 }],
      'GET /repos/o/r/git/blobs/sL': { content: 'QQ==' },
    });
    expect((await readAsset(client, 'o/r', 'main', 'logo.png')).base64).toBe('QQ==');
  });

  it('reports a missing file as not_found rather than reading a stray blob', async () => {
    const client = fakeClient({
      'GET /repos/o/r/contents/src/assets/blog': LISTING,
    });
    await expect(
      readAsset(client, 'o/r', 'main', 'src/assets/blog/absent.jpg')
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('does not mistake a subdirectory for the file', async () => {
    const client = fakeClient({
      'GET /repos/o/r/contents/d': [{ name: 'a.png', type: 'dir', sha: 'sDir' }],
    });
    await expect(readAsset(client, 'o/r', 'main', 'd/a.png')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
