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
