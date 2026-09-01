const DEFAULT_ACCOUNTS_URL = 'https://accounts.zoho.com';
const DEFAULT_CRM_API_URL = 'https://www.zohoapis.com';
const nodeEnv = process.env.APP_ENV || process.env.NODE_ENV || 'development';

function normalizeUrl(value, fallback) {
  const url = new URL(value || fallback);
  return url.origin;
}

const config = {
  nodeEnv,
  port: Number.parseInt(
    process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || (nodeEnv === 'production' ? '9000' : '3000'),
    10
  ),
  trustProxy: process.env.TRUST_PROXY === 'true',
  sessionSecret: process.env.SESSION_SECRET || 'local-development-only-change-me',
  catalystSessionTable: process.env.SESSION_TABLE || 'MiniCrmSessions',
  zoho: {
    clientId: process.env.ZOHO_CLIENT_ID || '',
    clientSecret: process.env.ZOHO_CLIENT_SECRET || '',
    redirectUri: process.env.ZOHO_REDIRECT_URI || '',
    accountsUrl: normalizeUrl(process.env.ZOHO_ACCOUNTS_URL, DEFAULT_ACCOUNTS_URL),
    crmApiUrl: normalizeUrl(process.env.ZOHO_CRM_API_URL, DEFAULT_CRM_API_URL),
    scopes: (process.env.ZOHO_OAUTH_SCOPES || [
      'ZohoCRM.modules.ALL',
      'ZohoCRM.settings.ALL',
      'ZohoCRM.users.READ',
      'ZohoCRM.coql.READ',
      'ZohoSearch.securesearch.READ'
    ].join(',')).split(',').map((scope) => scope.trim()).filter(Boolean)
  }
};

function validateRuntimeConfig() {
  if (!Number.isInteger(config.port) || config.port < 1) {
    throw new Error('PORT must be a positive integer.');
  }

  if (config.nodeEnv === 'production') {
    if (!process.env.SESSION_SECRET || config.sessionSecret.length < 32) {
      throw new Error('Production requires SESSION_SECRET with at least 32 characters.');
    }
  }
}

function getMissingZohoConfig() {
  const required = {
    ZOHO_CLIENT_ID: config.zoho.clientId,
    ZOHO_CLIENT_SECRET: config.zoho.clientSecret,
    ZOHO_REDIRECT_URI: config.zoho.redirectUri
  };

  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

module.exports = { config, getMissingZohoConfig, validateRuntimeConfig };
