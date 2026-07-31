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
