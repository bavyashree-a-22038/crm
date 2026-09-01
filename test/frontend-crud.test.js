const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

let RecordsController;

function eventTarget() {
  return { addEventListener() {} };
}

function classList() {
  return { add() {}, remove() {}, toggle() {} };
}

before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'records.js'), 'utf8')
    .replace("import { apiRequest } from './api.js';", 'const apiRequest = globalThis.__defaultApiRequest;');
  globalThis.__defaultApiRequest = () => Promise.reject(new Error('Unexpected default request'));
  ({ RecordsController } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
});

after(() => {
  delete globalThis.__defaultApiRequest;
});

test('successful create refreshes the current list only after confirmation', async () => {
  const calls = [];
  const elements = {
    searchForm: eventTarget(), clearSearch: eventTarget(), previousPage: eventTarget(),
    nextPage: eventTarget(), createButton: eventTarget()
  };
  const request = async (requestPath, options) => {
    calls.push({ requestPath, options });
    return { result: { status: 'success' } };
  };
  const controller = new RecordsController(elements, () => {}, {}, request);
  controller.module = { apiName: 'Custom_Module', singularLabel: 'Entry' };
  controller.load = async () => { calls.push({ requestPath: 'list-refresh' }); };
  controller.showStatus = (message) => { calls.push({ requestPath: 'status', message }); };

  await controller.saveMutation('create', null, { Name: 'Confirmed' }, 'Entry created.');

  assert.equal(calls[0].requestPath, '/api/records/Custom_Module');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].requestPath, 'list-refresh');
  assert.deepEqual(calls[2], { requestPath: 'status', message: 'Entry created.' });
});

test('failed delete does not refresh or remove the current list', async () => {
  let refreshed = false;
  const elements = {
    searchForm: eventTarget(), clearSearch: eventTarget(), previousPage: eventTarget(),
    nextPage: eventTarget(), createButton: eventTarget()
  };
  const controller = new RecordsController(elements, () => {}, {}, async () => {
    throw new Error('Delete rejected');
  });
  controller.module = { apiName: 'Accounts' };
  controller.load = async () => { refreshed = true; };

  await assert.rejects(() => controller.deleteMutation('1000000000001', 'Deleted.'), /Delete rejected/);
  assert.equal(refreshed, false);
});

test('record list columns do not replace complete create-form metadata', async () => {
  const elements = {
    searchForm: eventTarget(), clearSearch: { ...eventTarget(), classList: classList() },
    previousPage: eventTarget(), nextPage: eventTarget(),
    createButton: { ...eventTarget(), classList: classList() },
    searchInput: { value: '' }, moduleTitle: { textContent: '' },
    status: { textContent: '', classList: classList() },
    tableWrap: { classList: classList() }, pagination: { classList: classList() },
    recordCount: { textContent: '' }, pageLabel: { textContent: '' }
  };
  elements.searchForm.classList = classList();
  const fullFields = [{ apiName: 'Name' }, { apiName: 'Notes' }, { apiName: 'Industry' }];
  const controller = new RecordsController(elements, () => {}, {}, async () => ({
    fields: [{ apiName: 'Name' }],
    records: [],
    page: { page: 1, count: 0, moreRecords: false }
  }));
  controller.setLoading = () => {};
  controller.render = () => {};

  await controller.selectModule({
    apiName: 'Accounts', pluralLabel: 'Accounts', globalSearchSupported: true,
    permissions: { create: true, edit: true, delete: true }
  }, fullFields);

  assert.deepEqual(controller.fields, [{ apiName: 'Name' }]);
  assert.deepEqual(controller.formFields, fullFields);
});