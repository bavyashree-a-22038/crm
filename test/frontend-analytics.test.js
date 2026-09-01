const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

let AnalyticsDashboard;

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
      contains: (name) => this.classes.has(name)
    };
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  append(...children) {
    this.children.push(...children);
    if (this.tagName === 'SELECT' && !this.value && children[0]) this.value = children[0].value;
  }

  replaceChildren(...children) {
    this.children = children;
    if (this.tagName === 'SELECT') this.value = children[0]?.value || '';
  }
}

function createElements() {
  return {
    moduleSelect: new FakeElement('select'), refresh: new FakeElement('button'),
    title: new FakeElement(), empty: new FakeElement(), status: new FakeElement(),
    content: new FakeElement(), sampledRecords: new FakeElement(), completeness: new FakeElement(),
    recentRecords: new FakeElement(), populatedRecords: new FakeElement(), creationTrend: new FakeElement(),
    numericPanel: new FakeElement(), numericTitle: new FakeElement(), numericTotal: new FakeElement(),
    numericAverage: new FakeElement(), numericRange: new FakeElement(),
    picklistPanel: new FakeElement(), picklistTitle: new FakeElement(),
    picklistDistribution: new FakeElement()
  };
}

before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'analytics.js'), 'utf8')
    .replace("import { apiRequest } from './api.js';", 'const apiRequest = globalThis.__analyticsRequest;');
  globalThis.__analyticsRequest = (...args) => globalThis.__analyticsRequestImpl(...args);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  ({ AnalyticsDashboard } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
});

after(() => {
  delete global.document;
  delete globalThis.__analyticsRequest;
  delete globalThis.__analyticsRequestImpl;
});

test('analytics dashboard loads the selected module and renders metrics and bars', async () => {
  let requestPath;
  globalThis.__analyticsRequestImpl = async (pathName) => {
    requestPath = pathName;
    return {
      module: { apiName: 'Deals', pluralLabel: 'Deals' },
      sample: { records: 2, partial: false },
      metrics: { sampledRecords: 2, recentRecords: 1, completeness: 75, populatedRecords: 2 },
      creationTrend: [{ label: 'Aug 2026', count: 2 }],
      numericSummary: { field: 'Amount', total: 2500, average: 1250, minimum: 1000, maximum: 1500 },
      picklistDistribution: { field: 'Stage', values: [{ label: 'Won', count: 2 }] }
    };
  };
  const elements = createElements();
  const dashboard = new AnalyticsDashboard(elements, () => {});
  dashboard.setModules([{ apiName: 'Deals', pluralLabel: 'Deals' }]);

  await dashboard.load();

  assert.equal(requestPath, '/api/analytics/Deals');
  assert.equal(elements.title.textContent, 'Deals analytics');
  assert.equal(elements.sampledRecords.textContent, '2');
  assert.equal(elements.recentRecords.textContent, '1');
  assert.equal(elements.completeness.textContent, '75%');
  assert.equal(elements.populatedRecords.textContent, '2');
  assert.equal(elements.creationTrend.children.length, 1);
  assert.equal(elements.numericTitle.textContent, 'Amount summary');
  assert.equal(elements.numericTotal.textContent, '2,500');
  assert.equal(elements.picklistTitle.textContent, 'Stage distribution');
  assert.equal(elements.content.classList.contains('hidden'), false);
  assert.match(elements.status.textContent, /all 2 available records/);
});