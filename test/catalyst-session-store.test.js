const assert = require('node:assert/strict');
const { test } = require('node:test');
const catalyst = require('zcatalyst-sdk-node');

const {
  CatalystSessionStore,
  createSessionStore,
  withCatalystRequestContext
} = require('../backend/services/tokenStore');

function createFakeCatalystApp() {
  const rows = [];
  let nextRowId = 1;
  const table = {
    async insertRow(row) {
      await Promise.resolve();
      if (rows.some(({ SESSION_ID }) => SESSION_ID === row.SESSION_ID)) {
        throw new Error('Duplicate SESSION_ID');
      }
      const storedRow = { ...row, ROWID: String(nextRowId++) };
      rows.push(storedRow);
      return storedRow;
    },
    async updateRow(row) {
      const index = rows.findIndex(({ ROWID }) => ROWID === row.ROWID);
      rows[index] = { ...row };
      return rows[index];
    },
    async deleteRow(rowId) {
      const index = rows.findIndex(({ ROWID }) => ROWID === rowId);
      if (index >= 0) rows.splice(index, 1);
      return index >= 0;
    }
  };

  return {
    rows,
    datastore() {
      return { table: () => table };
    },
    zcql() {
      return {
        async executeZCQLQuery(query) {
          assert.match(query, /LIMIT 0, 1$/);
          const sessionId = query.match(/SESSION_ID = '([^']+)'/)?.[1];
          const row = rows.find(({ SESSION_ID }) => SESSION_ID === sessionId);
          return row ? [{ MiniCrmSessions: row }] : [];
        }
      };
    }
  };
}

function callStore(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });
}

test('Catalyst session store inserts, reads, updates, and destroys sessions', async () => {
  const catalystApp = createFakeCatalystApp();
  const store = new CatalystSessionStore(catalystApp);
  const sessionId = 'safe_session-id';
  const firstSession = {
    cookie: { expires: new Date(Date.now() + 60_000).toISOString() },
    oauthState: { value: 'state' }
  };

  await callStore(store, 'set', sessionId, firstSession);
  assert.equal(catalystApp.rows.length, 1);
  assert.deepEqual(await callStore(store, 'get', sessionId), firstSession);

  const updatedSession = { ...firstSession, oauth: { accessToken: 'token' } };
  await callStore(store, 'touch', sessionId, updatedSession);
  assert.equal(catalystApp.rows.length, 1);
  assert.deepEqual(await callStore(store, 'get', sessionId), updatedSession);

  await callStore(store, 'destroy', sessionId);
  assert.equal(await callStore(store, 'get', sessionId), null);
});

test('Catalyst session store deletes expired sessions', async () => {
  const catalystApp = createFakeCatalystApp();
  const store = new CatalystSessionStore(catalystApp);

  await callStore(store, 'set', 'expired-session', {
    cookie: { expires: new Date(Date.now() - 1_000).toISOString() }
  });

  assert.equal(await callStore(store, 'get', 'expired-session'), null);
  assert.equal(catalystApp.rows.length, 0);
});

test('Catalyst session store deletes corrupted sessions', async () => {
  const catalystApp = createFakeCatalystApp();
  const store = new CatalystSessionStore(catalystApp);
  catalystApp.rows.push({
    ROWID: 'corrupt-row',
    SESSION_ID: 'corrupt-session',
    SESSION_DATA: '{invalid-json',
    EXPIRES_AT: Date.now() + 60_000
  });

  assert.equal(await callStore(store, 'get', 'corrupt-session'), null);
  assert.equal(catalystApp.rows.length, 0);
});

test('Catalyst session store resolves concurrent inserts using the unique session ID', async () => {
  const catalystApp = createFakeCatalystApp();
  const store = new CatalystSessionStore(catalystApp);
  const expires = new Date(Date.now() + 60_000).toISOString();

  await Promise.all([
    callStore(store, 'set', 'concurrent-session', { cookie: { expires }, value: 'first' }),
    callStore(store, 'set', 'concurrent-session', { cookie: { expires }, value: 'second' })
  ]);

  assert.equal(catalystApp.rows.length, 1);
  assert.equal(catalystApp.rows[0].SESSION_ID, 'concurrent-session');
});

test('session store factory uses Catalyst only in production', async () => {
  const catalystApp = createFakeCatalystApp();
  const productionStore = await createSessionStore({ nodeEnv: 'production', catalystApp });
  const developmentStore = await createSessionStore({ nodeEnv: 'development' });

  assert.ok(productionStore.store instanceof CatalystSessionStore);
  assert.equal(developmentStore.store.constructor.name, 'MemoryStore');
});

test('production sessions initialize Catalyst from the active AppSail request', async () => {
  const catalystApp = createFakeCatalystApp();
  const originalInitialize = catalyst.initialize;
  const request = { headers: { 'x-zc-projectid': 'project-id' } };
  catalyst.initialize = (activeRequest, options) => {
    assert.equal(activeRequest, request);
    assert.deepEqual(options, { scope: 'admin' });
    return catalystApp;
  };

  try {
    const { store } = await createSessionStore({ nodeEnv: 'production' });
    await new Promise((resolve, reject) => {
      withCatalystRequestContext(request, {}, () => {
        callStore(store, 'set', 'request-session', {
          cookie: { expires: new Date(Date.now() + 60_000).toISOString() }
        }).then(resolve, reject);
      });
    });
    assert.equal(catalystApp.rows.length, 1);
  } finally {
    catalyst.initialize = originalInitialize;
  }
});