// The campaign pack: three sizes and the copy in one ZIP. Designs that need no new picture are drawn again at each
// size with no model call; a design built on a generated picture keeps its one size and the pack says so.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';

// Any model call would go through this module. Counting its calls proves the pack makes none.
const modelCalls = { n: 0 };
const counted = (name) => async () => { modelCalls.n += 1; throw new Error(`${name} must not be called by the pack`); };
mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'x', image: 'x', segment: 'x' },
    meta: { responses: { create: counted('responses.create') }, images: { generate: counted('images.generate'), edit: counted('images.edit') } },
    text: counted('text'), generateImage: counted('generateImage'), editImage: counted('editImage'), ImageBudget: class {}, hasMetaKey: () => true,
  },
});

const { renderPack, copyText } = await import('../../src/lib/meta/pack.ts');
const { packAvailability } = await import('../../src/lib/meta/packInfo.ts');
const { renderDesign } = await import('../../src/lib/meta/design/layouts.ts');
const { makePalette } = await import('../../src/lib/meta/design/palette.ts');

const palette = makePalette(['#C9683A', '#F1EDE6', '#1B2A38']);
const plan = { archetype: 'typographic', artPrompt: '', pattern: 'grid', variant: 'block', colours: [], badge: [], ctaScale: 1, gapScale: 1 };
const brief = { briefType: 'event', clientName: 'Another World Events', eventDate: 'Thu 20 Nov, 7pm', eventPlace: undefined, brandColours: ['#C9683A', '#F1EDE6', '#1B2A38'] };
const cutout = await sharp({ create: { width: 500, height: 420, channels: 4, background: { r: 30, g: 40, b: 60, alpha: 1 } } })
  .composite([{ input: Buffer.from('<svg width="500" height="420"><rect width="500" height="420" rx="120" fill="#1E2A3C"/></svg>') }]).png().toBuffer();

async function design(archetype, w = 1080, h = 1080) {
  const base = { width: w, height: h, palette, headline: 'Build for Your World', subline: 'For programmers', organiser: 'Another World Events', details: ['Thu 20 Nov, 7pm'], cta: 'Join us', badge: [] };
  const png = archetype === 'typographic'
    ? await renderDesign({ ...base, archetype: 'typographic', seed: 7 + brief.clientName.length, pattern: 'grid', variant: 'block' })
    : archetype === 'artwork'
      ? await renderDesign({ ...base, archetype: 'typographic', seed: 3 }) // any picture will do for "a generated picture"
      : await renderDesign({ ...base, archetype: 'behind', product: cutout });
  return (await sharp(png).jpeg({ quality: 80 }).toBuffer()).toString('base64');
}
const concept = async (archetype, extra = {}, w, h) => ({ round: 1, archetype, headline: 'Build for Your World', body: 'For programmers', cta: 'Join us', plan: { ...plan, archetype }, imageB64: await design(archetype, w, h), ...extra });
const dims = async (bytes) => { const m = await sharp(Buffer.from(bytes)).metadata(); return [m.width, m.height, m.format]; };

test('a typographic design is drawn again at story and poster size, the square is the design as it was made, and copy.txt has the words', async () => {
  const c = await concept('typographic');
  const { zip, sizes } = await renderPack({ concept: c, brief });
  const files = unzipSync(new Uint8Array(zip));
  assert.deepEqual(Object.keys(files).sort(), ['copy.txt', 'poster-1200x1800.jpg', 'square-1080x1080.jpg', 'story-1080x1920.jpg']);
  assert.deepEqual(await dims(files['square-1080x1080.jpg']), [1080, 1080, 'jpeg']);
  assert.deepEqual(await dims(files['story-1080x1920.jpg']), [1080, 1920, 'jpeg']);
  assert.deepEqual(await dims(files['poster-1200x1800.jpg']), [1200, 1800, 'jpeg']);
  assert.deepEqual(Buffer.from(files['square-1080x1080.jpg']), Buffer.from(c.imageB64, 'base64'), 'byte for byte the design the person chose');
  assert.deepEqual(sizes.map((s) => s.how), ['original', 'redrawn', 'redrawn']);
  const copy = strFromU8(files['copy.txt']);
  assert.match(copy, /Headline: Build for Your World/);
  assert.match(copy, /Subline: For programmers/);
  assert.match(copy, /Call to action: Join us/);
  assert.match(copy, /Details: Thu 20 Nov, 7pm/);
});

