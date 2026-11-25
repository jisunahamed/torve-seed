import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildDesktopAuthUrl,
  DesktopApiError,
  exchangeDesktopAuthCode,
  fetchDesktopMe,
  fetchDesktopUsage,
  generatePkcePair,
  isValidPkceState,
  isValidPkceVerifier,
  revokeDesktopAuthKey,
  startLoopbackPkceServer,
} from './desktop-api.js';

function base64UrlSha256(verifier: string): string {
  return createHash('sha256')
    .update(verifier, 'ascii')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

test('PKCE pair satisfies RFC 7636 verifier, S256 challenge, and state bounds', () => {
  const pair = generatePkcePair();
  assert.equal(pair.codeChallengeMethod, 'S256');
  assert.equal(isValidPkceState(pair.state), true);
  assert.equal(isValidPkceVerifier(pair.codeVerifier), true);
  assert.equal(pair.codeChallenge, base64UrlSha256(pair.codeVerifier));
  assert.equal(pair.codeChallenge.includes('='), false);

  const authUrl = new URL(buildDesktopAuthUrl({
    webBaseUrl: 'https://torveai.com',
    redirectUri: 'http://127.0.0.1:54321/auth/callback',
    state: pair.state,
    codeChallenge: pair.codeChallenge,
    deviceName: 'Test-PC',
  }));
  assert.equal(authUrl.origin, 'https://torveai.com');
  assert.equal(authUrl.pathname, '/auth/desktop');
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:54321/auth/callback');
  assert.equal(authUrl.searchParams.get('state'), pair.state);
  assert.equal(authUrl.searchParams.get('code_challenge'), pair.codeChallenge);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authUrl.searchParams.get('device_name'), 'Test-PC');
});

test('loopback PKCE server enforces exact state check and returns connected HTML', async () => {
  const pair = generatePkcePair();
  let exchangedCode: string | null = null;
  let lastError: string | null = null;

  const handle = await startLoopbackPkceServer({
    expectedState: pair.state,
    onCode: async (code) => { exchangedCode = code; },
    onError: (msg) => { lastError = msg; },
    timeoutMs: 10_000,
  });

  assert.match(handle.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);

  // Wrong state must be rejected and never accept the code.
  const badRes = await fetch(`${handle.redirectUri}?code=abc&state=wrong-state`);
  assert.equal(badRes.status, 400);
  assert.equal(exchangedCode, null);
  assert.match(lastError ?? '', /state mismatch/i);

  // Start a clean session and verify valid callback succeeds with required message.
  let acceptedUri: string | null = null;
  const handle2 = await startLoopbackPkceServer({
    expectedState: pair.state,
    onCode: async (code, redirectUri) => {
      exchangedCode = code;
      acceptedUri = redirectUri;
    },
    onError: (msg) => { lastError = msg; },
    timeoutMs: 10_000,
  });

  const okRes = await fetch(`${handle2.redirectUri}?code=auth-code-99&state=${encodeURIComponent(pair.state)}`);
  const html = await okRes.text();
  assert.equal(okRes.status, 200);
  assert.equal(exchangedCode, 'auth-code-99');
  assert.equal(acceptedUri, handle2.redirectUri);
  assert.match(html, /Torve Desktop is connected\. You can close this window\./);
});

