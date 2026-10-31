// Minimal RFC 4180 CSV reader and writer, so the project has no dependencies.

export function parseCsv(text) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else inQuotes = false;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header = [], ...data] = rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
  const keys = header.map((key) => key.trim());
  return data.map((cells) => Object.fromEntries(keys.map((key, i) => [key, (cells[i] ?? '').trim()])));
}

// Output is meant to be imported into Google Sheets, so cells that would run as a
// formula are prefixed with an apostrophe.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function escapeCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows, columns) {
  const lines = [columns.map(escapeCell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => escapeCell(row[column])).join(','));
  return `${lines.join('\n')}\n`;
}
