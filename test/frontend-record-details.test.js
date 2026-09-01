const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

let RecordDetails;
let RecordsController;

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.textContent = '';
    this.className = '';
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
      contains: (name) => this.classes.has(name)
    };
  }

  addEventListener(name, handler) {
    this.listeners[name] ||= [];
    this.listeners[name].push(handler);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

function controllerElements() {
  const passive = () => ({ addEventListener() {} });
  return {
    searchForm: passive(), clearSearch: new FakeElement('button'), previousPage: passive(), nextPage: passive(),
    createButton: passive(), head: new FakeElement('tr'), body: new FakeElement('tbody'),
    recordCount: new FakeElement(), status: new FakeElement(), tableWrap: new FakeElement(),
    pagination: new FakeElement(), pageLabel: new FakeElement()
  };
}

before(async () => {
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const recordsSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'records.js'), 'utf8')
    .replace("import { apiRequest } from './api.js';", 'const apiRequest = () => {};');
  const detailsSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'recordDetails.js'), 'utf8');
  ({ RecordsController } = await import(`data:text/javascript;base64,${Buffer.from(recordsSource).toString('base64')}`));
  ({ RecordDetails } = await import(`data:text/javascript;base64,${Buffer.from(detailsSource).toString('base64')}`));
});

after(() => {
  delete global.document;
});

test('record rows open details while action cells isolate their clicks', () => {
  const calls = [];
  const elements = controllerElements();
  const record = { id: '1000000000001', Name: 'Acme' };
  const controller = new RecordsController(elements, () => {}, {
    onOpen: () => calls.push('open'),
    onEdit: () => calls.push('edit')
  });
  controller.module = {
    singularLabel: 'Account',
    permissions: { edit: true, delete: false }
  };
  controller.fields = [{ apiName: 'Name', label: 'Name' }];
  controller.resultPage = { count: 1, page: 1, moreRecords: false };

  controller.render([record]);
  const row = elements.body.children[0];
  row.listeners.click[0]();
  assert.deepEqual(calls, ['open']);
  assert.equal(row.attributes.role, 'link');
  assert.equal(row.tabIndex, 0);

  let propagationStopped = false;
  const actionCell = row.children.at(-1);
  actionCell.listeners.click[0]({ stopPropagation: () => { propagationStopped = true; } });
  actionCell.children[0].listeners.click[0]();
  assert.equal(propagationStopped, true);
  assert.deepEqual(calls, ['open', 'edit']);
});

test('record details render metadata fields and expose edit when permitted', () => {
  const elements = {
    title: new FakeElement(), status: new FakeElement(), fields: new FakeElement(),
    edit: new FakeElement('button'), close: new FakeElement('button')
  };
  const details = new RecordDetails(elements, { onClose() {}, onEdit() {} });
  details.render({
    module: { singularLabel: 'Account', permissions: { edit: true } },
    fields: [
      { apiName: 'Name', label: 'Account name', displayField: true },
      { apiName: 'Phone', label: 'Phone' },
      { apiName: 'Created_Time', label: 'Created time', readOnly: true }
    ],
    record: { id: '1000000000001', Name: 'Acme', Phone: null, Created_Time: '2026-08-31' }
  });

  assert.equal(elements.title.textContent, 'Acme');
  assert.equal(elements.fields.children.length, 2);
  assert.equal(elements.fields.children[0].children[0].textContent, 'Highlights');
  const highlightFields = elements.fields.children[0].children[1];
  assert.equal(highlightFields.children[1].children[1].textContent, 'Not set');
  assert.equal(elements.fields.children[1].children[0].textContent, 'System information');
  assert.equal(elements.edit.classList.contains('hidden'), false);
});