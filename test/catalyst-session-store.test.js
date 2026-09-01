const assert = require('node:assert/strict');
const { test } = require('node:test');

const { CatalystSessionStore, createSessionStore } = require('../backend/services/tokenStore');

function createFakeCatalystApp() {
  const rows = [];
  let nextRowId = 1;
  const table = {
    async insertRow(row) {
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

test('session store factory uses Catalyst only in production', async () => {
  const catalystApp = createFakeCatalystApp();
  const productionStore = await createSessionStore({ nodeEnv: 'production', catalystApp });
  const developmentStore = await createSessionStore({ nodeEnv: 'development' });

  assert.ok(productionStore.store instanceof CatalystSessionStore);
  assert.equal(developmentStore.store.constructor.name, 'MemoryStore');
});