// The provider layer: which provider each step uses, falling back to Meta on any Baseten problem,
// the Baseten request shape, and keeping the key out of everything. No network, no real models.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.MODEL_API_KEY = 'test-fake-key';
mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'muse-spark-1.3', image: 'muse-image-1.0', segment: 'sam-3.1' },
    meta: { responses: { create: async () => ({ output_text: 'meta vision reply' }) } },
    text: async (input) => `meta text reply to: ${input}`,
  },
});

const {
  loadProviderConfig, modelLabel, createRouter, createBasetenBackend, createMetaBackend, createModelCaller, CallBudget, BudgetExceededError,
  STEPS, BASETEN_MODEL_DEFAULT, BASETEN_BASE_URL, DEFAULT_PROVIDER_WHEN_KEYED,
} = await import('../../src/lib/meta/providers.ts');

const KEY = 'sk-test-SECRET-123';
const ALL_BASETEN = { STEP_PROVIDER_PLANNER: 'baseten', STEP_PROVIDER_COPY: 'baseten', STEP_PROVIDER_FIDELITY: 'baseten', STEP_PROVIDER_FOLIO: 'baseten', STEP_PROVIDER_CRITIC: 'baseten' };
const cfg = (env = {}) => loadProviderConfig({ BASETEN_API_KEY: KEY, ...ALL_BASETEN, ...env });

const fakeMeta = (reply = 'meta reply') => ({ provider: 'meta', model: 'muse-spark-1.3', calls: 0, async run() { this.calls++; return reply; } });
const fakeBaseten = (impl) => ({ provider: 'baseten', model: BASETEN_MODEL_DEFAULT, calls: 0, async run(call, signal) { this.calls++; return impl(call, signal); } });
const err = (status) => Object.assign(new Error('boom'), { status });
const call = (o = {}) => ({ step: 'planner', input: 'hello', ...o });

test('without a Baseten key every step uses Meta', () => {
  const c = loadProviderConfig({});
  assert.equal(c.hasBasetenKey, false);
  for (const s of STEPS) assert.equal(c.steps[s], 'meta', s);
});

test('with a key, the shipped defaults are Baseten for four steps and Meta for the planner, from the measured comparison', () => {
  const c = loadProviderConfig({ BASETEN_API_KEY: KEY });
  assert.equal(c.hasBasetenKey, true);
  assert.deepEqual(c.steps, { planner: 'meta', copy: 'baseten', fidelity: 'baseten', folio: 'baseten', critic: 'baseten' });
  assert.equal(DEFAULT_PROVIDER_WHEN_KEYED.planner, 'meta');
});

test('every step can still be pointed at Baseten, including the planner', () => {
  const c = cfg();
  for (const s of STEPS) assert.equal(c.steps[s], 'baseten', s);
});

test('a single step can be pointed at either provider, and junk values are ignored', () => {
  const c = cfg({ STEP_PROVIDER_CRITIC: 'meta', STEP_PROVIDER_FOLIO: ' Meta ', STEP_PROVIDER_PLANNER: 'nonsense' });
  assert.equal(c.steps.critic, 'meta');
  assert.equal(c.steps.folio, 'meta');
  assert.equal(c.steps.planner, 'meta', 'a junk value is ignored and the step falls to its shipped default, which is Meta');
  assert.equal(loadProviderConfig({ STEP_PROVIDER_COPY: 'baseten' }).steps.copy, 'baseten', 'an explicit choice wins even without a key');
});

test('the Baseten model defaults to the hackathon id and can be overridden', () => {
  assert.equal(cfg().basetenModel, 'meta-models/muse-spark-open-1026');
  assert.equal(BASETEN_MODEL_DEFAULT, 'meta-models/muse-spark-open-1026');
  assert.equal(cfg({ BASETEN_MODEL: 'other/model' }).basetenModel, 'other/model');
  assert.equal(cfg().basetenBaseUrl, 'https://inference.baseten.co/v1');
  assert.equal(BASETEN_BASE_URL, 'https://inference.baseten.co/v1');
});

test('the config never holds the key', () => {
  assert.doesNotMatch(JSON.stringify(cfg()), /SECRET/);
});

test('labels say which model answered', () => {
  assert.equal(modelLabel('baseten', BASETEN_MODEL_DEFAULT), 'Muse Spark Open on Baseten');
  assert.equal(modelLabel('meta', 'muse-spark-1.3'), 'Muse Spark 1.3 on Meta');
  assert.equal(modelLabel('baseten', 'acme/other'), 'acme/other on Baseten');
});

