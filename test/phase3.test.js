const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'phase-three-test-session-secret-value';
process.env.ZOHO_CLIENT_ID = 'test-client-id';
process.env.ZOHO_CLIENT_SECRET = 'test-client-secret';
process.env.ZOHO_REDIRECT_URI = 'http://localhost:3000/api/auth/callback';
process.env.ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.com';
process.env.ZOHO_CRM_API_URL = 'https://www.zohoapis.com';

const nativeFetch = global.fetch;
const { createApp } = require('../backend/server');

const visibleModule = {
  id: 'module-1',
  api_name: 'Accounts',
  singular_label: 'Organization',
  plural_label: 'Organizations',
  sequence_number: 1,
  global_search_supported: true,
  status: 'visible',
  visibility: 1,
  visible: true,
  api_supported: true,
  viewable: true,
  creatable: true,
  editable: true,
  deletable: true
};
const fieldPayload = {
  fields: [
    {
      id: 'field-1', api_name: 'Account_Name', field_label: 'Organization Name',
      data_type: 'text', json_type: 'string', visible: true, display_field: true,
      quick_sequence_number: 1, searchable: true, sortable: true, length: 120,
      system_mandatory: true, operation_type: { api_create: true, api_update: true }
    },
    {
      id: 'field-2', api_name: 'Phone', field_label: 'Main Phone',
      data_type: 'phone', json_type: 'string', visible: true,
      quick_sequence_number: 2, searchable: true, sortable: false,
      operation_type: { api_create: true, api_update: true }
    },
    {
      id: 'field-3', api_name: 'Annual_Revenue', field_label: 'Annual Revenue',
      data_type: 'currency', json_type: 'double', visible: true,
      quick_sequence_number: 3, decimal_place: 2,
      operation_type: { api_create: true, api_update: true }
    },
    {
      id: 'field-4', api_name: 'Industry', field_label: 'Industry',
      data_type: 'picklist', json_type: 'string', visible: true,
      quick_sequence_number: 4, operation_type: { api_create: true, api_update: true },
      pick_list_values: [
        { id: 'option-1', actual_value: 'Technology', display_value: 'Technology', type: 'used' },
        { id: 'option-2', actual_value: 'Unused', display_value: 'Unused', type: 'unused' }
      ]
    },
    {
      id: 'field-5', api_name: 'Created_Time', field_label: 'Created Time',
      data_type: 'datetime', json_type: 'string', visible: true, read_only: true,
      quick_sequence_number: 5, operation_type: { api_create: false, api_update: false }
    },
    {
      id: 'field-6', api_name: 'Private_Field', field_label: 'Private Field',
      data_type: 'text', json_type: 'string', visible: false
    }
  ]
};

