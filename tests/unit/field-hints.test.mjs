import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeSlogan } from '../../src/components/creative-director/fieldHints.ts';

test('names of objects are not flagged', () => {
  for (const v of ['sticker', 'earbuds', 'coffee mug', 'wireless earbuds case', 'running shoe', '']) {
    assert.equal(looksLikeSlogan(v), false, v);
  }
});

test('slogans and sentences are flagged', () => {
  for (const v of ['Join us at Circles 2026!', 'Build for your world, today', 'the best earbuds you will ever own', '20% off this week', 'Circles 2026', 'Save $20']) {
    assert.equal(looksLikeSlogan(v), true, v);
  }
});
