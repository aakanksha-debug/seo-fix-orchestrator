import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, validateConfig } from '../src/config.js';
import { assignTier } from '../src/tiers.js';

const config = {
  targetHealthScore: 90,
  fastTrackBelow: 70,
  crawlCapMultiplier: 1.2,
  minCrawlCap: 50,
  ahrefsCapLimit: 5000,
  tiers: [
    { name: 'S', maxUrls: 300, weight: 1, frequency: 'monthly', method: 'full' },
    { name: 'M', maxUrls: 2000, weight: 1.2, frequency: 'monthly', method: 'params' },
    { name: 'L', maxUrls: 10000, weight: 1.5, frequency: 'every-4-weeks', method: 'capped' },
    { name: 'XL', maxUrls: null, weight: 1.5, frequency: 'rotation', method: 'sessions' },
  ],
};

test('assignTier uses inclusive tier boundaries', () => {
  assert.equal(assignTier(300, config).tier, 'S');
  assert.equal(assignTier(301, config).tier, 'M');
  assert.equal(assignTier(2000, config).tier, 'M');
  assert.equal(assignTier(20000, config).tier, 'XL');
});

test('assignTier sets the crawl cap to count x 1.2 with a floor', () => {
  assert.equal(assignTier(300, config).crawlCap, 360);
  assert.equal(assignTier(10, config).crawlCap, 50);
});

test('assignTier caps at the Ahrefs limit and flags folder sessions', () => {
  const large = assignTier(4500, config);
  assert.equal(large.tier, 'L');
  assert.equal(large.crawlCap, 5000);
  assert.equal(large.needsSessions, true);
  assert.equal(assignTier(1000, config).needsSessions, false);
});

test('assignTier returns UNKNOWN when there is no usable count', () => {
  assert.equal(assignTier(0, config).tier, 'UNKNOWN');
  assert.equal(assignTier(NaN, config).crawlCap, null);
});

test('shipped settings.json is valid', () => {
  assert.doesNotThrow(() => loadConfig());
});

test('validateConfig rejects tiers that do not increase', () => {
  const broken = {
    ...config,
    tiers: [
      { name: 'S', maxUrls: 300, weight: 1 },
      { name: 'M', maxUrls: 100, weight: 1 },
      { name: 'XL', maxUrls: null, weight: 1 },
    ],
  };
  assert.throws(() => validateConfig(broken), /larger than the previous tier/);
});