test('a step on Baseten that works is answered by Baseten, not marked as a fallback', async () => {
  const baseten = fakeBaseten(() => 'open model reply');
  const meta = fakeMeta();
  const r = await createRouter({ config: cfg(), baseten, meta }).run(call());
  assert.equal(r.text, 'open model reply');
  assert.equal(r.record.provider, 'baseten');
  assert.equal(r.record.fellBack, false);
  assert.equal(r.record.reason, null);
  assert.equal(r.record.label, 'Muse Spark Open on Baseten');
  assert.equal(meta.calls, 0);
});

test('a step set to Meta never calls Baseten', async () => {
  const baseten = fakeBaseten(() => 'x');
  const r = await createRouter({ config: cfg({ STEP_PROVIDER_PLANNER: 'meta' }), baseten, meta: fakeMeta('from meta') }).run(call());
  assert.equal(r.text, 'from meta');
  assert.equal(r.record.fellBack, false, 'asked for Meta, got Meta: not a fallback');
  assert.equal(baseten.calls, 0);
});

test('an error falls back to Meta and says so', async () => {
  const meta = fakeMeta('meta saved it');
  const r = await createRouter({ config: cfg(), baseten: fakeBaseten(() => { throw err(500); }), meta }).run(call());
  assert.equal(r.text, 'meta saved it');
  assert.equal(r.record.provider, 'meta');
  assert.equal(r.record.fellBack, true);
  assert.equal(r.record.wanted, 'baseten');
  assert.equal(r.record.reason, 'Baseten error 500');
  assert.equal(r.record.label, 'Muse Spark 1.3 on Meta');
});

test('a rate limit, a rejected key and a plain error each give their own plain reason', async () => {
  const reasons = [];
  for (const e of [err(429), err(401), new Error('network down')]) {
    const r = await createRouter({ config: cfg(), baseten: fakeBaseten(() => { throw e; }), meta: fakeMeta() }).run(call());
    reasons.push(r.record.reason);
  }
  assert.deepEqual(reasons, ['rate limited', 'rejected by Baseten', 'Baseten error']);
});

test('a slow Baseten is timed out and Meta answers instead of the run stalling', async () => {
  const baseten = fakeBaseten(() => new Promise(() => {})); // never answers
  const started = Date.now();
  const r = await createRouter({ config: { ...cfg(), timeoutMs: 40 }, baseten, meta: fakeMeta('meta after timeout') }).run(call());
  assert.ok(Date.now() - started < 1500, 'did not wait for Baseten');
  assert.equal(r.text, 'meta after timeout');
  assert.equal(r.record.reason, 'timed out');
  assert.equal(r.record.fellBack, true);
});

test('the timeout aborts the request so it does not keep running', async () => {
  let aborted = false;
  const baseten = fakeBaseten((_c, signal) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }));
  await createRouter({ config: { ...cfg(), timeoutMs: 30 }, baseten, meta: fakeMeta() }).run(call());
  assert.equal(aborted, true);
});

test('vision calls get the longer vision timeout', async () => {
  const baseten = fakeBaseten(() => new Promise((resolve) => setTimeout(() => resolve('slow but fine'), 120)));
  const config = { ...cfg(), timeoutMs: 40, visionTimeoutMs: 400 };
  const text = await createRouter({ config, baseten, meta: fakeMeta('meta') }).run(call());
  assert.equal(text.record.provider, 'meta', 'a text call at 120ms exceeds its 40ms timeout');
  const vision = await createRouter({ config, baseten: fakeBaseten(() => new Promise((r) => setTimeout(() => r('slow but fine'), 120))), meta: fakeMeta('meta') }).run(call({ images: ['data:image/png;base64,AA'] }));
  assert.equal(vision.text, 'slow but fine');
  assert.equal(vision.record.provider, 'baseten');
});

test('an empty reply, or only reasoning, falls back', async () => {
  for (const reply of ['', '   ', '<think>musing</think>']) {
    const r = await createRouter({ config: cfg(), baseten: fakeBaseten(() => reply), meta: fakeMeta('meta') }).run(call());
    assert.equal(r.record.provider, 'meta', JSON.stringify(reply));
    assert.equal(r.record.reason, 'empty reply');
  }
});

test('reasoning blocks are stripped from a good reply', async () => {
  const r = await createRouter({ config: cfg(), baseten: fakeBaseten(() => '<think>let me plan</think>Final headline'), meta: fakeMeta() }).run(call());
  assert.equal(r.text, 'Final headline');
  assert.equal(r.record.provider, 'baseten');
});

