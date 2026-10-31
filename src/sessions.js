// Three fix sessions and the approval rules that decide when a fix row may run.
import { norm } from './util.js';

export const SESSIONS = Object.freeze([
  {
    id: 1,
    name: 'Structure',
    fixes: ['4XX pages', 'broken internal links', 'redirect chains and loops', 'canonical errors'],
    crawlScope: 'sitemap-only',
  },
  {
    id: 2,
    name: 'Tags',
    fixes: ['missing or duplicate title', 'missing or duplicate meta description', 'missing or duplicate H1'],
    crawlScope: 'sitemap-only',
  },
  {
    id: 3,
    name: 'Media',
    fixes: ['missing alt text', 'broken images'],
    crawlScope: 'images on, CSS/JS off, folder-wise for large sites',
  },
]);

export const STATUS_FLOW = Object.freeze(['Pending', 'PM Approved', 'Client Approved', 'Fixed', 'Verified']);

// Rows in these statuses no longer block the session gate.
const FINISHED_STATUSES = new Set(['verified', 'handed off', 'rejected']);

// Fail closed: unknown risk, unknown mode, risk C and developer handoff never run automatically.
export function isReadyToFix({ risk, status }, approvalMode) {
  const riskClass = norm(risk);
  const rowStatus = norm(status);
  const mode = norm(approvalMode);

  if (riskClass !== 'a' && riskClass !== 'b') return false;
  if (mode === 'client') return rowStatus === 'client approved';
  if (mode === 'pm') return rowStatus === 'pm approved' || rowStatus === 'client approved';
  return false;
}

export function sessionGate(rows) {
  const blocking = rows.filter((row) => !FINISHED_STATUSES.has(norm(row.status)));
  return { canAdvance: blocking.length === 0, blocking: blocking.length };
}

export function nextSession(currentSession, rows) {
  if (!sessionGate(rows).canAdvance) return currentSession;
  return currentSession >= SESSIONS.length ? 'complete' : currentSession + 1;
}
