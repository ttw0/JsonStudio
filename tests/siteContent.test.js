import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

function commands(markdown) {
  return Array.from(markdown.matchAll(/```(?:sh|powershell)\r?\n([\s\S]*?)```/g))
    .flatMap(match => match[1].split(/\r?\n/))
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

test('English and Chinese READMEs expose the same installation commands and comparison rows', async () => {
  const english = await read('README.md');
  const chinese = await read('README_ZH.md');
  assert.deepEqual(commands(english), commands(chinese));
  assert.match(english, /JSONL\/NDJSON/);
  assert.match(english, /convenient keyboard shortcuts/);
  assert.match(english, /\|\s*JSONL file viewing\s*\|/);
  const rows = markdown => markdown.split(/\r?\n/)
    .filter(line => line.startsWith('|') && line.includes('✅'))
    .map(line => line.match(/[✅❌]/g));
  assert.deepEqual(rows(english), rows(chinese));
});

test('the English homepage includes the JSONL editor updates from the Chinese homepage', async () => {
  const english = await read('docs/index.html');
  const chinese = await read('docs/zh/index.html');
  assert.match(english, /JSON\/JSON5\/JSONL formatting/);
  assert.match(chinese, /JSON\/JSON5\/JSONL/);
  assert.match(english, /pasted JSON, JSON5, JSONL, and escaped JSON/);
  assert.match(chinese, /JSON、JSON5、JSONL、转义 JSON/);
});
