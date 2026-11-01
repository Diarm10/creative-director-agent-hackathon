// safeJson is the one place model text becomes data. It has to cope with how different models format
// JSON, including the open model, and return null, never throw, when there is nothing usable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeJson, stripReasoning } from '../../src/lib/meta/creativeDirectorPure.ts';

const want = { score: 7, note: 'ok' };

test('plain JSON, with a preface or a closing remark', () => {
  assert.deepEqual(safeJson('{"score":7,"note":"ok"}'), want);
  assert.deepEqual(safeJson('Here you go: {"score":7,"note":"ok"} Hope that helps!'), want);
});

test('code fences, with or without a language tag', () => {
  assert.deepEqual(safeJson('```json\n{"score":7,"note":"ok"}\n```'), want);
  assert.deepEqual(safeJson('```\n{"score":7,"note":"ok"}\n```'), want);
  assert.deepEqual(safeJson('```JSON{"score":7,"note":"ok"}```'), want);
});

test('reasoning blocks before the answer are ignored, including braces inside them', () => {
  assert.deepEqual(safeJson('<think>maybe {"score": 1} is too low</think>{"score":7,"note":"ok"}'), want);
  assert.deepEqual(safeJson('<thinking>plan</thinking>\n{"score":7,"note":"ok"}'), want);
  assert.equal(stripReasoning('<think>a</think>Answer<think>b</think>'), 'Answer');
});

test('trailing commas, smart quotes and single quotes are repaired', () => {
  assert.deepEqual(safeJson('{"score":7,"note":"ok",}'), want);
  assert.deepEqual(safeJson('{"parts":[1,2,],"score":7,"note":"ok"}').score, 7);
  assert.deepEqual(safeJson('{“score”: 7, “note”: “ok”}'), want);
  assert.deepEqual(safeJson("{'score': 7, 'note': 'ok'}"), want);
});

test('braces inside strings do not confuse it, and nested objects come back whole', () => {
  assert.deepEqual(safeJson('{"note":"use {braces} like this","score":7}'), { note: 'use {braces} like this', score: 7 });
  assert.deepEqual(safeJson('{"parts":{"a":{"score":1}},"score":7}'), { parts: { a: { score: 1 } }, score: 7 });
  assert.deepEqual(safeJson('{"note":"say \\"hi\\" } now","score":7}'), { note: 'say "hi" } now', score: 7 });
});

test('junk braces before the real object are skipped', () => {
  assert.deepEqual(safeJson('Use the {format} below. {"score":7,"note":"ok"}'), want);
});

test('arrays, plain text and broken input give null and never throw', () => {
  for (const s of ['', 'no json here', '[1,2,3]', '{"score": 7', '{{{', '}{', 'null', '{"a": }']) {
    assert.equal(safeJson(s), null, JSON.stringify(s));
  }
});

test('a long reply with many braces is handled in reasonable time', () => {
  const noise = '{ not json '.repeat(2000);
  const started = Date.now();
  assert.deepEqual(safeJson(noise + '{"score":7,"note":"ok"}'), want);
  assert.ok(Date.now() - started < 2000);
});
