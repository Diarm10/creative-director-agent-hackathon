// The critic is told what the layout engine measured, with a limit and a rule about when a spacing problem may be named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCritiquePrompt, measuredLayoutBlock, sensibleGapPx, STICKER_NOTE, TYPE_BEHIND_NOTE } from '../../src/lib/meta/prompts.ts';

const base = { briefType: 'product', previous: null, memory: null, hasFolio: false, supplied: ['the organiser "Harbour Mugs"'] };
const measured = { width: 1080, height: 1080, gapPx: 44, productGapPx: 53, topMarginPx: 81, bottomMarginPx: 70 };

test('the sensible gap is 8 percent of the canvas height', () => {
  assert.equal(sensibleGapPx(1080), 86);
  assert.equal(sensibleGapPx(1920), 154);
  assert.equal(sensibleGapPx(1800), 144);
});

test('the measured numbers and the rule reach the critic as plain facts', () => {
  const block = measuredLayoutBlock(measured);
  assert.match(block, /1080 by 1080 px/);
  assert.match(block, /ends 44 px above where the scene's content begins/);
  assert.match(block, /top edge is 53 px below the type/);
  assert.match(block, /margin above the type is 81 px/);
  assert.match(block, /space below the product is 70 px/);
  assert.match(block, /up to 86 px .* is a deliberate margin/);
  assert.match(block, /Do not name a spacing or empty gap problem between the type and the product unless the measured gap is larger than 86 px/);
  assert.match(block, /something other than that measured gap is empty, and then say exactly where/);
  assert.ok(!new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]").test(block), 'no dashes');
});

test('the full critic prompt carries the block, and the rest of it is unchanged', () => {
  const without = buildCritiquePrompt(['Headline'], true, 'people at home', [], base);
  const withFacts = buildCritiquePrompt(['Headline'], true, 'people at home', [], { ...base, measured });
  assert.ok(!without.includes('Measured by the layout engine'), 'no facts when nothing was measured');
  assert.ok(withFacts.includes('Measured by the layout engine'));
  assert.equal(withFacts.replace(measuredLayoutBlock(measured), ''), without, 'only the facts block was added');
  assert.ok(withFacts.indexOf('Measured by the layout engine') < withFacts.indexOf('The ONLY text that should appear'), 'before the text list');
});

test('a large measured gap is stated as a fact too, so the critic may name it', () => {
  const block = measuredLayoutBlock({ ...measured, gapPx: 200, productGapPx: 240 });
  assert.match(block, /ends 200 px above/);
  assert.match(block, /larger than 86 px/);
});

test('for type set behind the product the critic is told the overlap is deliberate, and only then', () => {
  const plain = buildCritiquePrompt(['Headline'], true, 'people at home', [], base);
  const behind = buildCritiquePrompt(['Headline'], true, 'people at home', [], { ...base, designNote: TYPE_BEHIND_NOTE });
  assert.ok(!plain.includes('set the headline behind the product on purpose'));
  assert.match(behind, /set the headline behind the product on purpose/);
  assert.match(behind, /not a defect. Judge legibility only by whether every word can still be read/);
  assert.equal(behind.replace(TYPE_BEHIND_NOTE, ''), plain, 'nothing else changed');
});

test('for the Sticker Pack look the critic is told the white outline is deliberate, and only then', () => {
  const plain = buildCritiquePrompt(['Headline'], true, 'people at home', [], base);
  const sticker = buildCritiquePrompt(['Headline'], true, 'people at home', [], { ...base, designNote: STICKER_NOTE });
  assert.ok(!plain.includes('sticker outline'));
  assert.match(sticker, /thick white sticker outline on purpose/);
  assert.match(sticker, /product_halo must stay false for it/);
  assert.match(sticker, /box, rectangle or glow/);
  assert.equal(sticker.replace(STICKER_NOTE, ''), plain, 'nothing else changed');
});

test('for the Magazine Cover look the critic is told the masthead word is intended text', async () => {
  const { MASTHEAD_NOTE } = await import('../../src/lib/meta/prompts.ts');
  const plain = buildCritiquePrompt(['Headline'], true, 'people at home', [], base);
  const mast = buildCritiquePrompt(['Headline'], true, 'people at home', [], { ...base, designNote: MASTHEAD_NOTE });
  assert.match(mast, /masthead word/);
  assert.match(mast, /never list it in text_in_image/);
  assert.equal(mast.replace(MASTHEAD_NOTE, ''), plain);
});
