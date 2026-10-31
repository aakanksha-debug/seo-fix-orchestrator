import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'settings.json');

const NUMERIC_KEYS = ['targetHealthScore', 'fastTrackBelow', 'crawlCapMultiplier', 'minCrawlCap', 'ahrefsCapLimit'];

export function loadConfig(path = DEFAULT_PATH) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  for (const key of NUMERIC_KEYS) {
    if (typeof config[key] !== 'number') throw new Error(`config.${key} must be a number`);
  }

  const { tiers } = config;
  if (!Array.isArray(tiers) || tiers.length === 0) throw new Error('config.tiers must be a non-empty array');

  let previousMax = 0;
  tiers.forEach((tier, i) => {
    const isLast = i === tiers.length - 1;
    if (isLast && tier.maxUrls !== null) throw new Error(`config.tiers[${i}].maxUrls must be null for the last tier`);
    if (!isLast && !(tier.maxUrls > previousMax)) throw new Error(`config.tiers[${i}].maxUrls must be larger than the previous tier`);
    if (!(tier.weight > 0)) throw new Error(`config.tiers[${i}].weight must be positive`);
    previousMax = tier.maxUrls ?? previousMax;
  });
}
