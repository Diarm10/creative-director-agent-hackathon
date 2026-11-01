// The two routes behind the rescue buttons: api/run with rescue (the server looks for a person, a brand or a watermark itself first) and
// api/items (list the products in one photo, cut each out on its own, check each).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';
process.env.DEMO_CODE = 'right-code';
delete process.env.IP_RUN_LIMIT;
delete process.env.DAILY_RUN_CAP;

const calls = { verify: 0, ask: 0, cut: [], sanity: 0, loop: [] };
const gate = { ok: true, reason: null };
let listReply = JSON.stringify({ items: [] });

mock.module('../../api/_lib/vision.ts', {
  namedExports: {
    verifyRescuePhoto: async () => { calls.verify++; return gate; },
    askAboutPhoto: async () => { calls.ask++; return listReply; },
    photoForModel: async () => 'data:image/jpeg;base64,xx',
  },
});
const photoPng = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#cccccc' } }).png().toBuffer();
const failing = new Set();
mock.module('../../src/lib/meta/segment.ts', {
  namedExports: {
    cutOutProduct: async (name) => {
      calls.cut.push(name);
      if (failing.has(`${name}:none`)) return null;
      return { png: photoPng, box: { left: 200, top: 100, width: 200, height: 300 }, matches: 1, method: 'concept', prompt: name, photoPng };
    },
    locateInScene: async () => null,
  },
});
mock.module('../../src/lib/meta/cutoutSanity.ts', {
  namedExports: {
    cutoutSanity: async () => { calls.sanity++; return failing.has('sanity-next') && !(failing.delete('sanity-next')) ? { ok: true } : failing.has('sanity-fail') ? { ok: false, reason: 'the cut-out is in 2 separate pieces' } : { ok: true, failure: null, reason: null, coverage: 0.9, pieces: 1 }; },
    photoAsPanel: async () => ({ png: photoPng, width: 800, height: 600 }),
    PANEL_NOTE: 'x',
  },
});
mock.module('../../src/lib/meta/loop.ts', {
  namedExports: {
    runCreativeLoop: async (brief, emit) => { calls.loop.push(brief); emit({ type: 'run_started' }); return { concepts: [{ round: 1, imageB64: 'aW1n', imageMime: 'image/jpeg', headline: 'H', body: 'B', score: 9 }], finalPickIndex: 0 }; },
    runRevision: async () => ({ concepts: [], finalPickIndex: 0 }),
  },
});

const { default: run } = await import('../../api/run.ts');
const { default: items } = await import('../../api/items.ts');
const fakeRes = () => { const r = { statusCode: 200, chunks: [], jsonBody: null, status(c) { r.statusCode = c; return r; }, setHeader() {}, flushHeaders() {}, write(c) { r.chunks.push(c); return true; }, json(b) { r.jsonBody = b; return r; }, end() { return r; } }; return r; };
let ip = 0;
const post = async (handler, body, code = 'right-code') => { const res = fakeRes(); await handler({ method: 'POST', headers: { 'x-demo-code': code, 'x-forwarded-for': `10.6.0.${++ip}` }, body, socket: {} }, res); return res; };
const photo = `data:image/png;base64,${photoPng.toString('base64')}`;
const product = { briefType: 'product', catalogue: true, quick: true, productNoun: 'steel flask', productImageUrl: 'data:image/jpeg;base64,ZmFrZQ==', audience: 'online shoppers' };
const reset = () => { calls.verify = 0; calls.ask = 0; calls.cut.length = 0; calls.sanity = 0; calls.loop.length = 0; gate.ok = true; gate.reason = null; failing.clear(); };

test('api/run: a normal run never starts a rescue check, and a rescue run asks the server to look at the photo first', async () => {
  reset();
  assert.equal((await post(run, product)).statusCode, 200);
  assert.equal(calls.verify, 0, 'no extra check for a normal run');
  assert.equal(calls.loop[0].rescue, undefined);
  const res = await post(run, { ...product, rescue: true });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.verify, 1);
  assert.equal(calls.loop.at(-1).rescue, true);
});

test('api/run: a rescue of a photo with a person, a brand or a watermark is refused before anything is made', async () => {
  reset();
  gate.ok = false;
  gate.reason = 'This photo is refused for good: a person or a hand is in the photo.';
  const res = await post(run, { ...product, rescue: true });
  assert.equal(res.statusCode, 422);
  assert.match(res.jsonBody.error, /refused for good: a person or a hand/);
  assert.equal(calls.loop.length, 0, 'no run started');
});

test('api/run: rescue is only for a product photo', async () => {
  reset();
  const res = await post(run, { briefType: 'event', clientName: 'x', title: 'Night', eventDate: 'Fri', audience: 'x', rescue: true });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.verify, 0);
});

test('api/items: lists the products, cuts each out on its own by name, and checks each one', async () => {
  reset();
  listReply = JSON.stringify({ items: [{ name: 'dropper bottle' }, { name: 'drinking glass' }, { name: 'hand' }, { name: 'ceramic vase' }] });
  const res = await post(items, { photo });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody.items.map((i) => i.name), ['dropper bottle', 'drinking glass', 'ceramic vase'], 'a hand is never listed');
  assert.deepEqual(calls.cut, ['dropper bottle', 'drinking glass', 'ceramic vase'], 'each item is cut out on its own, by its name');
  assert.equal(calls.sanity, 3, 'and each cut-out gets the same check as any ad');
  for (const it of res.jsonBody.items) {
    assert.equal(it.ok, true);
    assert.match(it.photo, /^data:image\/jpeg;base64,/);
  }
});

test('api/items: an item that cannot be cut out cleanly is listed as could not separate, with no photo', async () => {
  reset();
  listReply = JSON.stringify({ items: [{ name: 'dropper bottle' }, { name: 'drinking glass' }] });
  failing.add('drinking glass:none');
  const res = await post(items, { photo });
  const byName = Object.fromEntries(res.jsonBody.items.map((i) => [i.name, i]));
  assert.equal(byName['dropper bottle'].ok, true);
  assert.equal(byName['drinking glass'].ok, false);
  assert.equal(byName['drinking glass'].photo, null);
  assert.match(byName['drinking glass'].reason, /found nothing by that name/);
  failing.clear();
  failing.add('sanity-fail');
  const res2 = await post(items, { photo });
  assert.ok(res2.jsonBody.items.every((i) => !i.ok && /2 separate pieces/.test(i.reason) && i.photo === null));
});

test('api/items: a photo with a person, a brand or a watermark is refused first, and nothing is listed or cut out', async () => {
  reset();
  gate.ok = false;
  gate.reason = 'This photo is refused for good: a brand name or logo is visible.';
  const res = await post(items, { photo });
  assert.equal(res.statusCode, 422);
  assert.match(res.jsonBody.error, /brand name or logo/);
  assert.equal(calls.ask, 0, 'the items were never listed');
  assert.deepEqual(calls.cut, []);
});

test('api/items: needs the demo code, an image, and says so plainly when the model lists nothing', async () => {
  reset();
  assert.equal((await post(items, { photo }, 'wrong')).statusCode, 401);
  assert.equal((await post(items, { photo: 'not an image' })).statusCode, 400);
  listReply = JSON.stringify({ items: [] });
  const res = await post(items, { photo });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody.items, []);
});
