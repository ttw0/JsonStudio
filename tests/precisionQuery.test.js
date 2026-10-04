import test from 'node:test';
import assert from 'node:assert/strict';
import { searchJmesPath, searchJsonPath } from '../src/lib/services/precisionQuery.js';
import { runTreeQuery } from '../src/lib/services/treeQuery.ts';

const DATA = [
  { id: 9007199254740992n, name: 'left' },
  { id: 9007199254740993n, name: 'right' },
];

test('JMESPath literals and comparisons distinguish adjacent large IDs', () => {
  assert.deepEqual(searchJmesPath(DATA, '[?id == `9007199254740993`].name'), ['right']);
  assert.deepEqual(searchJmesPath(DATA, '[?id > `9007199254740992`].name'), ['right']);
  assert.equal(searchJmesPath(DATA, 'type([0].id)'), 'number');
});

test('JMESPath numeric functions preserve unsafe integers and mixed arrays', () => {
  const values = [9007199254740993n, 1];
  assert.equal(searchJmesPath(values, 'sum(@)'), 9007199254740994n);
  assert.equal(searchJmesPath(values, 'max(@)'), 9007199254740993n);
  assert.deepEqual(searchJmesPath(values, 'sort(@)'), [1, 9007199254740993n]);
  assert.equal(searchJmesPath('-9007199254740993', 'abs(to_number(@))'), 9007199254740993n);
});

test('unsafe non-integral arithmetic fails rather than rounding', () => {
  assert.throws(() => searchJmesPath([9007199254740993n, 9007199254740994n], 'avg(@)'), /precision/);
  assert.throws(() => searchJsonPath([{ id: 1 }], '$[?(@.id / 100000000000000000000000000000 === 0)]'), /precision/);
  assert.throws(() => searchJsonPath([{ id: 100000000000000000000000000001n }], '$[?(@.id / 100000000000000000000000000000 === 1)]'), /precision/);
  assert.equal(searchJmesPath([1, 2], 'avg(@)'), 1.5);
});

test('JSONPath comparisons and arithmetic use the original numeric tokens', () => {
  assert.deepEqual(searchJsonPath(DATA, '$[?(@.id === 9007199254740993)]'), ['/1']);
  assert.deepEqual(searchJsonPath(DATA, '$[?(@.id + 1 === 9007199254740994)]'), ['/1']);
  assert.deepEqual(searchJsonPath(DATA, '$[?(@.id > 9007199254740992)]'), ['/1']);
});

test('JSONPath number type selectors include native big integers', () => {
  assert.deepEqual(searchJsonPath({ id: DATA[1].id }, '$..*[@number()]'), ['/id']);
});

test('tree query matching preserves big integers through both languages', async () => {
  const nodes = [{ path: '/0/id', value: DATA[0].id }, { path: '/1/id', value: DATA[1].id }];
  const jmes = await runTreeQuery({ mode: 'jmespath', query: '[?id == `9007199254740993`].id', data: DATA, nodes });
  assert.equal(jmes.error, '');
  assert.deepEqual([...jmes.matches], ['/1/id']);
  const path = await runTreeQuery({ mode: 'jsonpath', query: '$[?(@.id == 9007199254740993)].id', data: DATA, nodes });
  assert.equal(path.error, '');
  assert.deepEqual([...path.matches], ['/1/id']);
});
