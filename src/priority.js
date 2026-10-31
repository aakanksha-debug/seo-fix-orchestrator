// Fix queue: priority = (100 - health score) x tier weight, among gate-passing sites only.
// Sites below the fast-track score go first, but HOLD sites never bypass the gate.
import { checkGates } from './gates.js';
import { toNumber } from './util.js';

const inRange = (n) => (n >= 0 && n <= 100 ? n : null);

// Accepts a plain number or the Project tab format "Score 97/Error 215".
export function parseHealthScore(value) {
  const direct = toNumber(value);
  if (direct !== null) return inRange(direct);
  const match = String(value ?? '').match(/score\s*(\d{1,3})/i);
  return match ? inRange(Number(match[1])) : null;
}

export const priorityScore = (healthScore, tierWeight) => (100 - healthScore) * tierWeight;

export function buildQueue(sites, config, { killSwitch = false } = {}) {
  const queue = [];
  const skipped = [];

  for (const site of sites) {
    const reasons = [...checkGates(site, { killSwitch }).reasons];
    const healthScore = parseHealthScore(site.healthScore);
    const weight = config.tiers.find((t) => t.name === site.tier)?.weight ?? null;

    if (healthScore === null) reasons.push('no baseline health score');
    else if (healthScore >= config.targetHealthScore) reasons.push(`health score already at or above ${config.targetHealthScore}`);
    if (weight === null) reasons.push('size tier unknown');

    if (reasons.length) {
      skipped.push({ ...site, reasons });
      continue;
    }

    queue.push({
      ...site,
      healthScore,
      priority: Math.round(priorityScore(healthScore, weight) * 100) / 100,
      fastTrack: healthScore < config.fastTrackBelow,
    });
  }

  queue.sort(
    (a, b) =>
      Number(b.fastTrack) - Number(a.fastTrack) ||
      b.priority - a.priority ||
      String(a.clientId).localeCompare(String(b.clientId)),
  );
  return { queue, skipped };
}