test('for JSON steps, formatting slips are tolerated but unusable replies fall back', async () => {
  const good = [
    '```json\n{"score": 7,}\n```',
    'Here is my answer: {"score": 7} Hope that helps!',
    '<think>hmm {not json}</think>{"score": 7}',
    "{'score': 7}",
    '{“score”: 7}',
  ];
  for (const reply of good) {
    const r = await createRouter({ config: cfg(), baseten: fakeBaseten(() => reply), meta: fakeMeta() }).run(call({ expectJson: true }));
    assert.equal(r.record.provider, 'baseten', reply);
  }
  const bad = await createRouter({ config: cfg(), baseten: fakeBaseten(() => 'I could not do that.'), meta: fakeMeta('{"score": 5}') }).run(call({ expectJson: true }));
  assert.equal(bad.record.provider, 'meta');
  assert.equal(bad.record.reason, 'unparseable reply');
  const plain = await createRouter({ config: cfg(), baseten: fakeBaseten(() => 'Just words'), meta: fakeMeta() }).run(call({ expectJson: false }));
  assert.equal(plain.record.provider, 'baseten', 'a plain text step does not need JSON');
});

test('after two Baseten failures the rest of the run skips Baseten', async () => {
  const baseten = fakeBaseten(() => { throw err(500); });
  const router = createRouter({ config: cfg(), baseten, meta: fakeMeta() });
  const records = [];
  for (let i = 0; i < 4; i++) records.push((await router.run(call())).record);
  assert.equal(baseten.calls, 2, 'Baseten was tried twice, then skipped');
  assert.equal(records[2].reason, 'skipped after earlier Baseten failures in this run');
  assert.ok(records.every((r) => r.fellBack && r.provider === 'meta'));
});

test('a success does not reset the failure count within a run, a new run starts clean', async () => {
  let n = 0;
  const baseten = fakeBaseten(() => { n++; if (n === 1) throw err(500); return 'ok'; });
  const router = createRouter({ config: cfg(), baseten, meta: fakeMeta() });
  await router.run(call());
  assert.equal((await router.run(call())).record.provider, 'baseten');
  const fresh = createRouter({ config: cfg(), baseten: fakeBaseten(() => 'ok'), meta: fakeMeta() });
  assert.equal((await fresh.run(call())).record.provider, 'baseten');
});

test('asking for Baseten with no key set falls back to Meta with that reason', async () => {
  const r = await createRouter({ config: loadProviderConfig({ STEP_PROVIDER_CRITIC: 'baseten' }), baseten: null, meta: fakeMeta() }).run(call({ step: 'critic' }));
  assert.equal(r.record.provider, 'meta');
  assert.equal(r.record.reason, 'no Baseten key set');
});

test('if Meta also fails, the error is raised, because there is nothing left to try', async () => {
  const meta = { provider: 'meta', model: 'muse-spark-1.3', async run() { throw new Error('meta is down'); } };
  await assert.rejects(createRouter({ config: cfg(), baseten: fakeBaseten(() => { throw err(500); }), meta }).run(call()), /meta is down/);
});

test('the call budget counts Baseten and fallback calls and stops the run, never swallowed', async () => {
  const budget = new CallBudget(3);
  const router = createRouter({ config: cfg(), baseten: fakeBaseten(() => { throw err(500); }), meta: fakeMeta(), budget });
  await router.run(call()); // baseten (1) + meta (2)
  assert.equal(budget.used, 2);
  await assert.rejects(router.run(call()), BudgetExceededError, 'baseten takes the 3rd, the fallback hits the cap');
  assert.equal(budget.used, 3);
  await assert.rejects(createRouter({ config: cfg(), baseten: fakeBaseten(() => 'x'), meta: fakeMeta(), budget }).run(call()), BudgetExceededError);
});

test('the key never appears in a record, an error reason or a thrown error', async () => {
  const leaky = fakeBaseten(() => { throw Object.assign(new Error(`request with ${KEY} failed`), { status: 500 }); });
  const r = await createRouter({ config: cfg(), baseten: leaky, meta: fakeMeta() }).run(call());
  assert.doesNotMatch(JSON.stringify(r.record), /SECRET/);
});

// ---- Baseten backend ----

function fakeFactory(replies) {
  const seen = { factoryOpts: null, bodies: [] };
  const factory = (opts) => {
    seen.factoryOpts = opts;
    return { chat: { completions: { create: async (body, o) => { seen.bodies.push({ body, o }); const next = replies.shift(); if (next instanceof Error) throw next; return next ?? { choices: [{ message: { content: 'ok' } }] }; } } } };
  };
  return { factory, seen };
}

