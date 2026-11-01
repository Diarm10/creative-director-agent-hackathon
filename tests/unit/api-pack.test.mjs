// api/pack.ts: the demo code gate, validation, and a real ZIP back for a good request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { unzipSync } from 'fflate';

process.env.DEMO_CODE = 'right-code';
const { default: handler } = await import('../../api/pack.ts');
const { renderDesign } = await import('../../src/lib/meta/design/layouts.ts');
const { makePalette } = await import('../../src/lib/meta/design/palette.ts');

function fakeRes() {
  const res = {
    statusCode: 200, headers: {}, body: null, jsonBody: null,
    status(code) { res.statusCode = code; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    json(b) { res.jsonBody = b; return res; },
    end(b) { res.body = b ?? null; return res; },
  };
  return res;
}
let n = 0;
const req = (body, code = 'right-code') => ({ method: 'POST', headers: { ...(code === null ? {} : { 'x-demo-code': code }), 'x-forwarded-for': `10.1.0.${++n}` }, body });

const png = await renderDesign({ archetype: 'typographic', width: 1080, height: 1080, palette: makePalette(['#1B2A38', '#F1EDE6', '#C9683A']), headline: 'Build for Your World', subline: 'For programmers', organiser: 'Another World Events', details: [], cta: 'Join us', badge: [], seed: 5, pattern: 'grid', variant: 'block' });
const imageB64 = (await sharp(png).jpeg({ quality: 80 }).toBuffer()).toString('base64');
const good = {
  concept: { round: 1, archetype: 'typographic', headline: 'Build for Your World', body: 'For programmers', cta: 'Join us', imageB64, plan: { archetype: 'typographic', pattern: 'grid', variant: 'block', colours: ['#1B2A38', 'nope'], badge: [], ctaScale: 1, gapScale: 1 } },
  brief: { briefType: 'event', clientName: 'Another World Events', eventDate: 'Thu 20 Nov, 7pm', brandColours: ['#1B2A38', '#F1EDE6', '#C9683A', 'red'] },
};

test('a good request returns a ZIP with the three sizes and the copy, and says how each size was made', async () => {
  const res = fakeRes();
  await handler(req(good), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/zip');
  assert.match(res.headers['content-disposition'], /campaign-pack\.zip/);
  const files = unzipSync(new Uint8Array(res.body));
  assert.deepEqual(Object.keys(files).sort(), ['copy.txt', 'poster-1200x1800.jpg', 'square-1080x1080.jpg', 'story-1080x1920.jpg']);
  const sizes = JSON.parse(res.headers['x-pack-sizes']);
  assert.deepEqual(sizes.map((s) => s.how), ['original', 'redrawn', 'redrawn']);
});

test('the demo code gate applies: missing, wrong and unset all refuse', async () => {
  for (const code of [null, 'wrong']) {
    const res = fakeRes();
    await handler(req(good, code), res);
    assert.equal(res.statusCode, 401);
  }
  const saved = process.env.DEMO_CODE;
  delete process.env.DEMO_CODE;
  try {
    const res = fakeRes();
    await handler(req(good), res);
    assert.equal(res.statusCode, 503);
  } finally { process.env.DEMO_CODE = saved; }
});

test('bad requests are refused without a ZIP: unknown archetype, no image, no headline, a bad cut-out', async () => {
  const bad = [
    { ...good, concept: { ...good.concept, archetype: 'poster' } },
    { ...good, concept: { ...good.concept, imageB64: '' } },
    { ...good, concept: { ...good.concept, headline: '' } },
    { ...good, brief: { ...good.brief, briefType: 'nope' } },
    { ...good, cutoutB64: Buffer.from('not a picture').toString('base64') },
    { ...good, concept: { ...good.concept, imageB64: 'A'.repeat(3_100_000) } },
  ];
  for (const b of bad) {
    const res = fakeRes();
    await handler(req(b), res);
    assert.ok([400, 413].includes(res.statusCode), JSON.stringify(b).slice(0, 80));
    assert.equal(res.body, null);
  }
});

test('only GET-style misuse is refused: a non-POST gets 405', async () => {
  const res = fakeRes();
  await handler({ method: 'GET', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 405);
});