let app;
let server;
let baseUrl;
let authCookie;
let failModules = false;
let rejectAccessTokenOnce = false;
let refreshRequestCount = 0;
let revokeRequestCount = 0;
let lastRecordsUrl;
let lastMutation;
let moduleCapabilityOverrides = {};
let mutationFailure = null;
let recordMissing = false;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function zohoFetch(url, options = {}) {
  const requestUrl = new URL(url);
  if (requestUrl.hostname === 'accounts.zoho.com' && requestUrl.pathname === '/oauth/v2/token') {
    const body = new URLSearchParams(options.body);
    assert.ok(['authorization_code', 'refresh_token'].includes(body.get('grant_type')));
    if (body.get('grant_type') === 'refresh_token') refreshRequestCount += 1;
    return Promise.resolve(jsonResponse({
      access_token: 'test-access-token',
      refresh_token: body.get('grant_type') === 'authorization_code' ? 'test-refresh-token' : undefined,
      api_domain: 'https://www.zohoapis.com',
      expires_in: 3600,
      token_type: 'Bearer'
    }));
  }
  if (requestUrl.hostname === 'accounts.zoho.com' && requestUrl.pathname === '/oauth/v2/token/revoke') {
    assert.equal(options.method, 'POST');
    assert.equal(requestUrl.searchParams.get('token'), 'test-refresh-token');
    assert.equal(options.headers, undefined);
    assert.equal(options.body, undefined);
    revokeRequestCount += 1;
    return Promise.resolve(new Response(null, { status: 200 }));
  }

  if (requestUrl.hostname !== 'www.zohoapis.com') {
    return nativeFetch(url, options);
  }

  assert.equal(options.headers.Authorization, 'Zoho-oauthtoken test-access-token');
  if (rejectAccessTokenOnce) {
    rejectAccessTokenOnce = false;
    return Promise.resolve(jsonResponse({ code: 'INVALID_TOKEN', message: 'Invalid OAuth token' }, 401));
  }
  if (requestUrl.pathname === '/crm/v8/settings/modules') {
    if (failModules) {
      return Promise.resolve(jsonResponse({ code: 'INTERNAL_ERROR', message: 'CRM unavailable' }, 500));
    }
    return Promise.resolve(jsonResponse({
      modules: [
        { ...visibleModule, ...moduleCapabilityOverrides },
        { ...visibleModule, id: 'module-2', api_name: 'Hidden', status: 'user_hidden', visibility: 0 },
        { ...visibleModule, id: 'module-3', api_name: 'Feeds', api_supported: false }
      ]
    }));
  }
  if (requestUrl.pathname === '/crm/v8/users') {
    assert.equal(requestUrl.searchParams.get('type'), 'CurrentUser');
    return Promise.resolve(jsonResponse({
      users: [{
        id: 'crm-user-1',
        zuid: 'zoho-user-1',
        full_name: 'Test User',
        first_name: 'Test',
        last_name: 'User',
        email: 'test@example.com',
        status: 'active',
        role: { id: 'role-1', name: 'Manager', internal_only: 'excluded' },
        profile: { id: 'profile-1', name: 'Standard', internal_only: 'excluded' },
        locale: 'en_US',
        time_zone: 'UTC',
        signature: 'excluded'
      }]
    }));
  }
  if (requestUrl.pathname === '/crm/v8/settings/modules/Accounts') {
    return Promise.resolve(jsonResponse({ modules: [{ ...visibleModule, ...moduleCapabilityOverrides }] }));
  }
  if (requestUrl.pathname === '/crm/v8/settings/fields') {
    assert.equal(requestUrl.searchParams.get('module'), 'Accounts');
    return Promise.resolve(jsonResponse(fieldPayload));
  }
  if (requestUrl.pathname === '/crm/v8/Accounts/search') {
    assert.equal(requestUrl.searchParams.get('word'), 'acme');
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  if (requestUrl.pathname === '/crm/v8/Accounts/1000000000001') {
    if (recordMissing && (options.method || 'GET') === 'GET') {
      return Promise.resolve(jsonResponse({ code: 'INVALID_URL_PATTERN', message: 'Raw upstream detail' }, 404));
    }
    if (mutationFailure) return Promise.resolve(jsonResponse(mutationFailure.payload, mutationFailure.status));
    if ((options.method || 'GET') === 'GET') {
      return Promise.resolve(jsonResponse({
        data: [{
          id: '1000000000001', Account_Name: 'Test Fixture Organization',
          Phone: '555-0100', Annual_Revenue: 1250.5, Industry: 'Technology',
          Created_Time: '2026-08-31T10:00:00+00:00', Hidden_Internal: 'excluded'
        }]
      }));
    }
    lastMutation = {
      method: options.method,
      body: options.body ? JSON.parse(options.body) : null
    };
    return Promise.resolve(jsonResponse({
      data: [{ status: 'success', code: 'SUCCESS', message: 'record changed', details: { id: '1000000000001' } }]
    }));
  }
  if (requestUrl.pathname === '/crm/v8/Accounts') {
    if ((options.method || 'GET') === 'POST') {
      if (mutationFailure) return Promise.resolve(jsonResponse(mutationFailure.payload, mutationFailure.status));
      lastMutation = { method: options.method, body: JSON.parse(options.body) };
      return Promise.resolve(jsonResponse({
        data: [{ status: 'success', code: 'SUCCESS', message: 'record added', details: { id: '1000000000001' } }]
      }, 201));
    }
    lastRecordsUrl = requestUrl;
    const pageToken = requestUrl.searchParams.get('page_token');
    return Promise.resolve(jsonResponse({
      data: [{
        id: 'record-test-1', Account_Name: 'Test Fixture Organization', Phone: '555-0100',
        Annual_Revenue: 1250.5, Industry: 'Technology', Created_Time: '2026-08-31T10:00:00+00:00'
      }],
      info: {
        page: pageToken ? 11 : Number(requestUrl.searchParams.get('page')),
        per_page: Number(requestUrl.searchParams.get('per_page')),
        count: 1,
        more_records: !pageToken,
        next_page_token: pageToken ? null : 'next-test-token'
      }
    }));
  }
  return Promise.resolve(jsonResponse({ code: 'INVALID_URL_PATTERN', message: 'Not found' }, 404));
}

async function authenticate() {
  const loginResponse = await nativeFetch(`${baseUrl}/api/auth/login`, { redirect: 'manual' });
  const loginCookie = loginResponse.headers.get('set-cookie').split(';')[0];
  const state = new URL(loginResponse.headers.get('location')).searchParams.get('state');
  const callbackUrl = new URL('/api/auth/callback', baseUrl);
  callbackUrl.searchParams.set('code', 'test-grant-code');
  callbackUrl.searchParams.set('state', state);
  callbackUrl.searchParams.set('accounts-server', 'https://accounts.zoho.com');
  const callbackResponse = await nativeFetch(callbackUrl, {
    headers: { Cookie: loginCookie },
    redirect: 'manual'
  });
  assert.equal(callbackResponse.status, 302);
  return callbackResponse.headers.get('set-cookie').split(';')[0];
}

before(async () => {
  global.fetch = zohoFetch;
  app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  authCookie = await authenticate();
});

after(async () => {
  global.fetch = nativeFetch;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await app.locals.closeResources();
});

test('modules endpoint requires authentication', async () => {
  const response = await nativeFetch(`${baseUrl}/api/modules`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'AUTHENTICATION_REQUIRED');
});

test('analytics endpoint requires authentication', async () => {
  const response = await nativeFetch(`${baseUrl}/api/analytics/Accounts`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'AUTHENTICATION_REQUIRED');
});

test('me endpoint returns allowlisted current-user data without OAuth tokens', async () => {
  const response = await nativeFetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: authCookie } });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.authenticated, true);
  assert.equal(payload.user.fullName, 'Test User');
  assert.equal(payload.user.email, 'test@example.com');
  assert.deepEqual(payload.user.role, { id: 'role-1', name: 'Manager' });
  assert.equal(JSON.stringify(payload).includes('token'), false);
  assert.equal(JSON.stringify(payload).includes('signature'), false);
  assert.equal(JSON.stringify(payload).includes('internal_only'), false);
});

