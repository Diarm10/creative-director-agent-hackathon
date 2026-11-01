// What the quality push changed: no audience in the copy and a larger studio product. (A disc behind the product was tried
// and removed: the critic read it as a halo around the product and capped two rounds at 4.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { mentionsAudience } from '../../src/lib/meta/creativeDirectorPure.ts';
import { renderDesign } from '../../src/lib/meta/design/layouts.ts';
import { makePalette } from '../../src/lib/meta/design/palette.ts';

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}-cutout.png`, import.meta.url));
const PALETTE = makePalette(['#c0392b', '#f6efe6', '#d9552b']);

test('mentionsAudience: the audience in a headline or subline is caught, the product name is not', () => {
  assert.equal(mentionsAudience('White Cans for Online Shoppers', 'online shoppers', 'white cans'), true);
  assert.equal(mentionsAudience('From Fernhill Home for online shoppers', 'online shoppers', 'mug'), true);
  assert.equal(mentionsAudience('Table Lamp With Diamond Shade', 'online shoppers', 'table lamp'), false);
  assert.equal(mentionsAudience('Shoppers Mug', 'online shoppers', 'shoppers mug'), false, 'a word in the product name is the product');
  assert.equal(mentionsAudience('Plain Mug', '', 'mug'), false);
});

test('studio layout: the product fills at least 45 percent of the canvas height', async () => {
  let layout;
  const png = await renderDesign({ archetype: 'product', width: 1080, height: 1080, palette: PALETTE, product: fixture('stool-wooden'), organiser: 'Fernhill Home', headline: 'Worn Low Stool', subline: 'A low wooden stool', cta: 'Shop now', onLayout: (l) => (layout = l) });
  assert.ok((layout.productBottom - layout.productTop) / 1080 >= 0.45, `${layout.productBottom - layout.productTop}`);
});

test('type behind the product: the headline stays at least 85 percent visible', async () => {
  for (const n of ['mug-white', 'notebook-black']) {
    let layout;
    await renderDesign({ archetype: 'behind', width: 1080, height: 1080, palette: PALETTE, product: fixture(n), organiser: 'Fernhill Home', headline: 'Plain Black Notebook', subline: 'x', cta: 'Shop now', onLayout: (l) => (layout = l) });
    assert.ok(layout.headlineVisible.at(-1) >= 0.85 - 0.002, `${n} ${layout.headlineVisible}`);
  }
});
