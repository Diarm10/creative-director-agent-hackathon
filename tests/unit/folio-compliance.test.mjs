import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFolioCompliance, applyFolioGate } from '../../src/lib/meta/creativeDirectorPure.ts';

const NEVER_CALLED = async () => {
  throw new Error('callText should not have been invoked -- the banned-word check is deterministic');
};

test('banned word caught without ever calling the model', async () => {
  const folio = { bannedWords: ['miracle'], bannedClaims: [], approvedFacts: [] };
  const result = await checkFolioCompliance('A miracle for tired feet', 'Try it today.', folio, NEVER_CALLED);
  assert.equal(result.passed, false);
  assert.match(result.reason, /miracle/i);
});

test('banned word match is case-insensitive and checks both headline and body', async () => {
  const folio = { bannedWords: ['cure'], bannedClaims: [], approvedFacts: [] };
  const result = await checkFolioCompliance('Great sound', 'A guaranteed CURE for boring commutes.', folio, NEVER_CALLED);
  assert.equal(result.passed, false);
});

test('invented claim caught via the (fake) model call', async () => {
  const folio = { bannedWords: [], bannedClaims: ['noise cancelling'], approvedFacts: ['12 hour battery'] };
  const fakeCallText = async () => JSON.stringify({ violation: true, reason: 'Claims noise cancelling, which is banned' });
  const result = await checkFolioCompliance('Total silence', 'Noise cancelling earbuds.', folio, fakeCallText);
  assert.equal(result.passed, false);
  assert.match(result.reason, /noise cancelling/i);
});

test('clean copy passes both the deterministic and model checks', async () => {
  const folio = { bannedWords: ['miracle'], bannedClaims: ['noise cancelling'], approvedFacts: ['12 hour battery'] };
  const fakeCallText = async () => JSON.stringify({ violation: false, reason: null });
  const result = await checkFolioCompliance('All-day sound', '12 hour battery life.', folio, fakeCallText);
  assert.equal(result.passed, true);
  assert.equal(result.reason, null);
});

test('no folio means no check -- always passes without calling the model', async () => {
  const result = await checkFolioCompliance('Anything', 'Goes here', null, NEVER_CALLED);
  assert.equal(result.passed, true);
});

test('an empty banned/approved folio skips the model call too', async () => {
  const folio = { bannedWords: [], bannedClaims: [], approvedFacts: [] };
  const result = await checkFolioCompliance('Anything', 'Goes here', folio, NEVER_CALLED);
  assert.equal(result.passed, true);
});

test('a model call that throws fails open (passes)', async () => {
  const folio = { bannedWords: [], bannedClaims: ['x'], approvedFacts: [] };
  const flaky = async () => { throw new Error('network blip'); };
  const result = await checkFolioCompliance('Headline', 'Body', folio, flaky);
  assert.equal(result.passed, true);
});

test('unparseable model output fails open (passes)', async () => {
  const folio = { bannedWords: [], bannedClaims: ['x'], approvedFacts: [] };
  const garbled = async () => 'not json at all';
  const result = await checkFolioCompliance('Headline', 'Body', folio, garbled);
  assert.equal(result.passed, true);
});

test('folio gate caps the score on a violation, like the fidelity gate', () => {
  assert.equal(applyFolioGate(9, false), 4);
  assert.equal(applyFolioGate(9, true), 9);
  assert.equal(applyFolioGate(2, false), 2);
});
