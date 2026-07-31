const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

function authError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function postJson(fetch, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function requestDeviceCode({ fetch, clientId, scope = 'repo' }) {
  const data = await postJson(fetch, DEVICE_CODE_URL, { client_id: clientId, scope });
  if (data.error) throw authError(data.error, data.error_description || data.error);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval ?? 5,
    expiresIn: data.expires_in ?? 900,
  };
}

async function pollForToken({ fetch, clientId, deviceCode, interval, expiresIn, sleep }) {
  let wait = interval;
  let elapsed = 0;

  while (elapsed < expiresIn) {
    await sleep(wait);
    elapsed += wait;

    const data = await postJson(fetch, TOKEN_URL, {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: GRANT_TYPE,
    });

    if (data.access_token) return { accessToken: data.access_token };

    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      wait = data.interval ?? wait + 5;
      continue;
    }
    throw authError(data.error || 'unknown', data.error_description || 'Device flow failed');
  }
  throw authError('expired_token', 'The device code expired. Try connecting again.');
}

module.exports = { requestDeviceCode, pollForToken };
