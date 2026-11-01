// Nine more themes and two more Looks (Magazine Cover, Sticker Pack). The offer rule holds for every theme, Day of the Dead stays
// respectful, and every Look draws its headline inside the frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';

import { LOOKS, lookById } from '../../src/lib/meta/looks.ts';
import { THEMES, themeById, checkOffer, inventedFigures, copyProblems } from '../../src/lib/meta/themes.ts';
import { styleFor, styleVoice, stripScenery } from '../../src/lib/meta/style.ts';
import { anglesFor } from '../../src/lib/meta/adCopy.ts';
import { restyle } from '../../src/lib/meta/restyle.ts';

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}-cutout.png`, import.meta.url));
const NEW_THEMES = ['halloween', 'dayofthedead', 'valentines', 'newyear', 'spring', 'easter', 'mothersday', 'summer', 'backtoschool'];

test('thirteen themes: the four from before plus nine occasions, each with a palette, a mood and a copy angle', () => {
  assert.deepEqual(THEMES.map((t) => t.name), ['Christmas', 'Black Friday', "Valentine's Day", "Mother's Day", 'Easter', 'Halloween', 'Summer', 'Back to School', 'New Year', 'Spring', 'Autumn Sale', 'Evergreen', 'Day of the Dead'], 'the most popular occasions first, Day of the Dead last');
  assert.match(themeById('dayofthedead').note, /connection to the tradition/);
  assert.ok(THEMES.filter((t) => t.id !== 'dayofthedead').every((t) => !t.note));
  for (const id of NEW_THEMES) {
    const t = themeById(id);
    assert.equal(t.palette.length, 4, `${id} palette`);
    for (const c of t.palette) assert.match(c, /^#[0-9A-F]{6}$/i, `${id} colour ${c}`);
    assert.ok(t.mood.length > 5 && t.angle.length > 60 && t.description.length > 30 && t.cta.length > 3, id);
    assert.match(t.angle, /Never invent an offer: only an offer the person typed may be used/, `${id}: seasonal items only in the styling, never an invented offer`);
    assert.match(t.angle, /Never mention a delivery date, a deadline, a price, a discount or stock/, id);
    assert.ok(!/[–—]/.test(t.description + t.angle + t.mood + t.cta), `${id} has no dashes`);
    assert.equal(t.swatch.length, 3);
  }
  assert.deepEqual(THEMES.filter((t) => t.needsOffer).map((t) => t.id), ['blackfriday', 'autumn'], 'only the sale themes demand an offer');
});

test('Day of the Dead is celebratory and respectful: marigold and purple, no sacred imagery, no skulls from the model', () => {
  const t = themeById('dayofthedead');
  assert.match(t.angle, /celebratory and respectful/);
  assert.match(t.angle, /Never use or mention skulls, skeletons, altars, saints, crosses or any religious or sacred imagery/);
  assert.ok(t.palette.includes('#F5A200') && t.palette.includes('#2B1140'), 'marigold and purple');
  const clean = stripScenery('A table with a sugar skull, a skeleton, an altar with marigolds, papel picado, a saint and a cross, soft light');
  for (const w of ['skull', 'skeleton', 'altar', 'saint', 'cross', 'marigold', 'papel']) assert.ok(!new RegExp(w, 'i').test(clean), `${w} removed: ${clean}`);
  assert.match(clean, /soft light/);
  for (const w of ['pumpkin', 'ghost', 'cobweb', 'bunny', 'easter egg', 'cupid', 'balloon', 'beach', 'blossom']) assert.ok(!new RegExp(w, 'i').test(stripScenery(`a calm wall with a ${w} on it`)), w);
});

test('every theme keeps the offer rule: an invented figure is rejected and a typed one is allowed, whatever the occasion', () => {
  for (const t of THEMES) {
    assert.deepEqual(inventedFigures('Half price today', ''), [], 'words without a figure pass');
    assert.deepEqual(inventedFigures('25% off', ''), ['25%'], `${t.id}: invented`);
    assert.deepEqual(inventedFigures('25% off', '25% off'), [], `${t.id}: typed`);
    assert.ok(copyProblems('Last chance, limited stock', '').length >= 1, `${t.id}: scarcity`);
  }
  for (const id of NEW_THEMES) assert.equal(checkOffer(themeById(id), '').ok, true, `${id} runs without an offer`);
  for (const id of NEW_THEMES) assert.equal(checkOffer(themeById(id), 'Limited stock').ok, false, `${id} refuses a scarcity offer`);
});

test('gift themes ask for the giftable angle; the others ask for the benefit angle', () => {
  for (const id of ['christmas', 'valentines', 'mothersday']) assert.deepEqual(anglesFor(id), ['verb', 'moment', 'gift'], id);
  for (const id of ['halloween', 'spring', 'summer', 'newyear', 'evergreen', undefined]) assert.deepEqual(anglesFor(id), ['verb', 'moment', 'benefit'], String(id));
});

test('a theme sets its palette on the ad: each new theme overrides the Look, brand colours still win, and the mood steers the copy', () => {
  for (const id of NEW_THEMES) {
    assert.deepEqual(styleFor({ look: 'quiet', theme: id }).colours, [...themeById(id).palette], id);
    assert.deepEqual(styleFor({ look: 'quiet', theme: id, brandColours: '#112233' }).colours, ['#112233']);
    assert.ok(styleVoice(styleFor({ look: 'loud', theme: id })).includes(`The mood of the occasion is ${themeById(id).mood}`), id);
  }
});

test('seven Looks, the new ones included, in the order the picker shows them', () => {
  assert.deepEqual(LOOKS.map((l) => l.name), ['Quiet Editorial', 'Loud Poster', 'Spec Sheet', 'Native Snap', 'Pop Art', 'Magazine Cover', 'Sticker Pack']);
  assert.equal(lookById('magazine').masthead, true);
  assert.equal(lookById('sticker').sticker, true);
  assert.equal(lookById('sticker').productPalette, true, 'a sticker takes its colour from the product');
  assert.equal(lookById('sticker').finish, 0, 'flat, no grading');
  for (const l of [lookById('magazine'), lookById('sticker')]) assert.ok(!/[–—]/.test(l.description + l.voice), l.id);
});

// Every Look is drawn on two real cut-outs with a short and a long headline, with the layout engine only: no model call.
const draw = (lookId, name, headline) => {
  const l = lookById(lookId);
  const archetype = l.layouts[0] === 'behind' ? 'behind' : 'product';
  return restyle({ archetype, plan: { headline, subline: 'Warm hands, calm mornings', cta: 'Shop now', badge: [], ctaScale: 1, gapScale: 1, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] }, brief: { clientName: 'Fernhill Home', look: lookId, theme: 'evergreen', facts: 'A plain white mug with a handle' }, cutoutPng: fixture(name), effect: undefined });
};

test('each Look renders without clipped text: the headline ink sits inside the frame with a margin, short or long', async () => {
  for (const l of LOOKS) {
    for (const [name, headline] of [['mug-white', 'Sip Slowly'], ['stool-wooden', 'Pull Up A Seat Today']]) {
      const r = await draw(l.id, name, headline);
      const b = r.layout.headlineBounds;
      assert.ok(b && b.right > b.left, `${l.id}: the headline was measured`);
      assert.ok(b.left >= 40 && b.right <= 1080 - 40, `${l.id} ${name}: headline ink ${b.left} to ${b.right} is inside the margins`);
      assert.ok(b.top >= 20 && b.bottom <= 1080 - 40, `${l.id} ${name}: headline rows ${b.top} to ${b.bottom} are inside the frame`);
      if (r.layout.headlineVisible) assert.ok(r.layout.headlineVisible.at(-1) >= 0.85 - 0.002, `${l.id}: the overlap guard holds`);
    }
  }
});

test('Magazine Cover: the masthead is one line, and the product overlaps the title within the guard', async () => {
  const r = await draw('magazine', 'stool-wooden', 'Pull Up A Seat Today');
  assert.equal(r.layout.headlineVisible.length, 1, 'one huge line across the top');
  assert.ok(r.layout.productTop < r.layout.textBottom, 'the product overlaps the title');
  assert.ok(r.layout.headlineVisible[0] >= 0.85 - 0.002, 'never more than the guard allows');
  const loud = await draw('loud', 'stool-wooden', 'Pull Up A Seat Today');
  assert.ok(loud.layout.headlineVisible.length >= 2, 'the Loud Poster stacks the same words in more lines');
});

test('Sticker Pack: one flat colour all over, and a thick white border round the product', async () => {
  const r = await draw('sticker', 'stool-wooden', 'Pull Up A Seat');
  const px = async (x, y) => (await sharp(r.png).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()).join(',');
  const corners = [await px(6, 540), await px(1070, 540), await px(540, 1040), await px(6, 700)];
  assert.equal(new Set(corners).size, 1, `a flat colour: ${corners.join(' | ')}`);
  const out = await sharp(r.png).extract({ left: Math.max(0, r.layout.productLeft - 9), top: r.layout.productTop + 20, width: 6, height: 60 }).removeAlpha().raw().toBuffer();
  let white = 0;
  for (let i = 0; i < out.length; i += 3) if (out[i] > 245 && out[i + 1] > 245 && out[i + 2] > 245) white++;
  assert.ok(white > 10, `the sticker border is white: ${white} white pixels beside the product`);
});

test('Magazine Cover: the shop name is a big masthead word across the top, the headline is the cover line, and nothing is clipped', async () => {
  const { mastheadWord } = await import('../../src/lib/meta/design/layouts.ts');
  assert.equal(mastheadWord('Fernhill Home'), 'Fernhill');
  assert.equal(mastheadWord('Go Mugs'), 'Go Mugs', 'a very short first word keeps the whole name');
  assert.equal(mastheadWord(''), null);
  for (const [name, headline] of [['mug-white', 'Pour And Rest'], ['stool-wooden', 'Pull Up A Seat Today'], ['notebook-black', 'Jot It Down']]) {
    const mag = await draw('magazine', name, headline);
    const b = mag.layout.headlineBounds;
    assert.ok(b.right - b.left >= 600, `${name}: the masthead word is large (${b.right - b.left} px wide)`);
    assert.ok(b.left >= 40 && b.right <= 1080 - 40 && b.top >= 20, `${name}: the masthead is inside the frame`);
    assert.ok(mag.layout.productTop < mag.layout.textBottom, `${name}: the product overlaps the masthead`);
    assert.ok(mag.layout.headlineVisible[0] >= 0.85 - 0.002, `${name}: the masthead stays readable`);
    const loud = await draw('loud', name, headline);
    assert.notDeepEqual(await sharp(mag.png).resize(64, 64).raw().toBuffer(), await sharp(loud.png).resize(64, 64).raw().toBuffer(), 'not the Loud Poster');
  }
});

test('Magazine Cover on the studio layout and on a whole photo also gets the masthead word and the cover line', async () => {
  const { mastheadWord } = await import('../../src/lib/meta/design/layouts.ts');
  const l = lookById('magazine');
  for (const name of ['mug-white', 'stool-wooden']) {
    const r = await restyle({ archetype: 'product', plan: { headline: 'Pour And Rest', subline: 'A handle on one side', cta: 'Shop now', badge: [], ctaScale: 1, gapScale: 1, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] }, brief: { clientName: 'Fernhill Home', look: l.id, theme: 'evergreen', facts: 'A plain white mug with a handle' }, cutoutPng: fixture(name), effect: undefined });
    const b = r.layout.headlineBounds;
    assert.ok(b && b.right - b.left >= 600, `${name}: the masthead word is large on the studio layout (${b && b.right - b.left} px)`);
    assert.ok(b.left >= 40 && b.right <= 1080 - 40, `${name}: inside the frame`);
    const loud = await restyle({ archetype: 'product', plan: { headline: 'Pour And Rest', subline: 'A handle on one side', cta: 'Shop now', badge: [], ctaScale: 1, gapScale: 1, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] }, brief: { clientName: 'Fernhill Home', look: 'loud', theme: 'evergreen', facts: 'A plain white mug with a handle' }, cutoutPng: fixture(name), effect: undefined });
    assert.notDeepEqual(await sharp(r.png).resize(64, 64).raw().toBuffer(), await sharp(loud.png).resize(64, 64).raw().toBuffer());
  }
  assert.equal(mastheadWord('Fernhill Home'), 'Fernhill');
});

test('with no subline nothing is drawn for it, the gap closes up, and every Look still renders cleanly', async () => {
  for (const l of LOOKS) {
    const archetype = l.layouts[0] === 'behind' ? 'behind' : 'product';
    const run = (subline) => restyle({ archetype, plan: { headline: 'Sip Slowly', subline, cta: 'Shop now', badge: [], ctaScale: 1, gapScale: 1, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] }, brief: { clientName: 'Fernhill Home', look: l.id, theme: 'evergreen', facts: '' }, cutoutPng: fixture('mug-white'), effect: undefined });
    const none = await run('');
    const some = await run('Made for slow mornings');
    assert.ok(none.png.length > 1000, `${l.id}: rendered`);
    const b = none.layout.headlineBounds;
    assert.ok(b.left >= 40 && b.right <= 1080 - 40, `${l.id}: the headline stays inside the frame`);
    if (archetype === 'product') assert.ok(none.layout.textBottom <= some.layout.textBottom, `${l.id}: the type block is shorter with no subline (${none.layout.textBottom} vs ${some.layout.textBottom})`);
    assert.notDeepEqual(await sharp(none.png).resize(64, 64).raw().toBuffer(), await sharp(some.png).resize(64, 64).raw().toBuffer(), `${l.id}: the subline is really left out`);
  }
});
