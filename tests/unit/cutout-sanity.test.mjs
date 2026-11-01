// The cut-out sanity check: a good mask passes; a half mask, a split mask and one cut off by the frame fail;
// and a failed cut-out is never used: the run lays out the whole original photo on the studio layout and says so.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';

const W = 800;
const H = 600;
// The product sits at (250,100) and is 300 by 400: green leaves on the top 40 percent, a white pot below, on a plain grey wall.
const PRODUCT = { left: 250, top: 100, width: 300, height: 400 };
async function photo() {
  const leaves = await sharp({ create: { width: 300, height: 160, channels: 3, background: { r: 40, g: 140, b: 60 } } }).png().toBuffer();
  const pot = await sharp({ create: { width: 300, height: 240, channels: 3, background: { r: 250, g: 250, b: 250 } } }).png().toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 120, g: 120, b: 120 } } })
    .composite([{ input: leaves, left: 250, top: 100 }, { input: pot, left: 250, top: 260 }]).png().toBuffer();
}
// A cut-out of the given rectangles (in photo pixels), as a transparent PNG trimmed to their bounding box.
async function cutout(rects) {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  const w = right - left;
  const h = bottom - top;
  const raw = Buffer.alloc(w * h * 4, 0);
  for (const r of rects) {
    for (let y = r.top - top; y < r.top - top + r.height; y++) {
      for (let x = r.left - left; x < r.left - left + r.width; x++) {
        const i = (y * w + x) * 4;
        raw[i] = 90; raw[i + 1] = 90; raw[i + 2] = 90; raw[i + 3] = 255;
      }
    }
  }
  return { png: await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer(), box: { left, top, width: w, height: h } };
}

const { cutoutSanity, photoAsPanel, PANEL_NOTE } = await import('../../src/lib/meta/cutoutSanity.ts');

test('a good mask that covers the whole product passes, and the coverage is measured', async () => {
  const c = await cutout([PRODUCT]);
  const v = await cutoutSanity({ cutoutPng: c.png, box: c.box, photoPng: await photo() });
  assert.equal(v.ok, true, v.reason ?? '');
  assert.ok(v.coverage > 0.9, `coverage ${v.coverage}`);
  assert.equal(v.pieces, 1);
});

test('a half mask (the plant lost, half the pot kept) fails as far too small', async () => {
  const c = await cutout([{ left: 250, top: 380, width: 300, height: 120 }]);
  const v = await cutoutSanity({ cutoutPng: c.png, box: c.box, photoPng: await photo() });
  assert.equal(v.ok, false);
  assert.equal(v.failure, 'small');
  assert.ok(v.coverage < 0.55, `coverage ${v.coverage}`);
  assert.match(v.reason, /percent of the product in the photo/);
});

test('a split mask, in two loose pieces, fails', async () => {
  const c = await cutout([{ left: 250, top: 100, width: 300, height: 120 }, { left: 250, top: 380, width: 300, height: 120 }]);
  const v = await cutoutSanity({ cutoutPng: c.png, box: c.box, photoPng: await photo() });
  assert.equal(v.ok, false);
  assert.equal(v.failure, 'pieces');
  assert.equal(v.pieces, 2);
});

test('a cut-out that runs along the photo edge is cropped by the frame and fails', async () => {
  const c = await cutout([{ left: 0, top: 100, width: 300, height: 400 }]);
  const v = await cutoutSanity({ cutoutPng: c.png, box: c.box, photoPng: await photo() });
  assert.equal(v.ok, false);
  assert.equal(v.failure, 'edge');
});

test('on a busy background the coverage is not judged, so a good cut-out is not failed on a guess', async () => {
  const noise = await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 70 } } }).png().toBuffer();
  const c = await cutout([PRODUCT]);
  const v = await cutoutSanity({ cutoutPng: c.png, box: c.box, photoPng: noise });
  assert.equal(v.ok, true);
  assert.equal(v.coverage, null);
});