test('no key means no Baseten backend', () => {
  assert.equal(createBasetenBackend(loadProviderConfig({}), {}), null);
  assert.equal(createBasetenBackend(loadProviderConfig({ BASETEN_API_KEY: '   ' }), { BASETEN_API_KEY: '   ' }), null);
});

test('the Baseten request goes to the OpenAI-compatible endpoint with the right model, system text and a bearer key', async () => {
  const { factory, seen } = fakeFactory([]);
  const env = { BASETEN_API_KEY: KEY };
  const backend = createBasetenBackend(loadProviderConfig(env), env, factory);
  assert.equal(seen.factoryOpts.baseURL, 'https://inference.baseten.co/v1');
  assert.equal(seen.factoryOpts.apiKey, KEY, 'the key goes to the client constructor and nowhere else');
  assert.equal(seen.factoryOpts.maxRetries, 1);
  await backend.run({ step: 'planner', input: 'plan this', instructions: 'be precise', temperature: 0 });
  const { body } = seen.bodies[0];
  assert.equal(body.model, 'meta-models/muse-spark-open-1026');
  assert.deepEqual(body.messages, [{ role: 'system', content: 'be precise' }, { role: 'user', content: 'plan this' }]);
  assert.equal(body.temperature, 0);
  assert.doesNotMatch(JSON.stringify(body), /SECRET/);
});

test('image input is sent as image_url parts next to the text', async () => {
  const { factory, seen } = fakeFactory([]);
  const env = { BASETEN_API_KEY: KEY };
  await createBasetenBackend(loadProviderConfig(env), env, factory).run({ step: 'critic', input: 'judge', images: ['data:image/jpeg;base64,AAA', 'data:image/png;base64,BBB'] });
  assert.deepEqual(seen.bodies[0].body.messages[0].content, [
    { type: 'text', text: 'judge' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } },
  ]);
});

test('a refused temperature is retried once without it, like the Meta side', async () => {
  const { factory, seen } = fakeFactory([err(400)]);
  const env = { BASETEN_API_KEY: KEY };
  const out = await createBasetenBackend(loadProviderConfig(env), env, factory).run({ step: 'critic', input: 'x', temperature: 0 });
  assert.equal(out, 'ok');
  assert.equal(seen.bodies.length, 2);
  assert.equal('temperature' in seen.bodies[1].body, false);
});

test('a null reply comes back as an empty string so the router can fall back', async () => {
  const { factory } = fakeFactory([{ choices: [{ message: { content: null } }] }]);
  const env = { BASETEN_API_KEY: KEY };
  assert.equal(await createBasetenBackend(loadProviderConfig(env), env, factory).run({ step: 'planner', input: 'x' }), '');
});

// ---- Meta backend and the per-run caller ----

test('the Meta backend uses text() for text and the Responses API for images', async () => {
  const backend = createMetaBackend();
  assert.equal(await backend.run({ step: 'planner', input: 'hi' }), 'meta text reply to: hi');
  assert.equal(await backend.run({ step: 'critic', input: 'look', images: ['data:image/png;base64,AA'], temperature: 0 }), 'meta vision reply');
});

test('the per-run caller reports each use and keeps the last model per step for the round', async () => {
  const seen = [];
  let n = 0;
  const router = createRouter({ config: cfg(), baseten: fakeBaseten(() => { n++; if (n === 2) throw err(429); return 'fine'; }), meta: fakeMeta('meta') });
  const ai = createModelCaller(router, (u) => seen.push(u));
  ai.startRound(1);
  await ai.text('planner', 'a');
  await ai.vision('critic', 'b', ['data:image/png;base64,AA']);
  const used = ai.endRound();
  assert.deepEqual(used.map((u) => [u.step, u.provider, u.fellBack, u.reason]), [['planner', 'baseten', false, null], ['critic', 'meta', true, 'rate limited']]);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((u) => u.round === 1));
  ai.startRound(2);
  assert.deepEqual(ai.endRound(), []);
});

test('one Baseten timeout sends the rest of the run to Meta at once, so a slow service costs one wait and not several', async () => {
  let calls = 0;
  const baseten = { provider: 'baseten', model: 'm', run: (_c, signal) => { calls += 1; return new Promise((_r, rej) => signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); } };
  const router = createRouter({ config: { ...cfg(), timeoutMs: 30 }, baseten, meta: fakeMeta('meta') });
  const first = await router.run(call());
  const second = await router.run(call());
  assert.equal(first.record.reason, 'timed out');
  assert.equal(second.record.reason, 'skipped after earlier Baseten failures in this run');
  assert.equal(second.record.provider, 'meta');
  assert.equal(calls, 1, 'Baseten was only asked once');
});
