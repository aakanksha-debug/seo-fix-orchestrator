import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReadyToFix, nextSession, sessionGate } from '../src/sessions.js';

test('PM-mode sites run A and B fixes after PM approval', () => {
  assert.equal(isReadyToFix({ risk: 'A', status: 'PM Approved' }, 'pm'), true);
  assert.equal(isReadyToFix({ risk: 'B', status: 'Client Approved' }, 'pm'), true);
  assert.equal(isReadyToFix({ risk: 'A', status: 'Pending' }, 'pm'), false);
});

test('client-mode sites need client approval even for low-risk fixes', () => {
  assert.equal(isReadyToFix({ risk: 'A', status: 'PM Approved' }, 'client'), false);
  assert.equal(isReadyToFix({ risk: 'A', status: 'Client Approved' }, 'client'), true);
});

test('risk C, developer handoff and unknown values never run automatically', () => {
  assert.equal(isReadyToFix({ risk: 'C', status: 'Client Approved' }, 'pm'), false);
  assert.equal(isReadyToFix({ risk: 'A', status: 'Client Approved' }, 'developer'), false);
  assert.equal(isReadyToFix({ risk: '', status: 'PM Approved' }, 'pm'), false);
  assert.equal(isReadyToFix({ risk: 'A', status: 'PM Approved' }, ''), false);
});

test('a session advances only when every row is finished', () => {
  const open = [{ status: 'Verified' }, { status: 'Fixed' }];
  assert.deepEqual(sessionGate(open), { canAdvance: false, blocking: 1 });
  assert.equal(nextSession(1, open), 1);

  const done = [{ status: 'Verified' }, { status: 'Handed Off' }, { status: 'Rejected' }];
  assert.equal(nextSession(1, done), 2);
  assert.equal(nextSession(3, done), 'complete');
  assert.equal(nextSession(2, []), 3);
});
