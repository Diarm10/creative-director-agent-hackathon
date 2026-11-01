// Looks, Themes and Effects: each Look, the Theme rules (a sale theme refuses to run without an offer, an invented figure is
// rejected, no scarcity or delivery claims, no seasonal scenery for the image model), effect purity, true colour by default,
// and the stylise warning.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';
process.env.DEMO_CODE = 'right-code';

import { LOOKS, lookById, resolveLook, calloutsFromFacts } from '../../src/lib/meta/looks.ts';
import { THEMES, themeById, checkOffer, inventedFigures, copyProblems, forbiddenClaim } from '../../src/lib/meta/themes.ts';
import { styleFor, stripScenery, effectFromRequest, styleVoice } from '../../src/lib/meta/style.ts';
import { directionForRound } from '../../src/lib/meta/directions.ts';
import { nextEffect } from '../../src/lib/catalogue/campaign.ts';
import { EFFECTS, STYLISED_NOTE, applyBackgroundEffect, productOutlineLayer, stylisedProduct, outlineRadius, effectGround } from '../../src/lib/meta/design/effects.ts';
import { renderDesign } from '../../src/lib/meta/design/layouts.ts';
import { makePalette, textOn } from '../../src/lib/meta/design/palette.ts';
import { fidelityPrompt } from '../../src/lib/meta/prompts.ts';

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}-cutout.png`, import.meta.url));
const FACT = 'A plain white mug with a handle on one side';

// ---- Looks ----------------------------------------------------------------------------------------

test('five Looks, each a named object with layouts, palette rule, type scale, finishing strength, copy voice and default effect', () => {
  assert.deepEqual(LOOKS.slice(0, 5).map((l) => l.id), ['quiet', 'loud', 'spec', 'native', 'pop']); // the first five; two more are tested in themes-looks-more
  assert.deepEqual(LOOKS.slice(0, 5).map((l) => l.name), ['Quiet Editorial', 'Loud Poster', 'Spec Sheet', 'Native Snap', 'Pop Art']);
  for (const l of LOOKS) {
    assert.ok(l.description.length > 20 && l.layouts.length >= 1 && l.voice.length > 10, l.id);
    assert.ok(l.typeScale > 0 && l.typeScale <= 1, `${l.id} type scale`);
    assert.ok(l.finish >= 0 && l.finish <= 1, `${l.id} finish`);
    assert.equal(l.swatch.length, 3);
    assert.ok(!/[–—]/.test(l.description + l.voice + l.name), `${l.id} has no dashes`);
  }
  assert.ok(lookById('native').finish <= 0.2, 'Native Snap: finishing pass at low strength');
  assert.equal(lookById('pop').finish, 0);
  assert.equal(lookById('pop').effect, 'popart');
  assert.equal(lookById('loud').layouts[0], 'behind', 'Loud Poster: type behind the product first');
  assert.ok(lookById('quiet').typeScale < lookById('loud').typeScale, 'Quiet Editorial has the small headline');
  assert.deepEqual(lookById('native').layouts, ['artwork', 'product'], 'Native Snap: the scene layout first');
  assert.deepEqual(lookById('quiet').layouts, ['product', 'artwork'], 'Quiet Editorial prefers studio and scene');
});

test('the Looks decide the round order: Loud Poster starts behind, Quiet starts studio, Native starts with the scene', () => {
  const first = (id, o = {}) => directionForRound('product', 1, { look: lookById(id), ...o })?.archetype;
  assert.equal(first('loud'), 'behind');
  assert.equal(first('quiet'), 'product');
  assert.equal(first('native'), 'artwork');
  assert.equal(first('pop'), 'product');
  assert.equal(first('loud', { behindOk: false }), 'product', 'a cut-out that cannot go behind the type falls back');
  assert.equal(directionForRound('product', 2, { look: lookById('loud'), panel: true }), null, 'a failed cut-out has the one studio design');
  assert.equal(directionForRound('product', 1, { look: lookById('loud'), panel: true }).archetype, 'product');
  assert.equal(directionForRound('product', 1).archetype, 'behind', 'with no Look the old order is unchanged');
});

test('Spec Sheet takes its callouts ONLY from the fact column, and with no fact it is Quiet Editorial', () => {
  const c = calloutsFromFacts(FACT);
  assert.deepEqual(c, ['Plain white mug', 'Handle on one side']);
  const factWords = new Set(FACT.toLowerCase().split(/\W+/));
  for (const callout of calloutsFromFacts('A silver steel bottle with a carry loop on the lid, a screw cap and a wide mouth')) {
    for (const w of callout.toLowerCase().split(/\W+/).filter(Boolean)) assert.ok('a silver steel bottle with a carry loop on the lid, a screw cap and a wide mouth'.split(/\W+/).includes(w), `"${w}" is not in the fact`);
  }
  assert.ok(calloutsFromFacts('one, two, three, four, five, six').length <= 3);
  assert.ok(calloutsFromFacts('A very long fact about a product that goes on and on and on without end').every((x) => x.length <= 30));
  assert.deepEqual(calloutsFromFacts(''), []);
  assert.deepEqual(calloutsFromFacts(undefined), []);
  assert.equal(resolveLook('spec', FACT).look.id, 'spec');
  const none = resolveLook('spec', '');
  assert.equal(none.look.id, 'quiet');
  assert.match(none.note, /Spec Sheet needs a fact/);
  assert.ok(factWords.size > 3);
  assert.deepEqual(styleFor({ look: 'spec', facts: '' }).callouts, [], 'no callouts without a fact');
  assert.equal(styleFor({ look: 'spec', facts: '' }).look.id, 'quiet');
  assert.deepEqual(styleFor({ look: 'quiet', facts: FACT }).callouts, [], 'only Spec Sheet draws callouts');
});

test('palette precedence: brand colours, then the Theme, then the Look; the Look sets finish, headline scale and effect', () => {
  assert.deepEqual(styleFor({ look: 'quiet' }).colours, [...lookById('quiet').palette]);
  assert.deepEqual(styleFor({ look: 'quiet', theme: 'christmas' }).colours, [...themeById('christmas').palette], 'the seasonal palette overrides the Look');
  assert.deepEqual(styleFor({ look: 'quiet', theme: 'evergreen' }).colours, [...lookById('quiet').palette], 'Evergreen has no palette of its own');
  assert.deepEqual(styleFor({ look: 'quiet', theme: 'christmas', brandColours: 'our blue is #112233' }).colours, ['#112233'], 'the client\'s own colours win');
  assert.deepEqual(styleFor({}).colours, [], 'nothing chosen leaves the planner\'s colours');
  const pop = styleFor({ look: 'pop' });
  assert.equal(pop.effect.id, 'popart');
  assert.equal(styleFor({ look: 'pop', effect: null }).effect, null, 'an explicit "none" wins over the Look\'s default');
  assert.equal(styleFor({ look: 'quiet', effect: { id: 'duotone', intensity: 40 } }).effect.id, 'duotone');
  assert.equal(styleFor({ look: 'quiet' }).headScale, 0.72);
  assert.equal(styleFor({ look: 'native' }).finish, 0.15);
  assert.match(styleVoice(styleFor({ look: 'loud', theme: 'christmas' })), /at most three words.*Christmas gifting/s);
  assert.deepEqual(effectFromRequest('none'), null);
  assert.equal(effectFromRequest(undefined), undefined);
  assert.deepEqual(effectFromRequest({ id: 'neon', intensity: 250, stylise: true }), { id: 'neon', intensity: 100, stylise: true });
  assert.equal(effectFromRequest({ id: 'bogus' }), undefined);
});

// ---- Themes ---------------------------------------------------------------------------------------

test('four Themes; the sale ones need an offer, the others do not', () => {
  const four = ['christmas', 'blackfriday', 'autumn', 'evergreen'].map((id) => themeById(id));
  assert.deepEqual(four.map((t) => t.name), ['Christmas', 'Black Friday', 'Autumn Sale', 'Evergreen']);
  assert.deepEqual(four.map((t) => t.needsOffer), [false, true, true, false]);
  assert.equal(themeById('evergreen').palette, null);
  for (const t of THEMES) assert.ok(!/[–—]/.test(t.description + t.angle + t.cta), t.id);
});

test('a sale theme refuses to run without an offer; the others run without one', () => {
  for (const id of ['blackfriday', 'autumn']) {
    const none = checkOffer(themeById(id), '');
    assert.equal(none.ok, false);
    assert.match(none.error, /sale theme\. Type the offer yourself/);
    assert.equal(checkOffer(themeById(id), '   ').ok, false, 'spaces are not an offer');
    assert.equal(checkOffer(themeById(id), undefined).ok, false);
    assert.equal(checkOffer(themeById(id), '15% off all mugs').ok, true);
  }
  assert.equal(checkOffer(themeById('christmas'), '').ok, true);
  assert.equal(checkOffer(themeById('evergreen'), undefined).ok, true);
  assert.equal(checkOffer(null, '').ok, true);
  assert.equal(checkOffer(themeById('autumn'), '  10%   off   ').offer, '10% off', 'the offer is kept as typed, only tidied');
});

test('an invented percentage, price, code or date is rejected; the typed ones are allowed', () => {
  assert.deepEqual(inventedFigures('20% off every mug', ''), ['20%']);
  assert.deepEqual(inventedFigures('20% off every mug', '15% off all mugs'), ['20%'], 'a different percentage is invented');
  assert.deepEqual(inventedFigures('15% off every mug', '15% off all mugs'), []);
  assert.deepEqual(inventedFigures('Mugs from €9', 'Mugs from €9'), []);
  assert.deepEqual(inventedFigures('Mugs from €9', ''), ['€9']);
  assert.deepEqual(inventedFigures('Use code SAVE20 at checkout', 'code SAVE20'), []);
  assert.equal(inventedFigures('Use code SAVE20', 'code SAVE10').length, 1);
  assert.equal(inventedFigures('Sale ends 30 November', '').length, 1);
  assert.deepEqual(inventedFigures('Sale ends 30 November', 'Ends 30 November'), []);
  assert.deepEqual(inventedFigures('A plain white mug with a handle', ''), []);
  assert.match(copyProblems('Black Friday: 40% off', '15% off')[0], /"40%".*not in the offer you typed/);
  assert.deepEqual(copyProblems('Black Friday: 15% off', '15% off'), []);
});

test('no scarcity and no delivery claims, in the offer or in the copy', () => {
  for (const bad of ['Limited stock', 'while stocks last', 'Last chance to buy', 'Only 3 left', 'Hurry, selling fast', 'Sale ends tonight', 'Delivered by 24 December', 'Order by Friday', 'In time for Christmas', 'Arrives by the 23rd', 'Next day delivery']) {
    assert.ok(forbiddenClaim(bad), `"${bad}" is refused`);
    assert.equal(checkOffer(themeById('blackfriday'), bad).ok, false, `"${bad}" is not accepted as an offer`);
  }
  assert.equal(forbiddenClaim('A plain white mug'), null);
  assert.match(checkOffer(themeById('blackfriday'), 'Limited stock, 20% off').error, /never claim scarcity or a delivery date/);
  assert.match(copyProblems('Last chance for gifts', '')[0], /never claim scarcity/);
});

test('the seasonal feel is palette, layout and copy: the scene prompt never carries snow, baubles or any prop', () => {
  const out = stripScenery('A wooden table with snow falling, baubles and a Christmas tree, soft light');
  assert.ok(!/snow|bauble|christmas tree/i.test(out), out);
  assert.match(out, /wooden table/);
  assert.match(out, /soft light/);
  assert.equal(stripScenery('A calm wall and soft light'), 'A calm wall and soft light', 'a clean prompt is untouched');
});

// ---- the API enforces the offer rule ---------------------------------------------------------------

let lastBrief = null;
mock.module('../../src/lib/meta/loop.ts', {
  namedExports: {
    runCreativeLoop: async (brief, emit) => { lastBrief = brief; emit({ type: 'run_started' }); return { concepts: [{ round: 1, imageB64: 'aW1n', imageMime: 'image/jpeg', headline: 'H', body: 'B', score: 9 }], finalPickIndex: 0 }; },
    runRevision: async () => ({ concepts: [], finalPickIndex: 0 }),
  },
});
const { default: handler } = await import('../../api/run.ts');
const fakeRes = () => { const r = { statusCode: 200, chunks: [], jsonBody: null, status(c) { r.statusCode = c; return r; }, setHeader() {}, flushHeaders() {}, write(c) { r.chunks.push(c); return true; }, json(b) { r.jsonBody = b; return r; }, end() { return r; } }; return r; };
let ipn = 0;
const call = (body) => { const res = fakeRes(); return handler({ method: 'POST', headers: { 'x-demo-code': 'right-code', 'x-forwarded-for': `10.7.0.${++ipn}` }, body }, res).then(() => res); };
const product = { briefType: 'product', catalogue: true, quick: true, productNoun: 'mug', productImageUrl: 'data:image/jpeg;base64,ZmFrZQ==', audience: 'online shoppers' };

test('api: Black Friday without an offer is refused with a plain message and nothing is run', async () => {
  lastBrief = null;
  const res = await call({ ...product, theme: 'blackfriday' });
  assert.equal(res.statusCode, 400);
  assert.match(res.jsonBody.error, /sale theme/);
  assert.equal(lastBrief, null, 'the run never started');
  assert.equal((await call({ ...product, theme: 'autumn', offer: '  ' })).statusCode, 400);
});

test('api: a typed offer reaches the run as typed, a scarcity offer is refused, and unknown ids are refused', async () => {
  const ok = await call({ ...product, theme: 'blackfriday', offer: '20% off all mugs', look: 'pop', effect: { id: 'popart', intensity: 80 } });
  assert.equal(ok.statusCode, 200);
  assert.equal(lastBrief.offer, '20% off all mugs');
  assert.equal(lastBrief.theme, 'blackfriday');
  assert.equal(lastBrief.look, 'pop');
  assert.deepEqual(lastBrief.effect, { id: 'popart', intensity: 80 });
  assert.equal((await call({ ...product, theme: 'blackfriday', offer: 'Limited stock only' })).statusCode, 400);
  assert.equal((await call({ ...product, look: 'nope' })).statusCode, 400);
  assert.equal((await call({ ...product, theme: 'nope' })).statusCode, 400);
  assert.equal((await call({ ...product, effect: { id: 'nope' } })).statusCode, 400);
  const none = await call({ ...product, effect: 'none' });
  assert.equal(none.statusCode, 200);
  assert.equal(lastBrief.effect, null);
  const christmas = await call({ ...product, theme: 'christmas' });
  assert.equal(christmas.statusCode, 200, 'Christmas runs without an offer');
});

// ---- Effects --------------------------------------------------------------------------------------

const PAL = makePalette(['#111111', '#FFF4D6', '#FF3B5C', '#FFD400']);
const COL = { dark: PAL.dark, light: PAL.light, accent: PAL.accents[0], accent2: PAL.accents[1] };

test('four effects, and each is pure: the same input gives the same bytes', async () => {
  assert.deepEqual(EFFECTS.map((e) => e.id), ['popart', 'duotone', 'halftone', 'neon']);
  const ground = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#335577' } }).composite([{ input: await sharp({ create: { width: 120, height: 120, channels: 3, background: '#cc9966' } }).png().toBuffer(), left: 90, top: 90 }]).png().toBuffer();
  for (const e of EFFECTS) {
    const spec = { id: e.id, intensity: 60 };
    const a = await applyBackgroundEffect(ground, spec, COL, { cx: 150, cy: 150, r: 80 });
    const b = await applyBackgroundEffect(ground, spec, COL, { cx: 150, cy: 150, r: 80 });
    assert.ok(a.equals(b), `${e.id} background is identical twice`);
    assert.ok(!a.equals(ground), `${e.id} changes the background`);
    const prod = fixture('mug-white');
    const s1 = await stylisedProduct(prod, spec, COL);
    assert.ok(s1.equals(await stylisedProduct(prod, spec, COL)), `${e.id} stylise is identical twice`);
    const o1 = await productOutlineLayer(prod, spec, COL, 1);
    const o2 = await productOutlineLayer(prod, spec, COL, 1);
    assert.equal(!!o1, e.id === 'neon', `${e.id}: only Neon Outline has an outline layer`);
    if (o1) assert.ok(o1.png.equals(o2.png), `${e.id} outline is identical twice`);
  }
});

test('intensity 0 changes nothing, and intensity scales the change', async () => {
  const ground = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#335577' } }).png().toBuffer();
  for (const e of EFFECTS) assert.ok((await applyBackgroundEffect(ground, { id: e.id, intensity: 0 }, COL, { cx: 100, cy: 100, r: 50 })).equals(ground), `${e.id} at 0`);
  const diff = async (i) => {
    const out = await applyBackgroundEffect(ground, { id: 'duotone', intensity: i }, COL, { cx: 100, cy: 100, r: 50 });
    const a = await sharp(ground).removeAlpha().raw().toBuffer();
    const b = await sharp(out).removeAlpha().raw().toBuffer();
    let d = 0;
    for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k]);
    return d;
  };
  assert.ok((await diff(80)) > (await diff(30)), 'a higher intensity changes more');
  assert.equal(outlineRadius({ id: 'duotone', intensity: 100 }, 1), 0);
  assert.equal(effectGround({ id: 'neon', intensity: 50 }), 'dark');
  assert.equal(effectGround({ id: 'halftone', intensity: 50 }), 'light');
  assert.equal(effectGround({ id: 'neon', intensity: 0 }), null);
});

const render = (a, effect) => {
  let layout;
  return renderDesign({ archetype: a, width: 1080, height: 1080, palette: PAL, product: fixture('mug-white'), organiser: 'Fernhill Home', headline: 'Plain White Mug', subline: 'A plain mug', cta: 'Shop now', finish: 0, effect, onLayout: (l) => (layout = l) }).then((png) => ({ png, layout }));
};
const centre = async (png, l) => (await sharp(png).extract({ left: Math.round((l.productLeft + l.productRight) / 2), top: Math.round(l.productTop + (l.productBottom - l.productTop) * 0.6), width: 1, height: 1 }).removeAlpha().raw().toBuffer()).join(',');

test('true colour by default: an effect changes the background but not one pixel of the product; Stylise recolours it', async () => {
  for (const a of ['product', 'behind']) {
    const plain = await render(a, undefined);
    const fx = await render(a, { id: 'popart', intensity: 90 });
    const stylised = await render(a, { id: 'popart', intensity: 90, stylise: true });
    assert.equal(await centre(fx.png, fx.layout), await centre(plain.png, plain.layout), `${a}: the product keeps its true colour under an effect`);
    assert.notEqual(await centre(stylised.png, stylised.layout), await centre(plain.png, plain.layout), `${a}: Stylise changes the product colour`);
    const corner = async (png) => (await sharp(png).extract({ left: 6, top: 540, width: 1, height: 1 }).removeAlpha().raw().toBuffer()).join(',');
    assert.notEqual(await corner(fx.png), await corner(plain.png), `${a}: the background changed`);
  }
});

test('an effect never touches text: every pixel of the headline colour is in the same place with and without Pop Art', async () => {
  const plain = await render('product', undefined);
  const fx = await render('product', { id: 'popart', intensity: 100 });
  // The studio layout puts a light product on the dark colour, so the type is the palette's text-on-dark colour.
  const ink = textOn(PAL.dark, PAL);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
  const region = { left: 0, top: Math.round(plain.layout.textTop), width: 1080, height: Math.round(plain.layout.headSize * 1.2) };
  const mask = async (png) => {
    const d = await sharp(png).extract(region).removeAlpha().raw().toBuffer();
    const out = [];
    for (let i = 0; i < d.length; i += 3) out.push(Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) <= 6 ? 1 : 0);
    return out;
  };
  const a = await mask(plain.png);
  const c = await mask(fx.png);
  const inkPixels = a.reduce((x, y) => x + y, 0);
  assert.ok(inkPixels > 3000, `the headline is there (${inkPixels} pixels)`);
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] && c[i]) same++;
  assert.ok(same / inkPixels > 0.98, `the headline pixels stay put: ${same} of ${inkPixels}`);
});

test('the overlap guard still holds with a thick Pop Art outline: the last headline line stays at least 85 percent visible', async () => {
  const { layout } = await render('behind', { id: 'popart', intensity: 100 });
  assert.ok(layout.headlineVisible.at(-1) >= 0.85 - 0.002, `${layout.headlineVisible}`);
});

test('the stylise warning is plain words, and the fidelity check then compares shape only', () => {
  assert.equal(STYLISED_NOTE, 'Stylised: the product colour was changed on purpose.');
  assert.ok(!/[–—]/.test(STYLISED_NOTE));
  const shape = fidelityPrompt([], true);
  assert.match(shape, /IGNORE every colour difference/);
  assert.match(shape, /only the SHAPE and proportions/);
  assert.ok(!/different colour,/.test(shape), 'colour is no longer a reason to fail');
  assert.match(fidelityPrompt([], false), /a different colour, shape, material/, 'the normal check still compares colour');
});

test('Spec Sheet callouts are drawn on the studio layout, from the fact only', async () => {
  const withC = await renderDesign({ archetype: 'product', width: 1080, height: 1080, palette: PAL, product: fixture('mug-white'), headline: 'Plain White Mug', subline: 'x', cta: 'Shop now', callouts: calloutsFromFacts(FACT), finish: 0 });
  const without = await renderDesign({ archetype: 'product', width: 1080, height: 1080, palette: PAL, product: fixture('mug-white'), headline: 'Plain White Mug', subline: 'x', cta: 'Shop now', finish: 0 });
  assert.ok(!withC.equals(without), 'the callouts change the picture');
});

// ---- Try another effect: no model call ------------------------------------------------------------

import { restyle } from '../../src/lib/meta/restyle.ts';
const { default: effectHandler } = await import('../../api/effect.ts');

test('nextEffect goes round every effect and then none', () => {
  const ids = EFFECTS.map((e) => e.id);
  assert.equal(nextEffect(null, ids), 'popart', 'from none to the first effect');
  assert.equal(nextEffect({ id: 'popart' }, ids), 'duotone');
  assert.equal(nextEffect({ id: 'neon' }, ids), 'none');
});

const PLAN = { headline: 'Plain White Mug', subline: 'A plain mug', cta: 'Shop now', badge: [], ctaScale: 1, gapScale: 1, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] };

test('restyle draws the same ad with another effect, with no model call, and runs the safeguards again', async () => {
  const brief = { clientName: 'Fernhill Home', look: 'loud', theme: 'evergreen' };
  const plain = await restyle({ archetype: 'behind', plan: PLAN, brief, cutoutPng: fixture('mug-white'), effect: null });
  const pop = await restyle({ archetype: 'behind', plan: PLAN, brief, cutoutPng: fixture('mug-white'), effect: { id: 'popart', intensity: 80 } });
  assert.ok(!plain.png.equals(pop.png), 'the effect changes the picture');
  assert.ok(pop.checks.some((c) => /claim words were checked again/.test(c)));
  assert.ok(pop.checks.some((c) => /overlap guard measured the headline again/.test(c)));
  assert.ok(pop.layout.headlineVisible.at(-1) >= 0.85 - 0.002);
});

test('restyle refuses copy that breaks the figure rule instead of redrawing it', async () => {
  await assert.rejects(
    restyle({ archetype: 'product', plan: { ...PLAN, headline: '40% off every mug' }, brief: { clientName: 'Shop', theme: 'blackfriday', offer: '15% off' }, cutoutPng: fixture('mug-white'), effect: { id: 'duotone', intensity: 50 } }),
    /breaks a rule.*"40%"/,
  );
});

test('api/effect: a valid request returns a picture and the checks, and the bad ones are refused', async () => {
  const cutoutB64 = fixture('mug-white').toString('base64');
  const good = fakeRes();
  await effectHandler({ method: 'POST', headers: { 'x-demo-code': 'right-code', 'x-forwarded-for': '10.8.0.1' }, body: { concept: { archetype: 'behind', headline: 'Plain White Mug', body: 'A plain mug', cta: 'Shop now', plan: {} }, brief: { clientName: 'Fernhill Home', look: 'loud', theme: 'evergreen' }, cutoutB64, effect: { id: 'neon', intensity: 70 } } }, good);
  assert.equal(good.statusCode, 200, JSON.stringify(good.jsonBody));
  assert.equal(Buffer.from(good.jsonBody.imageB64, 'base64')[0], 0xff, 'a JPEG');
  assert.deepEqual(good.jsonBody.effect, { id: 'neon', intensity: 70 });
  assert.ok(good.jsonBody.checks.length >= 1);
  const bad = fakeRes();
  await effectHandler({ method: 'POST', headers: { 'x-demo-code': 'right-code', 'x-forwarded-for': '10.8.0.2' }, body: { concept: { archetype: 'artwork', headline: 'x' }, cutoutB64, effect: 'none' } }, bad);
  assert.equal(bad.statusCode, 400);
  const wrong = fakeRes();
  await effectHandler({ method: 'POST', headers: { 'x-demo-code': 'nope', 'x-forwarded-for': '10.8.0.3' }, body: {} }, wrong);
  assert.equal(wrong.statusCode, 401);
});

// ---- Pop Art: the palette comes from the product, and the outline is thin, offset and broken ------

import { popPalette, productColours } from '../../src/lib/meta/design/popPalette.ts';
import { burstColour, popBurst, popDotScale } from '../../src/lib/meta/design/effects.ts';

const swatchPng = (colour) => sharp({ create: { width: 80, height: 80, channels: 4, background: colour } }).png().toBuffer();

test('Pop Art palette: a white or black product gets the restrained two-tone, in a muted tint', async () => {
  for (const c of ['#f4f4f4', '#151515', '#9a9a9a', '#d8c9b0']) {
    const pc = await productColours(await swatchPng(c));
    assert.equal(pc.neutral, true, `${c} is neutral`);
    const p = popPalette(pc);
    assert.equal(p.muted, true, `${c}: the restrained version`);
    assert.equal(p.colours.length, 4);
    // No loud colour: every accent is low in saturation.
    for (const a of p.colours.slice(2)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
      assert.ok((Math.max(r, g, b) - Math.min(r, g, b)) / 255 < 0.3, `${c}: accent ${a} is muted`);
    }
  }
  // The real white mug cut-out.
  const mug = popPalette(await productColours(fixture('mug-white')));
  assert.equal(mug.muted, true, 'a plain white mug does not get a loud comic palette');
});

test('Pop Art palette: a coloured product contributes its own colour, with a contrasting accent and two neutrals', async () => {
  const red = popPalette(await productColours(await swatchPng('#c8321e')));
  assert.equal(red.muted, false);
  const [dark, light, own, accent] = red.colours;
  assert.ok(luminanceOf(dark) < 0.15 && luminanceOf(light) > 0.8, 'a dark and a light neutral');
  const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; if (!d) return 0; const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
  assert.ok(Math.min(Math.abs(hue(own) - hue('#c8321e')), 360 - Math.abs(hue(own) - hue('#c8321e'))) < 20, `own colour ${own} keeps the product's hue`);
  const gap = Math.abs(hue(accent) - hue(own));
  assert.ok(Math.min(gap, 360 - gap) > 140, `the accent ${accent} is the opposite hue`);
  const stool = popPalette(await productColours(fixture('stool-wooden')));
  assert.equal(stool.muted, false, 'brown wood is a colour, not a neutral');
});
function luminanceOf(hex) { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

test('the styling takes the Pop palette from the product only when the client and the Theme set none', () => {
  assert.equal(styleFor({ look: 'pop', theme: 'evergreen' }).productPalette, true);
  assert.deepEqual(styleFor({ look: 'pop', theme: 'evergreen' }).colours, []);
  assert.equal(styleFor({ look: 'pop', theme: 'christmas' }).productPalette, false, 'a seasonal palette wins');
  assert.equal(styleFor({ look: 'pop', brandColours: '#112233' }).productPalette, false, 'the client\'s colours win');
  assert.equal(styleFor({ look: 'quiet' }).productPalette, false);
});

test('Pop Art draws no outline round the product: only Neon Outline has one', async () => {
  const prod = fixture('mug-white');
  for (const id of ['popart', 'duotone', 'halftone']) assert.equal(await productOutlineLayer(prod, { id, intensity: 100 }, COL, 1), null, `${id} has no outline layer`);
  assert.ok(await productOutlineLayer(prod, { id: 'neon', intensity: 100 }, COL, 1), 'Neon Outline keeps its glowing line');
  assert.equal(outlineRadius({ id: 'popart', intensity: 100 }, 1), 0, 'the overlap guard has no outline to allow for');
  assert.ok(outlineRadius({ id: 'neon', intensity: 100 }, 1) > 0);
  // And a whole Pop Art render has the product's edge pixels untouched: no dark or light line sits against the silhouette.
  const plain = await render('product', undefined);
  const pop = await render('product', { id: 'popart', intensity: 100 });
  const l = pop.layout;
  const ring = async (png) => (await sharp(png).extract({ left: l.productLeft - 6, top: Math.round((l.productTop + l.productBottom) / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer()).join(',');
  assert.notEqual(await ring(pop.png), '0,0,0', 'no black line against the product');
  assert.ok(plain.png.length > 0);
});

test('Pop Art dots are largest near the product and fade outward; the burst is centred behind the product', () => {
  const R = 200;
  assert.equal(popDotScale(R, R, 1080), 1, 'full size at the product edge');
  assert.equal(popDotScale(50, R, 1080), 1, 'and inside it');
  let last = 1;
  for (const d of [250, 350, 500, 700, 1000]) {
    const sc = popDotScale(d, R, 1080);
    assert.ok(sc < last + 1e-9, `${d}: smaller than closer in`);
    last = sc;
  }
  assert.ok(popDotScale(1000, R, 1080) < 0.5, 'small far away');
  assert.ok(popDotScale(5000, R, 1080) >= 0.15, 'never to nothing');
  for (const cx of [300, 540, 800]) {
    const a = { cx, cy: 600, r: R };
    const b = popBurst(a, 1080);
    assert.equal(b.cx, a.cx, 'the burst is centred behind the product');
    assert.equal(b.cy, a.cy);
    assert.ok(b.r > R && b.r <= 1.5 * R, 'it reaches past the product but is not a big ring');
  }
});

test('Pop Art on a neutral product draws a muted burst and dots; on a coloured product it is stronger', async () => {
  const ground = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#8899aa' } }).png().toBuffer();
  const spec = { id: 'popart', intensity: 80 };
  const strong = await applyBackgroundEffect(ground, spec, { ...COL, muted: false }, { cx: 200, cy: 200, r: 100 });
  const muted = await applyBackgroundEffect(ground, spec, { ...COL, muted: true }, { cx: 200, cy: 200, r: 100 });
  const dist = async (a) => { const x = await sharp(ground).removeAlpha().raw().toBuffer(); const y = await sharp(a).removeAlpha().raw().toBuffer(); let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); return d; };
  assert.ok((await dist(muted)) < (await dist(strong)), 'the muted version changes the background less');
});

test('the Pop Art burst colour always stands out from the ground, and never sinks into it', () => {
  const palette = { accent: '#7A7A2A', accent2: '#6B7B2B', light: '#F4EFE0', dark: '#0E2A1E' };
  for (const ground of ['#143D2B', '#C4161C', '#F3EBDD', '#6E6E5A', '#222222']) {
    const c = burstColour(ground, palette);
    const lin = (h) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; const n = parseInt(h.slice(1), 16); return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
    const r = (Math.max(lin(c), lin(ground)) + 0.05) / (Math.min(lin(c), lin(ground)) + 0.05);
    assert.ok(r >= 3, `${ground}: ${c} has contrast ${r.toFixed(1)}`);
  }
});
