import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeCell, parseCsv, toCsv } from '../src/csv.js';

test('parseCsv handles BOM, CRLF, quotes, commas and newlines inside fields', () => {
  const text = '﻿client_id,domain,note\r\nINC1,a.com,"says ""hi"", twice"\r\nINC2,b.com,"line one\nline two"\r\n\r\n';
  assert.deepEqual(parseCsv(text), [
    { client_id: 'INC1', domain: 'a.com', note: 'says "hi", twice' },
    { client_id: 'INC2', domain: 'b.com', note: 'line one\nline two' },
  ]);
});

test('toCsv round-trips through parseCsv', () => {
  const rows = [{ a: 'x, y', b: 'plain' }, { a: '"quoted"', b: '' }];
  assert.deepEqual(parseCsv(toCsv(rows, ['a', 'b'])), rows);
});

test('escapeCell neutralises spreadsheet formulas but keeps negative numbers', () => {
  assert.equal(escapeCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(escapeCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(escapeCell('-5'), '-5');
  assert.equal(escapeCell(null), '');
});
