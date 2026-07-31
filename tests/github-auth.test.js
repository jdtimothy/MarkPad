import { describe, it, expect } from 'vitest';
import { requestDeviceCode, pollForToken } from '../src/main/github/auth.js';

function scriptedFetch(responses, capture = { calls: [] }) {
  return async (url, init) => {
    capture.calls.push({ url, init });
    const body = responses.shift();
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async json() { return body; },
    };
  };
}

describe('requestDeviceCode', () => {
  it('posts the client id and normalizes the response', async () => {
    const capture = { calls: [] };
    const fetch = scriptedFetch([{
      device_code: 'dev123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900,
    }], capture);

    const result = await requestDeviceCode({ fetch, clientId: 'cid', scope: 'repo' });

    expect(capture.calls[0].url).toBe('https://github.com/login/device/code');
    expect(capture.calls[0].init.headers.Accept).toBe('application/json');
    expect(JSON.parse(capture.calls[0].init.body)).toEqual({ client_id: 'cid', scope: 'repo' });
    expect(result).toEqual({
      deviceCode: 'dev123',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      interval: 5,
      expiresIn: 900,
    });
  });
});

describe('pollForToken', () => {
  it('waits through authorization_pending and returns the token', async () => {
    const slept = [];
    const fetch = scriptedFetch([
      { error: 'authorization_pending' },
      { error: 'authorization_pending' },
      { access_token: 'gho_abc', token_type: 'bearer' },
    ]);
    const result = await pollForToken({
      fetch, clientId: 'cid', deviceCode: 'dev123',
      interval: 5, expiresIn: 900,
      sleep: async (s) => { slept.push(s); },
    });
    expect(result).toEqual({ accessToken: 'gho_abc' });
    expect(slept).toEqual([5, 5, 5]);
  });

  it('adopts the longer interval after slow_down', async () => {
    const slept = [];
    const fetch = scriptedFetch([
      { error: 'slow_down', interval: 10 },
      { access_token: 'gho_abc' },
    ]);
    await pollForToken({
      fetch, clientId: 'cid', deviceCode: 'd',
      interval: 5, expiresIn: 900,
      sleep: async (s) => { slept.push(s); },
    });
    expect(slept).toEqual([5, 10]);
  });

  it('rejects with access_denied when the user cancels', async () => {
    const fetch = scriptedFetch([{ error: 'access_denied' }]);
    await expect(pollForToken({
      fetch, clientId: 'c', deviceCode: 'd',
      interval: 1, expiresIn: 900, sleep: async () => {},
    })).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('rejects with expired_token when GitHub reports expiry', async () => {
    const fetch = scriptedFetch([{ error: 'expired_token' }]);
    await expect(pollForToken({
      fetch, clientId: 'c', deviceCode: 'd',
      interval: 1, expiresIn: 900, sleep: async () => {},
    })).rejects.toMatchObject({ code: 'expired_token' });
  });

  it('gives up once the elapsed sleep exceeds expiresIn', async () => {
    const fetch = scriptedFetch(Array(100).fill({ error: 'authorization_pending' }));
    await expect(pollForToken({
      fetch, clientId: 'c', deviceCode: 'd',
      interval: 5, expiresIn: 12, sleep: async () => {},
    })).rejects.toMatchObject({ code: 'expired_token' });
  });
});
