const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  selectAnalyticsFields,
  summarizeAnalytics
} = require('../backend/services/zohoAnalyticsService');

const moduleMetadata = {
  apiName: 'Deals',
  pluralLabel: 'Deals',
  permissions: { view: true, create: true, edit: true, delete: true }
};
const fields = [
  { apiName: 'Name', label: 'Deal name', dataType: 'text', editable: true },
  { apiName: 'Stage', label: 'Stage', dataType: 'picklist', editable: true },
  { apiName: 'Amount', label: 'Amount', dataType: 'currency', editable: true },
  { apiName: 'Created_Time', label: 'Created time', dataType: 'datetime', editable: false }
];

test('analytics prioritizes Created_Time within the Zoho field limit', () => {
  const manyFields = Array.from({ length: 55 }, (_, index) => ({
    apiName: `Field_${index}`,
    dataType: 'text'
  }));
  manyFields.push(fields[3]);

  const selected = selectAnalyticsFields(manyFields);
  assert.equal(selected.length, 50);
  assert.equal(selected[0].apiName, 'Created_Time');
});

test('analytics summarizes a bounded module sample', () => {
  const result = summarizeAnalytics(moduleMetadata, fields, [
    { Name: 'North', Stage: 'Won', Amount: 1200, Created_Time: '2026-08-12T10:00:00Z' },
    { Name: 'South', Stage: 'Open', Amount: null, Created_Time: '2026-08-20T10:00:00Z' },
    { Name: 'West', Stage: 'Won', Amount: 800, Created_Time: 'invalid' }
  ], { moreRecords: true }, new Date('2026-09-01T00:00:00Z'));

  assert.deepEqual(result.metrics, {
    sampledRecords: 3,
    recentRecords: 2,
    populatedRecords: 3,
    completeness: 92
  });
  assert.equal(result.sample.partial, true);
  assert.equal(result.creationTrend.at(-2).label, 'Aug 2026');
  assert.equal(result.creationTrend.at(-2).count, 2);
  assert.deepEqual(result.picklistDistribution, {
    field: 'Stage',
    values: [{ label: 'Won', count: 2 }, { label: 'Open', count: 1 }]
  });
  assert.deepEqual(result.numericSummary, {
    field: 'Amount', count: 2, total: 2000, average: 1000, minimum: 800, maximum: 1200
  });
});