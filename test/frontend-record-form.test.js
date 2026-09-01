const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');

let controlValue;

before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'recordForm.js'), 'utf8');
  ({ controlValue } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
});

test('record form renders object fields as useful CRM values', () => {
  assert.equal(controlValue({ apiName: 'Owner', inputType: 'readonly' }, {
    Owner: { id: '1000000000001', name: 'CRM Owner' }
  }), 'CRM Owner');
  assert.equal(controlValue({ apiName: 'Owner', inputType: 'lookup' }, {
    Owner: { id: '1000000000001', name: 'CRM Owner' }
  }), '1000000000001');
  assert.equal(controlValue({ apiName: 'Account', inputType: 'readonly' }, {
    Account: { id: '1000000000002' }
  }), '1000000000002');
});