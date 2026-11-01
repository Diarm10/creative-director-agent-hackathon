// The photo check: reading the model's reply, and api/check.ts with a faked provider route.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';
process.env.DEMO_CODE = 'right-code';

let reply = JSON.stringify({ person_or_hand: false, several_products: false, visible_brand_or_logo: false, watermark: false, busy_background: true });
let fellBack = false;
let lastCall = null;
mock.module('../../src/lib/meta/providers.ts', {
  namedExports: {
    createRouterFromEnv: () => ({
      run: async (call) => {
        lastCall = call;
        if (reply === 'THROW') throw new Error('both down');
        return { text: reply, record: { step: call.step, label: fellBack ? 'Muse Spark 1.3 on Meta' : 'Muse Spark Open on Baseten', fellBack } };
      },
    }),
  },
});
const { parsePhotoCheck } = await import('../../src/lib/meta/photoCheck.ts');
const { default: handler } = await import('../../api/check.ts');

function fakeRes() {
  const res = { statusCode: 200, jsonBody: null, status(c) { res.statusCode = c; return res; }, json(b) { res.jsonBody = b; return res; }, end() { return res; } };
  return res;
}
let n = 0;
const req = (body, code = 'right-code') => ({ method: 'POST', headers: { ...(code === null ? {} : { 'x-demo-code': code }), 'x-forwarded-for': `10.2.0.${++n}` }, body });
const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#cccccc' } }).jpeg().toBuffer();
const photo = `data:image/jpeg;base64,${jpeg.toString('base64')}`;

test('parsePhotoCheck needs all five answers as true or false, and treats an odd answer as unusable, not as no', () => {
  const ok = parsePhotoCheck('{"person_or_hand":true,"several_products":false,"visible_brand_or_logo":false,"watermark":false,"busy_background":false}');
  assert.equal(ok.person_or_hand, true);
  assert.equal(parsePhotoCheck('{"person_or_hand":"yes","several_products":false,"visible_brand_or_logo":false,"watermark":false,"busy_background":false}'), null);
  assert.equal(parsePhotoCheck('{"person_or_hand":true}'), null);
  assert.equal(parsePhotoCheck('nonsense'), null);
  assert.equal(parsePhotoCheck(''), null);
});

test('a good photo returns the answers, the real size and which model answered', async () => {
  const res = fakeRes();
  await handler(req({ photo }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.flags.busy_background, true);
  assert.equal(res.jsonBody.width, 800);
  assert.equal(res.jsonBody.height, 600);
  assert.equal(res.jsonBody.via, 'Muse Spark Open on Baseten');
  assert.equal(lastCall.step, 'fidelity', 'goes through the Baseten-first vision route');
  assert.equal(lastCall.images.length, 1);
});

test('when Baseten could not answer, the reply says Meta stepped in', async () => {
  fellBack = true;
  try {
    const res = fakeRes();
    await handler(req({ photo }), res);
    assert.equal(res.jsonBody.fellBack, true);
    assert.equal(res.jsonBody.via, 'Muse Spark 1.3 on Meta');
  } finally {
    fellBack = false;
  }
});

test('the demo code gate applies, and bad input is refused', async () => {
  for (const code of [null, 'wrong']) {
    const res = fakeRes();
    await handler(req({ photo }, code), res);
    assert.equal(res.statusCode, 401);
  }
  const none = fakeRes();
  await handler(req({}), none);
  assert.equal(none.statusCode, 400);
  const notPicture = fakeRes();
  await handler(req({ photo: 'data:image/jpeg;base64,bm90IGEgcGljdHVyZQ==' }), notPicture);
  assert.equal(notPicture.statusCode, 400);
  const get = fakeRes();
  await handler({ method: 'GET', headers: {}, body: {} }, get);
  assert.equal(get.statusCode, 405);
});

test('an unreadable answer or a failed route is an error the page treats as held back, never as a clean photo', async () => {
  reply = 'I cannot tell';
  const a = fakeRes();
  await handler(req({ photo }), a);
  assert.equal(a.statusCode, 502);
  assert.equal(a.jsonBody.flags, undefined);
  reply = 'THROW';
  const b = fakeRes();
  await handler(req({ photo }), b);
  assert.equal(b.statusCode, 502);
});
