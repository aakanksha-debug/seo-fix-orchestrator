import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGates } from '../src/gates.js';

const readySite = (overrides = {}) => ({
  status: 'Active',
  openEscalation: 'no',
  approvalMode: 'pm',
  hasLogin: 'yes',
  cms: 'wordpress',
  backupPossible: 'yes',
  ...overrides,
});

test('a fully ready site passes the gate', () => {
  assert.deepEqual(checkGates(readySite()), { eligible: true, hold: false, reasons: [] });
});

test('paused and unpaid projects are held', () => {
  for (const status of ['Paused', 'Unpaid but Continue', '']) {
    const gate = checkGates(readySite({ status }));
    assert.equal(gate.eligible, false);
    assert.equal(gate.hold, true);
  }
});

test('an open escalation holds an otherwise active site', () => {
  const gate = checkGates(readySite({ openEscalation: 'Yes' }));
  assert.equal(gate.hold, true);
  assert.match(gate.reasons.join(), /escalation/);
});

test('every missing readiness item is reported', () => {
  const gate = checkGates(readySite({ approvalMode: '', hasLogin: 'no', cms: 'unknown', backupPossible: '' }));
  assert.equal(gate.eligible, false);
  assert.equal(gate.hold, false);
  assert.equal(gate.reasons.length, 4);
});

test('the kill switch blocks every site', () => {
  const gate = checkGates(readySite(), { killSwitch: true });
  assert.equal(gate.eligible, false);
  assert.deepEqual(gate.reasons, ['kill switch is on']);
});