test('type behind the product is drawn again at every size from the cut-out, with no model call', async () => {
  const c = await concept('behind');
  const { zip, sizes } = await renderPack({ concept: c, brief: { ...brief, briefType: 'product' }, cutoutPng: cutout });
  const files = unzipSync(new Uint8Array(zip));
  assert.deepEqual(await dims(files['story-1080x1920.jpg']), [1080, 1920, 'jpeg']);
  assert.deepEqual(await dims(files['poster-1200x1800.jpg']), [1200, 1800, 'jpeg']);
  assert.deepEqual(sizes.map((s) => s.how), ['original', 'redrawn', 'redrawn']);
  assert.notDeepEqual(Buffer.from(files['story-1080x1920.jpg']), Buffer.from(files['poster-1200x1800.jpg']));
});

test('a design that needs the cut-out says so when it was not sent, and still gives the square', async () => {
  const { zip, sizes } = await renderPack({ concept: await concept('behind'), brief: { ...brief, briefType: 'product' } });
  const files = unzipSync(new Uint8Array(zip));
  assert.deepEqual(Object.keys(files).sort(), ['copy.txt', 'square-1080x1080.jpg']);
  assert.equal(sizes[1].how, 'not available');
  assert.match(sizes[1].reason, /cut-out was not sent/);
});

test('a design built on a generated picture keeps its one size, and the pack says plainly which sizes are missing and why', async () => {
  const { zip, sizes } = await renderPack({ concept: await concept('artwork'), brief });
  const files = unzipSync(new Uint8Array(zip));
  assert.deepEqual(Object.keys(files).sort(), ['copy.txt', 'square-1080x1080.jpg']);
  assert.deepEqual(sizes.map((s) => s.how), ['original', 'not available', 'not available']);
  const copy = strFromU8(files['copy.txt']);
  assert.match(copy, /story 1080 x 1920: not available, this design is built on a generated picture/);
  assert.match(copy, /poster 1200 x 1800: not available/);
  assert.deepEqual(packAvailability('artwork').map((s) => s.available), [true, false, false]);
  assert.deepEqual(packAvailability('typographic').map((s) => s.available), [true, true, true]);
});

test('a design made at story size is kept as it is, and the square is drawn again', async () => {
  const c = await concept('typographic', {}, 1080, 1920);
  const { zip, sizes } = await renderPack({ concept: c, brief });
  const files = unzipSync(new Uint8Array(zip));
  assert.deepEqual(sizes.map((s) => s.how), ['redrawn', 'original', 'redrawn']);
  assert.deepEqual(Buffer.from(files['story-1080x1920.jpg']), Buffer.from(c.imageB64, 'base64'));
  assert.deepEqual(await dims(files['square-1080x1080.jpg']), [1080, 1080, 'jpeg']);
});

test('copyText lists what each file is, and uses no dashes', async () => {
  const text = copyText(await concept('artwork'), brief, [
    { id: 'square', width: 1080, height: 1080, file: 'square-1080x1080.jpg', how: 'original' },
    { id: 'story', width: 1080, height: 1920, file: null, how: 'not available', reason: 'no new picture' },
  ]);
  assert.match(text, /square-1080x1080.jpg \(1080 x 1080, original\)/);
  assert.ok(!new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']').test(text));
});

test('no model was called while making any of these packs', () => {
  assert.equal(modelCalls.n, 0);
});
