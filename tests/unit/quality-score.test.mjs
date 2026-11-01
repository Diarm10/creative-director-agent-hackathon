// The measured part of the score: no model call, only the layout numbers and a few sampled pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { adjustScore, layoutFaults, measureQuality, regionContrast } from '../../src/lib/meta/quality.ts';
import { restyle } from '../../src/lib/meta/restyle.ts';

const layout = (over = {}) => ({ mode: 'composite', zoom: 1, gapPx: 40, productGapPx: 40, textTop: 80, textBottom: 380, productTop: 420, productBottom: 960, productLeft: 300, productRight: 780, headSize: 120, headlineVisible: [1, 1], headlineBounds: { left: 60, right: 900, top: 100, bottom: 360 }, ...over });

test('a product that covers or touches the headline loses points, in plain words', () => {
  assert.deepEqual(layoutFaults(layout(), 1080, false).faults, []);
  const covers = layoutFaults(layout({ headlineVisible: [1, 0.9] }), 1080, false);
  assert.equal(covers.delta, -2);
  assert.match(covers.faults[0], /covers part of the headline/);
  const touches = layoutFaults(layout({ headlineVisible: [1, 0.99] }), 1080, false);
  assert.equal(touches.delta, -1);
  assert.match(touches.faults[0], /touches the headline/);
  const close = layoutFaults(layout({ productTop: 380 }), 1080, false);
  assert.match(close.faults.join(' '), /too close to the headline/);
  assert.deepEqual(layoutFaults(layout({ headlineVisible: [1, 0.9] }), 1080, true).faults, [], 'a magazine masthead keeps its overlap');
});

test('a small product and a mostly empty frame lose points', () => {
  assert.match(layoutFaults(layout({ productTop: 700, productBottom: 960 }), 1080, false).faults.join(' '), /only 24 percent of the frame height/);
  const empty = layoutFaults(layout({ textTop: 80, textBottom: 200, productTop: 230, productBottom: 520, headlineBounds: { left: 60, right: 900, top: 100, bottom: 190 } }), 1080, false);
  assert.match(empty.faults.join(' '), /large part of the frame is empty/);
});

test('contrast is measured on the headline area: dark on light reads, grey on grey does not', async () => {
  const dark = await sharp({ create: { width: 400, height: 100, channels: 3, background: '#f4efe0' } }).composite([{ input: await sharp({ create: { width: 300, height: 40, channels: 3, background: '#102a1e' } }).png().toBuffer(), left: 50, top: 30 }]).png().toBuffer();
  const grey = await sharp({ create: { width: 400, height: 100, channels: 3, background: '#8a8a8a' } }).composite([{ input: await sharp({ create: { width: 300, height: 40, channels: 3, background: '#7d7d7d' } }).png().toBuffer(), left: 50, top: 30 }]).png().toBuffer();
  const box = { left: 0, right: 400, top: 0, bottom: 100 };
  assert.ok((await regionContrast(dark, box)) >= 7);
  assert.ok((await regionContrast(grey, box)) < 4.5);
});

test('the final score is the critic score plus the measured part, between 1 and 10', () => {
  assert.equal(adjustScore(7, -2), 5);
  assert.equal(adjustScore(7, 1), 8);
  assert.equal(adjustScore(1, -3), 1);
  assert.equal(adjustScore(10, 1), 10);
  assert.equal(adjustScore(7, 0), 7);
});

const cut = (n) => readFileSync(new URL(`./fixtures/${n}-cutout.png`, import.meta.url));
const plan = { headline: 'Sit Anywhere', subline: '', cta: 'Shop now', badge: [], ctaScale: 1, gapScale: 1, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] };

test('a clean render with strong contrast earns a point, and the reasons are listed', async () => {
  const r = await restyle({ archetype: 'product', plan, brief: { clientName: 'Fernhill Home', look: 'quiet', theme: 'evergreen', facts: '' }, cutoutPng: cut('stool-wooden'), effect: undefined });
  const q = await measureQuality(r.png, r.layout, {});
  assert.deepEqual(q.faults, []);
  assert.ok(q.delta >= 0 && q.delta <= 1);
});

test('a measured fault on a real render comes back in plain words and lowers the score', async () => {
  const r = await restyle({ archetype: 'product', plan, brief: { clientName: 'Fernhill Home', look: 'loud', theme: 'christmas', facts: '' }, cutoutPng: cut('stool-wooden'), effect: undefined });
  const q = await measureQuality(r.png, { ...r.layout, headlineVisible: [0.9], productTop: r.layout.textBottom - 60 }, {});
  assert.ok(q.delta < 0);
  assert.match(q.faults.join(' '), /covers part of the headline/);
  assert.ok(adjustScore(7, q.delta) < 7);
});
