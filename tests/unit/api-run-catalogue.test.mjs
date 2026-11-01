// api/run.ts as Catalogue mode uses it, with the default limits (no limit variables set in this process):
// a person with the demo code can run at least 30 products a day, quick mode means two rounds, and the shop name is optional.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.MODEL_API_KEY = 'test-fake-key';
process.env.DEMO_CODE = 'right-code';
delete process.env.IP_RUN_LIMIT;
delete process.env.DAILY_RUN_CAP;

let lastBrief = null;
mock.module('../../src/lib/meta/loop.ts', {
  namedExports: {
    runCreativeLoop: async (brief, emit) => {
      lastBrief = brief;
      emit({ type: 'run_started' });
      const concept = { round: 1, imageB64: 'aW1n', imageMime: 'image/jpeg', headline: 'H', body: 'B', score: 9 };
      return { concepts: [concept], finalPickIndex: 0 };
    },
    runRevision: async () => ({ concepts: [], finalPickIndex: 0 }),
  },
});
const { default: handler } = await import('../../api/run.ts');
const { DEFAULT_DAILY_CAP, DEFAULT_IP_PER_HOUR, RunLimiter } = await import('../../api/_lib/gate.ts');

function fakeRes() {
  const res = {
    statusCode: 200, chunks: [], jsonBody: null,
    status(code) { res.statusCode = code; return res; }, setHeader() {}, flushHeaders() {},
    write(c) { res.chunks.push(c); return true; }, json(b) { res.jsonBody = b; return res; }, end() { return res; },
  };
  return res;
}
const req = (body, ip) => ({ method: 'POST', headers: { 'x-demo-code': 'right-code', 'x-forwarded-for': ip }, body });
const product = { briefType: 'product', productNoun: 'white ceramic mug', productImageUrl: 'data:image/jpeg;base64,ZmFrZQ==', audience: 'online shoppers' };

test('the default limits let one person with the demo code run 30 products in a day', () => {
  assert.ok(DEFAULT_IP_PER_HOUR >= 30, `hourly default is ${DEFAULT_IP_PER_HOUR}`);
  assert.ok(DEFAULT_DAILY_CAP >= 30, `daily default is ${DEFAULT_DAILY_CAP}`);
  const limiter = new RunLimiter({ ipPerHour: DEFAULT_IP_PER_HOUR, dailyCap: DEFAULT_DAILY_CAP });
  for (let i = 0; i < 30; i++) assert.equal(limiter.take('9.9.9.9').ok, true, `run ${i + 1}`);
});

test('the real handler accepts 30 runs from one address with the default limits', async () => {
  for (let i = 0; i < 30; i++) {
    const res = fakeRes();
    await handler(req({ ...product, catalogue: true, quick: true }, '10.9.0.1'), res);
    assert.equal(res.statusCode, 200, `run ${i + 1}`);
  }
});

test('quick mode means two rounds, and a normal run leaves the usual three', async () => {
  await handler(req({ ...product, catalogue: true, quick: true }, '10.9.0.2'), fakeRes());
  assert.equal(lastBrief.maxRounds, 2);
  await handler(req({ ...product, clientName: 'Harbour Mugs' }, '10.9.0.3'), fakeRes());
  assert.equal(lastBrief.maxRounds, undefined);
});

test('the shop name is optional in Catalogue mode only', async () => {
  const ok = fakeRes();
  await handler(req({ ...product, catalogue: true, quick: true }, '10.9.0.4'), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(lastBrief.clientName, '');
  const no = fakeRes();
  await handler(req(product, '10.9.0.5'), no);
  assert.equal(no.statusCode, 400);
  const named = fakeRes();
  await handler(req({ ...product, catalogue: true, clientName: 'Harbour Mugs' }, '10.9.0.6'), named);
  assert.equal(lastBrief.clientName, 'Harbour Mugs');
});