test('exchangeDesktopAuthCode handles success, 409 key limit, and backend errors', async () => {
  const okResult = await exchangeDesktopAuthCode({
    code: 'c123',
    codeVerifier: 'v'.repeat(64),
    redirectUri: 'http://127.0.0.1:4444/auth/callback',
    deviceName: 'Workstation',
    apiBase: 'https://api.torveai.com/api/desktop',
  }, async (url, init) => {
    assert.equal(url, 'https://api.torveai.com/api/desktop/auth/exchange');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, {
      code: 'c123',
      code_verifier: 'v'.repeat(64),
      redirect_uri: 'http://127.0.0.1:4444/auth/callback',
      device_name: 'Workstation',
    });
    return new Response(JSON.stringify({
      apiKey: 'sk-trv-secret-key-123456',
      key: { id: 'k1', name: 'Workstation', prefix: 'sk-trv-s', createdAt: '2026-11-25T00:00:00Z' },
      user: { id: 'u1', email: 'user@torveai.com', name: 'Jisun', plan: 'pro', status: 'active' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  assert.equal(okResult.apiKey, 'sk-trv-secret-key-123456');
  assert.equal(okResult.key.prefix, 'sk-trv-s');
  assert.equal(okResult.user.plan, 'pro');

  await assert.rejects(
    () => exchangeDesktopAuthCode({
      code: 'c123',
      codeVerifier: 'v'.repeat(64),
      redirectUri: 'http://127.0.0.1:4444/auth/callback',
      apiBase: 'https://api.torveai.com/api/desktop',
    }, async () => new Response(JSON.stringify({ error: 'Max 5 keys active' }), { status: 409 })),
    (err: unknown) => err instanceof DesktopApiError && err.status === 409 && /revoke an unused key on the torveai\.com Dashboard/i.test(err.message),
  );

  await assert.rejects(
    () => exchangeDesktopAuthCode({
      code: 'c123',
      codeVerifier: 'v'.repeat(64),
      redirectUri: 'http://127.0.0.1:4444/auth/callback',
      apiBase: 'https://api.torveai.com/api/desktop',
    }, async () => new Response(JSON.stringify({ message: 'Telegram verification required before activating trial.' }), { status: 403 })),
    (err: unknown) => err instanceof DesktopApiError && err.status === 403 && /Telegram verification required/i.test(err.message),
  );
});

test('fetchDesktopMe, fetchDesktopUsage, and revokeDesktopAuthKey follow exact contract', async () => {
  const me = await fetchDesktopMe('sk-trv-abc1234567890', { apiBase: 'https://api.torveai.com/api/desktop' }, async (url, init) => {
    assert.equal(url, 'https://api.torveai.com/api/desktop/me');
    assert.equal((init?.headers as Record<string, string>)['authorization'], 'Bearer sk-trv-abc1234567890');
    return new Response(JSON.stringify({
      user: { id: 'u1', email: 'dev@torveai.com', name: 'Dev', plan: 'lite', status: 'active' },
      key: { id: 'k1', name: 'Dev Laptop', prefix: 'sk-trv-a', createdAt: '2026-11-01T00:00:00Z' },
      quota: {
        usedTokensToday: 12500,
        usedRequestsToday: 42,
        rateLimitStatus: 'ok',
        resetsAt: '2026-11-26T00:00:00Z',
        monthlyUsedTokens: 100000,
        monthlyAllowanceTokens: 1000000,
      },
    }), { status: 200 });
  });
  assert.equal(me.user.plan, 'lite');
  assert.equal(me.quota.usedTokensToday, 12500);
  assert.equal(me.quota.monthlyAllowanceTokens, 1000000);

  const usage = await fetchDesktopUsage('sk-trv-abc1234567890', { range: '7d', scope: 'account', apiBase: 'https://api.torveai.com/api/desktop' }, async (url) => {
    assert.equal(url, 'https://api.torveai.com/api/desktop/usage?range=7d&scope=account');
    return new Response(JSON.stringify({
      range: '7d',
      scope: 'account',
      totals: { requests: 12, inputTokens: 4000, outputTokens: 1500, totalTokens: 5500 },
      byModel: [{ modelId: 'deepseek-v4-1-flash', requests: 12, inputTokens: 4000, outputTokens: 1500, totalTokens: 5500, avgLatencyMs: 620, lastUsedAt: '2026-11-25T12:00:00Z' }],
      byApp: [{ appId: 'codex', requests: 12, inputTokens: 4000, outputTokens: 1500, totalTokens: 5500, lastUsedAt: '2026-11-25T12:00:00Z' }],
    }), { status: 200 });
  });
  assert.equal(usage.totals.totalTokens, 5500);
  assert.equal(usage.byModel[0]?.modelId, 'deepseek-v4-1-flash');
  assert.equal(usage.byApp[0]?.appId, 'codex');

  const revoke403 = await revokeDesktopAuthKey('sk-trv-manual', { apiBase: 'https://api.torveai.com/api/desktop' }, async () => new Response('', { status: 403 }));
  assert.deepEqual(revoke403, { revoked: false, skippedManual: true });
});
