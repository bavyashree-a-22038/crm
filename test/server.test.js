const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough';
process.env.ZOHO_CLIENT_ID = 'test-client-id';
process.env.ZOHO_CLIENT_SECRET = 'test-client-secret';
process.env.ZOHO_REDIRECT_URI = 'http://localhost:3000/api/auth/callback';
process.env.ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.com';
process.env.ZOHO_CRM_API_URL = 'https://www.zohoapis.com';

const { createApp, setProductionForwardedProtocol } = require('../backend/server');
const { config } = require('../backend/config');

let app;
let server;
let baseUrl;

before(async () => {
  app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await app.locals.closeResources();
});

test('health and auth status expose no OAuth tokens', async () => {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: 'ok' });

  const authResponse = await fetch(`${baseUrl}/api/auth/status`);
  assert.equal(authResponse.status, 200);
  assert.deepEqual(await authResponse.json(), {
    authenticated: false,
    configured: true
  });

  const meResponse = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(meResponse.status, 200);
  assert.deepEqual(await meResponse.json(), {
    authenticated: false,
    configured: true,
    user: null
  });
});

test('frontend is served with security headers', async () => {
  const response = await fetch(baseUrl);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(body, /Continue with Zoho/);
});

test('production requests are normalized to AppSail HTTPS', () => {
  const originalNodeEnv = config.nodeEnv;
  const request = { headers: { 'x-forwarded-proto': 'http' } };
  config.nodeEnv = 'production';

  try {
    setProductionForwardedProtocol(request, {}, () => {});
    assert.equal(request.headers['x-forwarded-proto'], 'https');
  } finally {
    config.nodeEnv = originalNodeEnv;
  }
});

test('login creates a server session and redirects to documented Zoho parameters', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, { redirect: 'manual' });
  const redirectUrl = new URL(response.headers.get('location'));
  const cookie = response.headers.get('set-cookie');

  assert.equal(response.status, 302);
  assert.equal(redirectUrl.origin, 'https://accounts.zoho.com');
  assert.equal(redirectUrl.pathname, '/oauth/v2/auth');
  assert.equal(redirectUrl.searchParams.get('client_id'), 'test-client-id');
  assert.equal(redirectUrl.searchParams.get('response_type'), 'code');
  assert.equal(redirectUrl.searchParams.get('access_type'), 'offline');
  assert.equal(redirectUrl.searchParams.get('redirect_uri'), process.env.ZOHO_REDIRECT_URI);
  assert.equal(redirectUrl.searchParams.get('prompt'), 'consent');
  assert.match(redirectUrl.searchParams.get('scope'), /ZohoCRM\.modules\.ALL/);
  assert.equal(redirectUrl.searchParams.get('state').length, 64);
  assert.match(cookie, /mini_crm_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test('callback rejects a missing or invalid state before contacting Zoho', async () => {
  const response = await fetch(`${baseUrl}/api/auth/callback?code=unused&state=invalid`, {
    redirect: 'manual'
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'The OAuth callback state is invalid or expired.');
});

test('denied OAuth callbacks must also provide the pending state', async () => {
  const response = await fetch(`${baseUrl}/api/auth/callback?error=access_denied&state=invalid`, {
    redirect: 'manual'
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'The OAuth callback state is invalid or expired.');
});

test('unsafe API requests reject a mismatched browser origin', async () => {
  const response = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example' }
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Cross-origin requests are not allowed.',
    code: 'ORIGIN_NOT_ALLOWED'
  });
});

test('unsafe API requests accept the application origin', async () => {
  const response = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: baseUrl }
  });
  assert.equal(response.status, 204);
});

test('missing OAuth configuration returns 503 without crashing the server', async () => {
  const clientId = config.zoho.clientId;
  config.zoho.clientId = '';

  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, { redirect: 'manual' });
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(payload.code, 'OAuthConfigurationError');
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
  } finally {
    config.zoho.clientId = clientId;
  }
});
