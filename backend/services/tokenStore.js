const session = require('express-session');
const catalyst = require('zcatalyst-sdk-node');

const DEFAULT_SESSION_TABLE = 'MiniCrmSessions';
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

class CatalystSessionStore extends session.Store {
  constructor(catalystApp, tableName = DEFAULT_SESSION_TABLE) {
    super();
    if (!TABLE_NAME_PATTERN.test(tableName)) {
      throw new Error('SESSION_TABLE must be a valid Catalyst table name.');
    }
    this.tableName = tableName;
    this.table = catalystApp.datastore().table(tableName);
    this.zcql = catalystApp.zcql();
  }

  get(sessionId, callback) {
    this.findRow(sessionId)
      .then(async (row) => {
        if (!row) return null;
        if (Number(row.EXPIRES_AT) <= Date.now()) {
          await this.table.deleteRow(row.ROWID);
          return null;
        }
        return JSON.parse(row.SESSION_DATA);
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
      .then((row) => row ? this.table.deleteRow(row.ROWID) : undefined)
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
    const result = await this.zcql.executeZCQLQuery(
      `SELECT * FROM ${this.tableName} WHERE SESSION_ID = '${sessionId}' LIMIT 1`
    );
    return result[0]?.[this.tableName] || null;
  }

  async upsertRow(sessionId, storedSession) {
    const existingRow = await this.findRow(sessionId);
    const expiresAt = storedSession.cookie?.expires
      ? new Date(storedSession.cookie.expires).getTime()
      : Date.now() + 24 * 60 * 60 * 1000;
    const row = {
      SESSION_ID: sessionId,
      SESSION_DATA: JSON.stringify(storedSession),
      EXPIRES_AT: expiresAt
    };

    if (existingRow) {
      await this.table.updateRow({ ...row, ROWID: existingRow.ROWID });
      return;
    }
    await this.table.insertRow(row);
  }
}

async function createSessionStore({ nodeEnv, tableName, catalystApp } = {}) {
  if (nodeEnv !== 'production') {
    return {
      store: new session.MemoryStore(),
      close: async () => {}
    };
  }

  const app = catalystApp || catalyst.initializeApp({});
  return {
    store: new CatalystSessionStore(app, tableName),
    close: async () => {}
  };
}

module.exports = { CatalystSessionStore, createSessionStore };
