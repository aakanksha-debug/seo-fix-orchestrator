export const norm = (value) => String(value ?? '').trim().toLowerCase();

const YES = new Set(['yes', 'y', 'true', '1']);

export const isYes = (value) => value === true || YES.has(norm(value));

export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}
