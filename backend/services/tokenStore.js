const session = require('express-session');
const { AsyncLocalStorage } = require('node:async_hooks');
const catalyst = require('zcatalyst-sdk-node');

const DEFAULT_SESSION_TABLE = 'MiniCrmSessions';
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const requestContext = new AsyncLocalStorage();

function withCatalystRequestContext(request, response, next) {
  requestContext.run(request, next);
}

class CatalystSessionStore extends session.Store {
  constructor(catalystApp, tableName = DEFAULT_SESSION_TABLE) {
    super();
    if (!TABLE_NAME_PATTERN.test(tableName)) {
      throw new Error('SESSION_TABLE must be a valid Catalyst table name.');
    }
    this.tableName = tableName;
    this.getCatalystApp = typeof catalystApp === 'function' ? catalystApp : () => catalystApp;
  }

  get(sessionId, callback) {
    this.findRow(sessionId)
      .then(async (row) => {
        if (!row) return null;
        const expiresAt = Number(row.EXPIRES_AT);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          await this.getTable().deleteRow(row.ROWID);
          return null;
        }
        try {
          return JSON.parse(row.SESSION_DATA);
        } catch {
          await this.getTable().deleteRow(row.ROWID);
          return null;
        }
      })
      .then((storedSession) => callback(null, storedSession))
      .catch(callback);
  }

  set(sessionId, storedSession, callback = () => {}) {
    this.upsertRow(sessionId, storedSession)
      .then(() => callback())
      .catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    this.findRow(sessionId)
      .then((row) => row ? this.getTable().deleteRow(row.ROWID) : undefined)
      .then(() => callback())
      .catch(callback);
  }

  touch(sessionId, storedSession, callback = () => {}) {
    this.set(sessionId, storedSession, callback);
  }

  async findRow(sessionId) {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      throw new Error('Invalid session identifier.');
    }
    const result = await this.getCatalystApp().zcql().executeZCQLQuery(
      `SELECT * FROM ${this.tableName} WHERE SESSION_ID = '${sessionId}'`
    );
    return result[0]?.[this.tableName] || null;
  }

  async upsertRow(sessionId, storedSession) {
    const existingRow = await this.findRow(sessionId);
    const table = this.getTable();
    const expiresAt = storedSession.cookie?.expires
      ? new Date(storedSession.cookie.expires).getTime()
      : Date.now() + DEFAULT_SESSION_TTL_MS;
    const row = {
      SESSION_ID: sessionId,
      SESSION_DATA: JSON.stringify(storedSession),
      EXPIRES_AT: expiresAt
    };

    if (existingRow) {
      await table.updateRow({ ...row, ROWID: existingRow.ROWID });
      return;
    }
    try {
      await table.insertRow(row);
    } catch (insertError) {
      const concurrentlyInsertedRow = await this.findRow(sessionId);
      if (!concurrentlyInsertedRow) throw insertError;
      await table.updateRow({ ...row, ROWID: concurrentlyInsertedRow.ROWID });
    }
  }

  getTable() {
    return this.getCatalystApp().datastore().table(this.tableName);
  }
}

async function createSessionStore({ nodeEnv, tableName, catalystApp } = {}) {
  if (nodeEnv !== 'production') {
    return {
      store: new session.MemoryStore(),
      close: async () => {}
    };
  }

  const getCatalystApp = catalystApp
    ? () => catalystApp
    : () => {
        const request = requestContext.getStore();
        if (!request) throw new Error('Catalyst session access requires an active AppSail request.');
        return catalyst.initialize(request, { scope: 'admin' });
      };
  return {
    store: new CatalystSessionStore(getCatalystApp, tableName),
    close: async () => {}
  };
}

module.exports = { CatalystSessionStore, createSessionStore, withCatalystRequestContext };
