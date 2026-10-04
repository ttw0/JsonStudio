import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseBigInt, parseNumericLiteral, stringifyBigInt } from '../src/lib/utils/jsonBigInt.js';
import { parseJsonSourceDocument } from '../src/lib/services/jsonSourceModel.js';
import { convertToStandardJson } from '../src/lib/services/jsonToStandard.js';
import { sortJsonKeys } from '../src/lib/services/jsonKeySort.js';
import { convertJsonString } from '../src/lib/services/jsonKeyNaming.ts';
import { createTreeDragMove, createTreeValueCopyText } from '../src/lib/services/treeEdit.js';
import { createGridValueEdit, isGridCellEditable } from '../src/lib/services/gridEdit.js';
import { getGridSelectionText } from '../src/lib/services/gridSelection.js';
import { createGridXlsxBytes, createGridPdfBytes } from '../src/lib/services/gridExportFiles.js';
import { formatProperties, parseProperties, formatMarkdownTable, parseMarkdownTable } from '../src/lib/services/convertExtraFormats.js';
import { extractLogJsonFragments } from '../src/lib/services/logJsonFragments.js';

const SOURCE = '{"userId":9007199254740993,"negative":-9223372036854775809,"nested":{"id":18446744073709551615},"name":"Alice"}';
const EXPECTED = {
  userId: 9007199254740993n,
  negative: -9223372036854775809n,
  nested: { id: 18446744073709551615n },
  name: 'Alice',
};

test('source models and worker cloning preserve unsafe integers and pointers', () => {
  const parsed = parseJsonSourceDocument(SOURCE);
  assert.deepEqual(parsed.data, EXPECTED);
  assert.deepEqual(structuredClone(parsed.data), EXPECTED);
  const pointer = parsed.pointers['/userId'];
  assert.equal(SOURCE.slice(pointer.valueStart, pointer.valueEnd), '9007199254740993');
});

test('standardization, key sorting, and key naming preserve numeric values', () => {
  assert.deepEqual(parseBigInt(convertToStandardJson(SOURCE)), EXPECTED);
  assert.deepEqual(parseBigInt(sortJsonKeys(SOURCE, 'asc')), EXPECTED);
  assert.deepEqual(parseBigInt(convertJsonString(SOURCE, 'snake')), {
    user_id: EXPECTED.userId,
    negative: EXPECTED.negative,
    nested: EXPECTED.nested,
    name: EXPECTED.name,
  });
});

test('JSON5 large hex and signed integers convert to precise JSON numbers', () => {
  const result = convertToStandardJson('{id:+0x20000000000001, negative:-9223372036854775809}');
  assert.deepEqual(parseBigInt(result), { id: 9007199254740993n, negative: -9223372036854775809n });
});

test('tree moves and copies do not round unaffected integers', () => {
  const parsed = parseJsonSourceDocument(SOURCE);
  const result = createTreeDragMove({
    data: parsed.data, sourcePath: '/name', targetPath: '/userId', position: 'before',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(parseBigInt(stringifyBigInt(result.data)), EXPECTED);
  assert.equal(createTreeValueCopyText(SOURCE, parsed.pointers, '/userId', parsed.data.userId), '9007199254740993');
});

test('Grid edits and copied rows retain exact numeric digits', () => {
  const parsed = parseJsonSourceDocument(SOURCE);
  assert.equal(isGridCellEditable({ value: parsed.data.userId, expandable: false }), true);
  const result = createGridValueEdit(SOURCE, parsed.pointers, '/userId', parsed.data.userId, '123456789012345678901234567890');
  assert.equal(result.ok, true);
  const edited = SOURCE.slice(0, result.edit.start) + result.edit.text + SOURCE.slice(result.edit.end);
  assert.equal(parseBigInt(edited).userId, 123456789012345678901234567890n);
  const copied = getGridSelectionText([{ id: 'id', path: '/nested', target: 'row' }], parsed.data);
  assert.deepEqual(parseBigInt(copied), { nested: EXPECTED.nested });
});

test('400-digit integers and integral exponent literals are supported', () => {
  const digits = '9'.repeat(400);
  assert.equal(parseBigInt(`{"id":${digits}}`).id, BigInt(digits));
  assert.equal(parseNumericLiteral('9.007199254740993e15'), EXPECTED.userId);
  assert.equal(stringifyBigInt(parseBigInt(`{"id":${digits}}`)), `{"id":${digits}}`);
});

test('Properties, INI, and Markdown preserve large integer values', () => {
  const data = { id: EXPECTED.userId, negative: EXPECTED.negative };
  assert.deepEqual(parseProperties(formatProperties(data)), data);
  assert.deepEqual(parseProperties(formatProperties({ ids: data }, { ini: true }), { ini: true }), { ids: data });
  assert.deepEqual(parseMarkdownTable(formatMarkdownTable([data])), [data]);
});

test('log extraction preserves large integers in JSON and printed structures', () => {
  const json = extractLogJsonFragments(`INFO payload=${SOURCE}`);
  assert.deepEqual(parseBigInt(json[0].formatted), EXPECTED);
  const printed = extractLogJsonFragments('INFO User(id=9007199254740993, name=Alice)');
  assert.equal(parseBigInt(printed[0].formatted).id, EXPECTED.userId);
});

test('PDF and Excel exports preserve integer digits as text', () => {
  const xlsx = XLSX.read(createGridXlsxBytes({ id: EXPECTED.userId }), { type: 'array' });
  assert.equal(xlsx.Sheets.Grid.B1.v, '9007199254740993');
  assert.equal(xlsx.Sheets.Grid.B1.t, 's');
  const pdf = new TextDecoder().decode(createGridPdfBytes({ id: EXPECTED.userId }));
  assert.match(pdf, /9007199254740993/);
});