test('modules endpoint returns only visible and accessible API modules', async () => {
  const response = await nativeFetch(`${baseUrl}/api/modules`, { headers: { Cookie: authCookie } });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.modules.map((module) => module.apiName), ['Accounts']);
  assert.equal(payload.modules[0].pluralLabel, 'Organizations');
});

test('expired access token is refreshed and the CRM request is retried', async () => {
  rejectAccessTokenOnce = true;
  const previousRefreshCount = refreshRequestCount;
  const response = await nativeFetch(`${baseUrl}/api/modules`, { headers: { Cookie: authCookie } });

  assert.equal(response.status, 200);
  assert.equal(refreshRequestCount, previousRefreshCount + 1);
  assert.equal((await response.json()).modules.length, 1);
});

test('module metadata and visible fields are retrieved dynamically', async () => {
  const metadataResponse = await nativeFetch(`${baseUrl}/api/modules/Accounts`, { headers: { Cookie: authCookie } });
  const fieldsResponse = await nativeFetch(`${baseUrl}/api/modules/Accounts/fields`, { headers: { Cookie: authCookie } });
  const metadata = await metadataResponse.json();
  const fields = await fieldsResponse.json();

  assert.equal(metadata.module.apiName, 'Accounts');
  assert.equal(metadata.module.globalSearchSupported, true);
  assert.deepEqual(fields.fields.map((field) => field.apiName), [
    'Account_Name', 'Phone', 'Annual_Revenue', 'Industry', 'Created_Time'
  ]);
  assert.equal(fields.fields[0].required, true);
  assert.equal(fields.fields[0].creatable, true);
  assert.equal(fields.fields[2].inputType, 'number');
  assert.deepEqual(fields.fields[3].picklistOptions.map((option) => option.value), ['Technology']);
  assert.equal(fields.fields[4].readOnly, true);
});

