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
