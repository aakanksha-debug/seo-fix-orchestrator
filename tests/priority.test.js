import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQueue, parseHealthScore } from '../src/priority.js';

const config = {
  targetHealthScore: 90,
  fastTrackBelow: 70,
  tiers: [
    { name: 'S', maxUrls: 300, weight: 1 },
    { name: 'M', maxUrls: 2000, weight: 1.2 },
    { name: 'L', maxUrls: 10000, weight: 1.5 },
    { name: 'XL', maxUrls: null, weight: 1.5 },
  ],
};

const site = (clientId, healthScore, tier, overrides = {}) => ({
  clientId,
  healthScore,
  tier,
  status: 'Active',
  openEscalation: 'no',
  approvalMode: 'pm',
  hasLogin: 'yes',
  cms: 'wordpress',
  backupPossible: 'yes',
  ...overrides,
});

test('parseHealthScore reads numbers and the Project tab format', () => {
  assert.equal(parseHealthScore('Score 61/Error 78'), 61);
  assert.equal(parseHealthScore('Score 100/Error 0'), 100);
  assert.equal(parseHealthScore('85'), 85);
  assert.equal(parseHealthScore(''), null);
  assert.equal(parseHealthScore('n/a'), null);
  assert.equal(parseHealthScore('150'), null);
});

test('fast-track sites come first, then by priority score', () => {
  const { queue } = buildQueue(
    [site('A', 85, 'S'), site('B', 60, 'S'), site('F', 75, 'L')],
    config,
  );
  assert.deepEqual(queue.map((s) => s.clientId), ['B', 'F', 'A']);
  assert.deepEqual(queue.map((s) => s.priority), [40, 37.5, 15]);
  assert.deepEqual(queue.map((s) => s.fastTrack), [true, false, false]);
});

test('held, finished and unscored sites are skipped with a reason', () => {
  const { queue, skipped } = buildQueue(
    [
      site('C', 40, 'M', { status: 'Paused' }),
      site('D', 95, 'S'),
      site('E', '', 'S'),
      site('G', 50, 'UNKNOWN'),
    ],
    config,
  );
  assert.equal(queue.length, 0);
  const reasons = Object.fromEntries(skipped.map((s) => [s.clientId, s.reasons.join('; ')]));
  assert.match(reasons.C, /Paused/);
  assert.match(reasons.D, /already at or above 90/);
  assert.match(reasons.E, /no baseline/);
  assert.match(reasons.G, /tier unknown/);
});

test('a low score never bypasses the hold gate', () => {
  const { queue } = buildQueue([site('H', 10, 'S', { openEscalation: 'yes' })], config);
  assert.equal(queue.length, 0);
});

test('the kill switch empties the queue', () => {
  const { queue, skipped } = buildQueue([site('A', 50, 'S')], config, { killSwitch: true });
  assert.equal(queue.length, 0);
  assert.equal(skipped.length, 1);
});
