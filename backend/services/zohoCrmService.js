const { refreshAccessToken } = require('./zohoAuthService');

const API_VERSION = 'v8';
const REFRESH_MARGIN_MS = 60 * 1000;

class ZohoApiError extends Error {
  constructor(message, status, code, details = null) {
    super(message);
    this.name = 'ZohoApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    if (details?.api_name) this.fieldErrors = { [details.api_name]: message };
  }
}

function getSafeZohoMessage(code, status) {
  const messages = {
    MANDATORY_NOT_FOUND: 'A required field is missing.',
    INVALID_DATA: 'One or more field values are invalid.',
    DUPLICATE_DATA: 'A record with the same unique value already exists.',
    NO_PERMISSION: 'You do not have permission to perform this operation.',
    AUTHORIZATION_FAILED: 'You do not have permission to perform this operation.',
    OAUTH_SCOPE_MISMATCH: 'The connected Zoho account has not granted the required permission.',
    INVALID_MODULE: 'This CRM module is unavailable.',
    INVALID_URL_PATTERN: 'The CRM record was not found.',
    RECORD_LOCKED: 'This record is currently locked and cannot be changed.'
  };
  if (messages[code]) return messages[code];
  if (status === 404) return 'The CRM record was not found.';
  if (status === 403) return 'You do not have permission to perform this operation.';
  return status >= 500 ? 'Zoho CRM could not complete the request.' : 'Zoho CRM rejected the request.';
}

function validateApiDomain(value) {
  const url = new URL(value);
  const validHostname = /^(?:www|sandbox|developer)\.zohoapis\.(?:com|eu|in|com\.au|com\.cn|jp|ca|sa)$/.test(url.hostname);
  if (url.protocol !== 'https:' || !validHostname) {
    throw new ZohoApiError('The OAuth session contains an unsupported Zoho API domain.', 401, 'INVALID_API_DOMAIN');
  }
  return url.origin;
}

function mapUpstreamStatus(status) {
  if ([400, 401, 403, 404, 429].includes(status)) return status;
  return status >= 500 ? 502 : 502;
}

class ZohoCrmService {
  constructor(tokens, updateTokens) {
    this.tokens = tokens;
    this.updateTokens = updateTokens;
  }

  async refresh() {
    try {
      this.tokens = await refreshAccessToken(this.tokens);
      await this.updateTokens(this.tokens);
    } catch (error) {
      if (error.details?.error) {
        await this.updateTokens(null);
        throw new ZohoApiError('Your Zoho session has expired. Please sign in again.', 401, 'SESSION_EXPIRED');
      }
      throw error;
    }
  }

  async ensureFreshToken() {
    if (!this.tokens?.accessToken) {
      throw new ZohoApiError('Authentication is required.', 401, 'AUTHENTICATION_REQUIRED');
    }
    if (!this.tokens.expiresAt || this.tokens.expiresAt <= Date.now() + REFRESH_MARGIN_MS) {
      await this.refresh();
    }
  }

  async request(path, query = {}, options = {}, hasRetried = false) {
    await this.ensureFreshToken();
    const url = new URL(`/crm/${API_VERSION}/${path.replace(/^\/+/, '')}`, validateApiDomain(this.tokens.apiDomain));
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const method = options.method || 'GET';
    const headers = {
      Accept: 'application/json',
      Authorization: `Zoho-oauthtoken ${this.tokens.accessToken}`
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      throw new ZohoApiError('Zoho CRM could not be reached.', 502, 'ZOHO_UNAVAILABLE', { cause: error.message });
    }

    if (response.status === 401 && !hasRetried) {
      await this.refresh();
      return this.request(path, query, options, true);
    }
    if (response.status === 204) {
      return { data: [], info: { more_records: false } };
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = payload.code || 'ZOHO_API_ERROR';
      throw new ZohoApiError(
        getSafeZohoMessage(code, response.status),
        mapUpstreamStatus(response.status),
        code,
        payload.details || null
      );
    }
    return payload;
  }
}

module.exports = { getSafeZohoMessage, ZohoApiError, ZohoCrmService, validateApiDomain };