test('analytics endpoint summarizes module metadata and a bounded record sample', async () => {
  const response = await nativeFetch(`${baseUrl}/api/analytics/Accounts`, {
    headers: { Cookie: authCookie }
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.module.apiName, 'Accounts');
  assert.equal(payload.metrics.sampledRecords, 1);
  assert.equal(payload.metrics.populatedRecords, 1);
  assert.equal(typeof payload.metrics.recentRecords, 'number');
  assert.equal(payload.sample.limit, 200);
  assert.equal(payload.sample.partial, true);
  assert.equal(lastRecordsUrl.searchParams.get('per_page'), '200');
  assert.equal(lastRecordsUrl.searchParams.get('fields'), 'Created_Time,Account_Name,Phone,Annual_Revenue,Industry');
  assert.deepEqual(payload.picklistDistribution.values, [{ label: 'Technology', count: 1 }]);
  assert.equal(payload.numericSummary.field, 'Annual Revenue');
  assert.equal(payload.numericSummary.total, 1250.5);
});

test('records endpoint uses metadata fields and documented pagination parameters', async () => {
  const response = await nativeFetch(`${baseUrl}/api/records/Accounts?page=2&per_page=50`, {
    headers: { Cookie: authCookie }
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.records[0].Account_Name, 'Test Fixture Organization');
  assert.equal(payload.page.page, 2);
  assert.equal(payload.page.moreRecords, true);
  assert.equal(lastRecordsUrl.searchParams.get('fields'), 'Account_Name,Phone,Annual_Revenue,Industry,Created_Time');
  assert.equal(lastRecordsUrl.searchParams.get('page'), '2');
});

test('records endpoint forwards page tokens without a page parameter', async () => {
  const response = await nativeFetch(`${baseUrl}/api/records/Accounts?page_token=next-test-token&per_page=50`, {
    headers: { Cookie: authCookie }
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.page.page, 11);
  assert.equal(lastRecordsUrl.searchParams.get('page_token'), 'next-test-token');
  assert.equal(lastRecordsUrl.searchParams.has('page'), false);
});

test('search uses Zoho word search and handles no-content results', async () => {
  const response = await nativeFetch(`${baseUrl}/api/records/Accounts/search?word=acme&page=1&per_page=50`, {
    headers: { Cookie: authCookie }
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.records, []);
  assert.equal(payload.page.moreRecords, false);
});

test('single-record endpoint returns only fields allowed by metadata', async () => {
  const response = await nativeFetch(`${baseUrl}/api/records/Accounts/1000000000001`, {
    headers: { Cookie: authCookie }
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.record.Account_Name, 'Test Fixture Organization');
  assert.equal(payload.record.Hidden_Internal, undefined);
  assert.equal(payload.fields[0].required, true);
});

test('create validates and sends one metadata-allowlisted record', async () => {
  const response = await nativeFetch(`${baseUrl}/api/records/Accounts`, {
    method: 'POST',
    headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { Account_Name: 'New Organization', Annual_Revenue: 500, Industry: 'Technology' } })
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.result.id, '1000000000001');
  assert.equal(lastMutation.method, 'POST');
  assert.deepEqual(lastMutation.body.data, [{
    Account_Name: 'New Organization', Annual_Revenue: 500, Industry: 'Technology'
  }]);
});

test('update validates and sends editable fields only', async () => {
  const response = await nativeFetch(`${baseUrl}/api/records/Accounts/1000000000001`, {
    method: 'PUT',
    headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { Annual_Revenue: 900 } })
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.status, 'success');
  assert.equal(lastMutation.method, 'PUT');
  assert.deepEqual(lastMutation.body.data, [{ Annual_Revenue: 900 }]);
});

test('delete waits for Zoho success', async () => {
  const response = await nativeFetch(`${baseUrl}/api/records/Accounts/1000000000001`, {
    method: 'DELETE', headers: { Cookie: authCookie }
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.status, 'success');
  assert.equal(lastMutation.method, 'DELETE');
});

test('module capability rejects an unsupported operation before mutation', async () => {
  moduleCapabilityOverrides = { creatable: false };
  try {
    const response = await nativeFetch(`${baseUrl}/api/records/Accounts`, {
      method: 'POST',
      headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { Account_Name: 'Blocked' } })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'MODULE_OPERATION_NOT_ALLOWED');
  } finally {
    moduleCapabilityOverrides = {};
  }
});

test('invalid and read-only fields are rejected without forwarding them', async () => {
  for (const data of [{ Unknown_Field: 'value' }, { Created_Time: '2026-08-31T10:00' }]) {
    const response = await nativeFetch(`${baseUrl}/api/records/Accounts/1000000000001`, {
      method: 'PUT',
      headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.code, 'INVALID_RECORD_FIELDS');
    assert.ok(payload.fieldErrors[Object.keys(data)[0]]);
  }
});

test('create requires system-mandatory metadata fields', async () => {
  const response = await nativeFetch(`${baseUrl}/api/records/Accounts`, {
    method: 'POST',
    headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { Phone: '555-0101' } })
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.fieldErrors.Account_Name, 'This field is required.');
});

test('Zoho field validation errors are normalized for the frontend', async () => {
  mutationFailure = {
    status: 400,
    payload: { code: 'INVALID_DATA', message: 'Raw upstream detail', details: { api_name: 'Annual_Revenue' } }
  };
  try {
    const response = await nativeFetch(`${baseUrl}/api/records/Accounts/1000000000001`, {
      method: 'PUT',
      headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { Annual_Revenue: 500 } })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error, 'One or more field values are invalid.');
    assert.equal(payload.fieldErrors.Annual_Revenue, 'One or more field values are invalid.');
    assert.equal(JSON.stringify(payload).includes('Raw upstream detail'), false);
  } finally {
    mutationFailure = null;
  }
});

test('single-record endpoint normalizes record-not-found errors', async () => {
  recordMissing = true;
  try {
    const response = await nativeFetch(`${baseUrl}/api/records/Accounts/1000000000001`, {
      headers: { Cookie: authCookie }
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'The CRM record was not found.');
  } finally {
    recordMissing = false;
  }
});

test('Zoho permission errors are normalized', async () => {
  mutationFailure = { status: 403, payload: { code: 'NO_PERMISSION', message: 'Raw permission detail' } };
  try {
    const response = await nativeFetch(`${baseUrl}/api/records/Accounts/1000000000001`, {
      method: 'DELETE', headers: { Cookie: authCookie }
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'You do not have permission to perform this operation.');
  } finally {
    mutationFailure = null;
  }
});

test('a mutation is retried with its method and body after token refresh', async () => {
  rejectAccessTokenOnce = true;
  const previousRefreshCount = refreshRequestCount;
  const response = await nativeFetch(`${baseUrl}/api/records/Accounts/1000000000001`, {
    method: 'PUT',
    headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { Annual_Revenue: 750 } })
  });

  assert.equal(response.status, 200);
  assert.equal(refreshRequestCount, previousRefreshCount + 1);
  assert.equal(lastMutation.method, 'PUT');
  assert.deepEqual(lastMutation.body.data, [{ Annual_Revenue: 750 }]);
});

test('Zoho API failures return a stable backend error without crashing', async () => {
  failModules = true;
  try {
    const response = await nativeFetch(`${baseUrl}/api/modules`, { headers: { Cookie: authCookie } });
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.equal(payload.code, 'INTERNAL_ERROR');
    assert.equal((await nativeFetch(`${baseUrl}/api/health`)).status, 200);
  } finally {
    failModules = false;
  }
});

test('logout revokes the refresh token and destroys only that user session', async () => {
  const logoutCookie = await authenticate();
  const previousRevokeCount = revokeRequestCount;
  const logoutResponse = await nativeFetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: logoutCookie }
  });
  const meResponse = await nativeFetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: logoutCookie }
  });

  assert.equal(logoutResponse.status, 204);
  assert.equal(revokeRequestCount, previousRevokeCount + 1);
  assert.equal((await meResponse.json()).authenticated, false);
});