test('the original photo becomes a rounded panel with transparent corners', async () => {
  const panel = await photoAsPanel(await photo());
  const { data, info } = await sharp(panel.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, W);
  assert.equal(data[3], 0, 'the corner is transparent');
  assert.equal(data[((info.height >> 1) * info.width + (info.width >> 1)) * 4 + 3], 255, 'the middle is solid');
  assert.match(PANEL_NOTE, /could not be cut out cleanly, so the original photo is shown/);
  assert.ok(!/[–—]/.test(PANEL_NOTE));
});

// ---- the loop: a failed cut-out is not used ----------------------------------------------------

const state = { cut: null, photoPng: null, prompts: [] };
mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'muse-spark-1.3', image: 'muse-image-1.0', segment: 'sam-3.1' },
    meta: {
      responses: {
        create: async ({ input }) => {
          const prompt = input[0].content[0].text;
          if (prompt.includes('Look at this product photo')) return { output_text: JSON.stringify({ description: 'a plant in a white pot', printed_text: [] }) };
          if (prompt.includes('Image 1 is the real product')) return { output_text: JSON.stringify({ sameProduct: true, differences: [] }) };
          return { output_text: JSON.stringify({ score: 7, biggest_weakness: 'Plain', fix: 'Nothing', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false }) };
        },
      },
    },
    text: async (input) => {
      state.prompts.push(input);
      if (input.includes('senior designer')) return JSON.stringify({ archetype: 'behind', art_prompt: '', headline: 'Round Green Leaves', subline: 'In a white pot', badge: [], cta: 'Shop now', pattern: 'grid' });
      if (input.includes('Banned claims')) return JSON.stringify({ claims: [] });
      return '{}';
    },
    generateImage: async () => { throw new Error('no image call expected'); },
    editImage: async () => { throw new Error('no image call expected'); },
    ImageBudget: class { async take() {} },
  },
});
mock.module('../../src/lib/meta/segment.ts', {
  namedExports: {
    cutOutProduct: async () => ({ ...state.cut, matches: 1, method: 'concept', prompt: 'test', photoPng: state.photoPng }),
    locateInScene: async () => null,
  },
});
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) });
const { runCreativeLoop } = await import('../../src/lib/meta/loop.ts');
const brief = { briefType: 'product', clientName: '', productNoun: 'pilea plant pot', productImageUrl: 'data:image/png;base64,ZmFrZQ==', audience: 'online shoppers', facts: 'A plant in a white pot', maxRounds: 1 };

test('a half cut-out is not used: one studio design on the whole photo, with a plain note', async () => {
  state.photoPng = await photo();
  state.cut = await cutout([{ left: 250, top: 380, width: 300, height: 120 }]);
  const events = [];
  const result = await runCreativeLoop({ ...brief, maxRounds: 3 }, (e) => events.push(e));
  assert.equal(result.concepts.length, 1, 'no scene or type-behind round is built from a bad cut-out');
  assert.equal(result.concepts[0].archetype, 'product');
  assert.equal(result.concepts[0].method, 'layout composite');
  assert.ok(events.some((e) => e.type === 'fallback_note' && e.message === PANEL_NOTE));
  // The cut-out sent on is the whole photo, not the half mask.
  const full = events.find((e) => e.type === 'cutout_full');
  assert.equal((await sharp(Buffer.from(full.pngB64, 'base64')).metadata()).width, W);
});

test('a good cut-out is used as before: type behind the product first, no fallback note', async () => {
  state.photoPng = await photo();
  state.cut = await cutout([PRODUCT]);
  const events = [];
  const result = await runCreativeLoop(brief, (e) => events.push(e));
  assert.ok(!events.some((e) => e.type === 'fallback_note' && e.message === PANEL_NOTE));
  assert.equal(result.concepts[0].archetype, 'behind');
});
