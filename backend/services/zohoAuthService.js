const { config, getMissingZohoConfig } = require('../config');

const ALLOWED_ACCOUNTS_ORIGINS = new Set([
  'https://accounts.zoho.com',
  'https://accounts.zoho.com.au',
  'https://accounts.zoho.eu',
  'https://accounts.zoho.in',
  'https://accounts.zoho.com.cn',
  'https://accounts.zoho.jp',
  'https://accounts.zoho.sa',
  'https://accounts.zohocloud.ca'
]);

class OAuthConfigurationError extends Error {
  constructor(missingVariables) {
    super(`Missing OAuth configuration: ${missingVariables.join(', ')}`);
    this.name = 'OAuthConfigurationError';
    this.status = 503;
  }
}

class ZohoOAuthError extends Error {
  constructor(message, details, status = 502) {
    super(message);
    this.name = 'ZohoOAuthError';
    this.details = details;
    this.status = status;
  }
}

function assertConfigured() {
  const missingVariables = getMissingZohoConfig();
  if (missingVariables.length) {
    throw new OAuthConfigurationError(missingVariables);
  }
}

function resolveAccountsUrl(candidate) {
  const origin = new URL(candidate || config.zoho.accountsUrl).origin;
  if (!ALLOWED_ACCOUNTS_ORIGINS.has(origin)) {
    throw new ZohoOAuthError('Zoho returned an unsupported Accounts server.', null, 400);
  }
  return origin;
}

function createAuthorizationUrl(state) {
  assertConfigured();
  const accountsUrl = resolveAccountsUrl(config.zoho.accountsUrl);
  const url = new URL('/oauth/v2/auth', accountsUrl);
  url.search = new URLSearchParams({
    scope: config.zoho.scopes.join(','),
    client_id: config.zoho.clientId,
    response_type: 'code',
    access_type: 'offline',
    redirect_uri: config.zoho.redirectUri,
    state,
    prompt: 'consent'
  }).toString();
  return url.toString();
}

async function postTokenRequest(accountsUrl, parameters) {
  const response = await fetch(new URL('/oauth/v2/token', accountsUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    throw new ZohoOAuthError('Zoho rejected the OAuth token request.', payload);
  }
  return payload;
}

function toStoredTokens(payload, accountsUrl, existingRefreshToken = '') {
  if (!payload.access_token) {
    throw new ZohoOAuthError('Zoho returned an incomplete token response.', payload);
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || existingRefreshToken,
    expiresAt: Date.now() + (Number(payload.expires_in || 3600) * 1000),
    apiDomain: payload.api_domain || config.zoho.crmApiUrl,
    accountsUrl,
    scope: payload.scope || config.zoho.scopes.join(','),
    tokenType: payload.token_type || 'Bearer'
  };
}

async function exchangeAuthorizationCode(code, callbackAccountsUrl) {
  assertConfigured();
  const accountsUrl = resolveAccountsUrl(callbackAccountsUrl);
  const payload = await postTokenRequest(accountsUrl, {
    grant_type: 'authorization_code',
    client_id: config.zoho.clientId,
    client_secret: config.zoho.clientSecret,
    redirect_uri: config.zoho.redirectUri,
    code
  });
  return toStoredTokens(payload, accountsUrl);
}

async function refreshAccessToken(tokens) {
  assertConfigured();
  if (!tokens?.refreshToken) {
    throw new ZohoOAuthError('No refresh token is available. Please sign in again.', null, 401);
  }
  const accountsUrl = resolveAccountsUrl(tokens.accountsUrl);
  const payload = await postTokenRequest(accountsUrl, {
    refresh_token: tokens.refreshToken,
    client_id: config.zoho.clientId,
    client_secret: config.zoho.clientSecret,
    grant_type: 'refresh_token'
  });
  return toStoredTokens(payload, accountsUrl, tokens.refreshToken);
}

async function revokeRefreshToken(tokens) {
  if (!tokens?.refreshToken) return;
  assertConfigured();
  const accountsUrl = resolveAccountsUrl(tokens.accountsUrl);
  const url = new URL('/oauth/v2/token/revoke', accountsUrl);
  url.searchParams.set('token', tokens.refreshToken);
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new ZohoOAuthError('Zoho could not revoke the refresh token.', await response.text());
  }
}

module.exports = {
  OAuthConfigurationError,
  ZohoOAuthError,
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeRefreshToken
};
