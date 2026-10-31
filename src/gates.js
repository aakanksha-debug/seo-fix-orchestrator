// Daily gate: a site enters the fix queue only when every check passes.
// All failing reasons are returned, not just the first, so PMs can see what to unblock.
import { isYes, norm } from './util.js';

const APPROVAL_MODES = new Set(['pm', 'client', 'developer']);
const UNKNOWN_CMS = new Set(['', 'unknown', 'n/a']);

export function checkGates(site, { killSwitch = false } = {}) {
  const reasons = [];
  const status = norm(site.status);
  const escalated = isYes(site.openEscalation);

  if (killSwitch) reasons.push('kill switch is on');
  if (status !== 'active') reasons.push(`project status is ${site.status ? `"${site.status}"` : 'blank'}`);
  if (escalated) reasons.push('open refund, pause or billing escalation');
  if (!APPROVAL_MODES.has(norm(site.approvalMode))) reasons.push('approval mode not set');
  if (!isYes(site.hasLogin)) reasons.push('no login in the vault');
  if (UNKNOWN_CMS.has(norm(site.cms))) reasons.push('CMS not confirmed');
  if (!isYes(site.backupPossible)) reasons.push('backup not confirmed');

  return { eligible: reasons.length === 0, hold: status !== 'active' || escalated, reasons };
}
