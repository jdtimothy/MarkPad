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
