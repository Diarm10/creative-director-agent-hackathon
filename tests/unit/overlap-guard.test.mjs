// The overlap guard for type behind the product: on the real cut-outs that failed (stool, mug, notebook) the last
// headline line stays at least 85 percent visible and every other line fully visible, measured on the pixels.
// The fixtures are the cut-outs SAM made for the sample catalogue photos, shrunk to 420 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderDesign, overlapLimits, visibleShares, chooseRemedy, LAST_LINE_MIN, HEADLINE_CLEAR } from '../../src/lib/meta/design/layouts.ts';
import { makePalette } from '../../src/lib/meta/design/palette.ts';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}-cutout.png`, import.meta.url));
const PALETTE = makePalette(['#7a2e1d', '#f2e6d8', '#c0502d']);
const CASES = [
  { name: 'stool-wooden', headline: 'Low Stool, Dark Seat', subline: 'Wooden stool with worn, chipped legs' },
  { name: 'mug-white', headline: 'Plain Mug With Handle', subline: 'A plain white mug' },
  { name: 'notebook-black', headline: 'Plain Black Notebook Online', subline: 'A plain black notebook' },
  { name: 'plant-snake', headline: 'Tall Striped Snake Plant', subline: 'Tall, narrow, striped leaves' },
];

async function render(c, extra = {}) {
  let layout;
  const png = await renderDesign({
    archetype: 'behind', width: 1080, height: 1080, palette: PALETTE, product: fixture(c.name), organiser: 'Fernhill Home',
    headline: c.headline, subline: c.subline, cta: 'Shop now', onLayout: (l) => (layout = l), ...extra,
  });
  if (process.env.SAVE_OVERLAP) {
    mkdirSync(process.env.SAVE_OVERLAP, { recursive: true });
    writeFileSync(`${process.env.SAVE_OVERLAP}/${c.name}.png`, png);
  }
  return { png, layout };
}

for (const c of CASES) {
  test(`${c.name}: the last line is at least 85 percent visible and every other line fully visible`, async () => {
    const { layout } = await render(c);
    const v = layout.headlineVisible;
    assert.ok(v.length >= 1);
    assert.ok(v.at(-1) >= LAST_LINE_MIN - 0.002, `last line ${v.at(-1)} of ${v.length} lines (${layout.overlapSteps.join(', ') || 'no change needed'})`);
    for (const s of v.slice(0, -1)) assert.ok(s >= 0.998, `an earlier line is ${s} visible`);
  });
}

test('a tightened guard asks for more of the last line, and on the real heights the headline is moved up to get it', async () => {
assert.equal(overlapLimits(0, true).last, LAST_LINE_MIN, 'a magazine masthead keeps the old allowance');  assert.equal(overlapLimits(0).last, HEADLINE_CLEAR, 'any other headline is never covered');  assert.ok(overlapLimits(2, true).last > overlapLimits(0, true).last);
  assert.equal(overlapLimits(99).last, 1, 'never above all of it');
  for (const c of CASES.slice(0, 3)) {
    const normal = await render(c);
    const tight = await render(c, { overlapGuard: 4 }); // the limit is now all of the last line
    assert.ok(tight.layout.headlineVisible.at(-1) >= 0.998, `${c.name}: ${tight.layout.headlineVisible}`);
    assert.ok(tight.layout.headlineVisible.at(-1) >= normal.layout.headlineVisible.at(-1), `${c.name} shows at least as much of the last line when the guard is tighter`);
    assert.ok(normal.layout.headlineVisible.at(-1) >= HEADLINE_CLEAR - 0.002, `${c.name}: the product does not cover the headline (${normal.layout.headlineVisible})`);
    assert.ok(tight.layout.overlapSteps.some((x) => /moved the headline up/.test(x)), `${c.name}: ${tight.layout.overlapSteps}`);
  }
});

test('the product sits snug against the headline, within its line box, and never covers it', async () => {
  const { layout } = await render(CASES[0]);
  assert.ok(layout.productTop < layout.textBottom + 40, 'the product starts right at the bottom of the type block');
  assert.ok(layout.headlineVisible.at(-1) >= HEADLINE_CLEAR - 0.002, 'none of the last line is covered');
});

// ---- the order of remedies, without drawing anything --------------------------------------------

const never = () => false;
test('remedies are tried in order: up first, then shrink, then push', () => {
  const room = () => 40;
  const lower = () => 40;
  // Fixable by moving up alone at the full size.
  assert.deepEqual(chooseRemedy({ sizes: 3, room, lower, step: 10, ok: (s, up) => s === 0 && up >= 20 }), { size: 0, up: 20, push: 0 });
  // Moving up never works at the full size, but does at the next size: shrink is chosen before any push.
  assert.deepEqual(chooseRemedy({ sizes: 3, room, lower, step: 10, ok: (s, up) => s === 1 && up >= 10 }), { size: 1, up: 10, push: 0 });
  // Only a push works: the headline is as high as it can go and the product is moved down.
  assert.deepEqual(chooseRemedy({ sizes: 3, room, lower, step: 10, ok: (s, up, push) => up === 40 && push >= 20 }), { size: 0, up: 40, push: 20 });
  // A shrink that works is chosen over a push that would also work.
  assert.deepEqual(chooseRemedy({ sizes: 3, room, lower, step: 10, ok: (s, up, push) => (s === 2 && up === 0) || (up === 40 && push >= 10) }), { size: 2, up: 0, push: 0 });
});

test('when no remedy works, nothing is chosen, so the studio layout is used', () => {
  assert.equal(chooseRemedy({ sizes: 5, room: () => 60, lower: () => 60, step: 6, ok: never }), null);
});


test('visibleShares counts the ink the product covers: a product over the bottom half of a line leaves about half', () => {
  const W = 100;
  // One line whose ink is a 40 by 10 block at rows 20 to 29.
  const pixels = [];
  for (let y = 20; y < 30; y++) for (let x = 30; x < 70; x++) pixels.push(y * W + x);
  const ink = [{ pixels: Int32Array.from(pixels), y: 20 }];
  const solid = Buffer.alloc(60 * 40, 255); // a 60 wide, 40 tall opaque product
  assert.ok(Math.abs(visibleShares(ink, [20], solid, 60, 40, 20, 25, W)[0] - 0.5) < 0.01, 'product top at row 25');
  assert.equal(visibleShares(ink, [20], solid, 60, 40, 20, 30, W)[0], 1, 'product starts below the line');
  assert.equal(visibleShares(ink, [20], solid, 60, 40, 20, 20, W)[0], 0, 'product over the whole line');
  assert.equal(visibleShares(ink, [10], solid, 60, 40, 20, 25, W)[0], 1, 'the line moved up 10 px, clear of the product');
});

