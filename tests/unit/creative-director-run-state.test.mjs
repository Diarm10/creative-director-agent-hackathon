import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialRunState, reduceRun, markStreamEnded, roundSteps, stepStatuses, splitNdjson,
} from '../../src/components/creative-director/runState.ts';

const concept = (round, imageB64 = 'img') => ({
  round, imageB64, imageMime: 'image/jpeg', method: 'composite', headline: 'H', body: 'B', critique: '',
  inventedClaims: [], fidelity: { sameProduct: true, differences: [] }, folioCheck: { passed: true, reason: null }, score: 7,
});

test('splitNdjson keeps a partial trailing line for the next chunk and skips bad lines', () => {
  const { events, rest } = splitNdjson('{"type":"run_started"}\nnot json\n{"type":"cutout_st');
  assert.deepEqual(events, [{ type: 'run_started' }]);
  assert.equal(rest, '{"type":"cutout_st');
  assert.deepEqual(splitNdjson(rest + 'arted"}\n').events, [{ type: 'cutout_started' }]);
});

test('reduceRun fills cutout, rounds and the final result, reusing streamed images', () => {
  let s = initialRunState;
  for (const e of [
    { type: 'run_started' },
    { type: 'cutout_done', thumbnailB64: 'thumb' },
    { type: 'round_started', round: 1 },
    { type: 'scene_done' },
    { type: 'round_done', round: 1, score: 7, concept: concept(1, 'live1') },
    { type: 'round_started', round: 2 },
  ]) s = reduceRun(s, e);
  assert.equal(s.status, 'running');
  assert.equal(s.thumbnailB64, 'thumb');
  assert.equal(s.round, 2);
  assert.deepEqual(s.roundEvents, []);
  assert.equal(s.concepts.length, 1);

  s = reduceRun(s, { type: 'round_done', round: 2, score: 9, concept: concept(2, 'live2') });
  s = reduceRun(s, { type: 'result', result: { concepts: [concept(1, ''), concept(2, '')], finalPickIndex: 1 }, imagesOmitted: true });
  assert.equal(s.status, 'done');
  assert.deepEqual(s.concepts.map((c) => c.imageB64), ['live1', 'live2']);
  assert.equal(s.finalPickIndex, 1);
});

test('a stream that ends early is marked dropped but keeps what arrived', () => {
  let s = reduceRun(initialRunState, { type: 'run_started' });
  s = reduceRun(s, { type: 'round_done', round: 1, score: 6, concept: concept(1) });
  s = markStreamEnded(s);
  assert.equal(s.status, 'dropped');
  assert.equal(s.concepts.length, 1);
  assert.equal(markStreamEnded(reduceRun(s, { type: 'error', message: 'x' })).status, 'error');
});

test('stepStatuses marks done steps and exactly one active step while running', () => {
  const steps = roundSteps('paid_social_square');
  assert.deepEqual(stepStatuses(steps, ['copy_done', 'scene_started', 'scene_done'], true).slice(0, 4), ['done', 'done', 'active', 'pending']);
  assert.ok(!stepStatuses(steps, [], false).includes('active'));
});

test('roundSteps lists the same pipeline for every channel', () => {
  assert.deepEqual(roundSteps('in_store_poster').map((s) => s.key), ['copy', 'scene', 'composite', 'fidelity', 'folio', 'critique']);
});

import { modelText, STEP_NAME } from '../../src/components/creative-director/runState.ts';

test('model_used events are kept per round and step, the newest winning, without disturbing the step statuses', () => {
  let s = reduceRun(initialRunState, { type: 'run_started' });
  s = reduceRun(s, { type: 'round_started', round: 1 });
  s = reduceRun(s, { type: 'model_used', round: 1, step: 'planner', provider: 'baseten', label: 'Muse Spark Open on Baseten', fellBack: false, reason: null });
  s = reduceRun(s, { type: 'model_used', round: 1, step: 'critic', provider: 'meta', label: 'Muse Spark 1.3 on Meta', fellBack: true, reason: 'timed out' });
  s = reduceRun(s, { type: 'model_used', round: 1, step: 'critic', provider: 'meta', label: 'Muse Spark 1.3 on Meta', fellBack: true, reason: 'rate limited' });
  assert.equal(s.models.length, 2);
  assert.equal(s.models.find((m) => m.step === 'critic').reason, 'rate limited');
  assert.deepEqual(s.roundEvents, [], 'model events are not pipeline steps');
});

test('the model text says plainly when a step was a fallback', () => {
  assert.equal(modelText({ label: 'Muse Spark Open on Baseten', fellBack: false, reason: null }), 'Muse Spark Open on Baseten');
  assert.equal(modelText({ label: 'Muse Spark 1.3 on Meta', fellBack: true, reason: 'timed out' }), 'Muse Spark 1.3 on Meta (fallback: timed out)');
  assert.equal(modelText({ label: 'Muse Spark 1.3 on Meta', fellBack: true, reason: null }), 'Muse Spark 1.3 on Meta (fallback)');
  assert.equal(STEP_NAME.critic, 'Critic');
});
