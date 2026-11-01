// runCreativeLoop on the provider layer: which model ran each step is reported and kept on the concept,
// a Baseten problem falls back to Meta without failing the run, and a run with no Baseten key is
// unchanged. Both providers are faked; Muse Image and SAM stay mocked as in the other loop tests.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';
const scenePng = await sharp({ create: { width: 128, height: 128, channels: 3, background: { r: 230, g: 226, b: 218 } } }).png().toBuffer();

mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'muse-spark-1.3', image: 'muse-image-1.0', segment: 'sam-3.1' },
    meta: { responses: { create: async () => ({ output_text: '{}' }) } },
    text: async () => '{}',
    generateImage: async () => scenePng.toString('base64'),
    editImage: async () => scenePng.toString('base64'),
    ImageBudget: class { async take() {} },
  },
});
mock.module('../../src/lib/meta/segment.ts', { namedExports: { cutOutProduct: async () => null, locateInScene: async () => null } });
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) });

const { runCreativeLoop } = await import('../../src/lib/meta/loop.ts');
const { createRouter, loadProviderConfig } = await import('../../src/lib/meta/providers.ts');

const PARTS = Object.fromEntries(['legibility', 'hierarchy', 'composition', 'brandFit', 'fidelity', 'originality'].map((k) => [k, { score: 7, note: 'ok' }]));
const replies = {
  planner: JSON.stringify({ archetype: 'typographic', art_prompt: 'x', headline: 'Launch Week', subline: 'Three charges', badge: [], cta: 'Shop now', pattern: 'grid', layout: 'stack', colours: [] }),
  critic: JSON.stringify({ parts: PARTS, biggest_weakness: 'Spacing', fix: 'More space', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false, generic_reason: '' }),
  folio: JSON.stringify({ claims: [] }),
  copy: JSON.stringify({ title: 'T', bullets: ['a', 'b', 'c', 'd', 'e'] }),
  fidelity: JSON.stringify({ sameProduct: true, differences: [] }),
};

const backend = (provider, model, over = {}) => ({
  provider, model, calls: [],
  async run(call) {
    this.calls.push(call.step);
    const o = over[call.step];
    if (typeof o === 'function') return o(call);
    if (o !== undefined) return o;
    return replies[call.step];
  },
});
const err = (status) => Object.assign(new Error('boom'), { status });
const mk = (env, baseten, meta, extra = {}) => createRouter({ config: loadProviderConfig(env), baseten, meta, ...extra });
const KEYED = { BASETEN_API_KEY: 'sk-test-key', STEP_PROVIDER_PLANNER: 'baseten' }; // every step on Baseten, whatever the shipped defaults
const SHIPPED = { BASETEN_API_KEY: 'sk-test-key' }; // the defaults as shipped

const brief = { briefType: 'promo', clientName: 'Sparks Audio', title: 'Launch Week', offer: '10% off', audience: 'commuters', cta: 'Shop now', maxRounds: 1,
  folio: { brandColours: [], headingFont: 'Inter', bodyFont: 'Inter', logoUrl: null, approvedFacts: ['Holds three charges'], bannedClaims: ['medical claims'], bannedWords: [] } };

test('with Baseten working, every text and vision step runs on Muse Spark Open and says so', async () => {
  const baseten = backend('baseten', 'meta-models/muse-spark-open-1026');
  const meta = backend('meta', 'muse-spark-1.3');
  const events = [];
  const result = await runCreativeLoop(brief, (e) => events.push(e), { router: mk(KEYED, baseten, meta) });
  const models = result.concepts[0].models;
  assert.deepEqual(models.map((m) => m.step).sort(), ['critic', 'folio', 'planner']);
  for (const m of models) {
    assert.equal(m.provider, 'baseten');
    assert.equal(m.fellBack, false);
    assert.equal(m.label, 'Muse Spark Open on Baseten');
  }
  assert.equal(meta.calls.length, 0, 'Meta was not needed');
  const used = events.filter((e) => e.type === 'model_used');
  assert.equal(used.length, 3);
  assert.ok(used.every((e) => e.round === 1 && e.label === 'Muse Spark Open on Baseten' && e.fellBack === false));
});

test('with the shipped defaults and a key, the planner runs on Meta by choice (not as a fallback) and the other steps on Baseten', async () => {
  const baseten = backend('baseten', 'meta-models/muse-spark-open-1026');
  const meta = backend('meta', 'muse-spark-1.3');
  const result = await runCreativeLoop(brief, () => {}, { router: mk(SHIPPED, baseten, meta) });
  const byStep = Object.fromEntries(result.concepts[0].models.map((m) => [m.step, m]));
  assert.equal(byStep.planner.provider, 'meta');
  assert.equal(byStep.planner.fellBack, false, 'asked for Meta, got Meta');
  assert.equal(byStep.critic.provider, 'baseten');
  assert.equal(byStep.folio.provider, 'baseten');
  assert.deepEqual(baseten.calls.sort(), ['critic', 'folio']);
  assert.deepEqual(meta.calls, ['planner']);
});

test('with no key, steps run on Meta, labelled as Meta and not as fallbacks', async () => {
  const meta = backend('meta', 'muse-spark-1.3');
  const result = await runCreativeLoop(brief, () => {}, { router: mk({}, null, meta) });
  for (const m of result.concepts[0].models) {
    assert.equal(m.provider, 'meta');
    assert.equal(m.fellBack, false);
    assert.equal(m.label, 'Muse Spark 1.3 on Meta');
  }
});

test('a rate-limited critic falls back to Meta, the run completes, and the card says so honestly', async () => {
  const baseten = backend('baseten', 'meta-models/muse-spark-open-1026', { critic: () => { throw err(429); } });
  const meta = backend('meta', 'muse-spark-1.3');
  const events = [];
  const result = await runCreativeLoop(brief, (e) => events.push(e), { router: mk(KEYED, baseten, meta) });
  const c = result.concepts[0];
  const critic = c.models.find((m) => m.step === 'critic');
  assert.equal(critic.provider, 'meta');
  assert.equal(critic.fellBack, true);
  assert.equal(critic.reason, 'rate limited');
  assert.equal(c.models.find((m) => m.step === 'planner').provider, 'baseten', 'the other steps stayed on Baseten');
  assert.equal(c.score, 7, 'the Meta critic still scored the design');
  assert.ok(events.some((e) => e.type === 'model_used' && e.step === 'critic' && e.fellBack && e.reason === 'rate limited'));
  assert.equal(events.at(-1).type, 'final_picked', 'the run finished normally');
});

test('a Baseten that is down for everything never fails the run: it finishes on Meta', async () => {
  const baseten = { provider: 'baseten', model: 'meta-models/muse-spark-open-1026', calls: 0, async run() { this.calls++; throw err(503); } };
  const meta = backend('meta', 'muse-spark-1.3');
  const result = await runCreativeLoop({ ...brief, maxRounds: 3 }, () => {}, { router: mk(KEYED, baseten, meta) });
  assert.ok(result.concepts.length >= 1);
  assert.ok(result.concepts.every((c) => c.score >= 1 && c.models.every((m) => m.provider === 'meta' && m.fellBack)));
  assert.equal(baseten.calls, 2, 'after two failures the run stopped asking Baseten');
});

test('a Baseten reply that is not valid JSON falls back for that step only', async () => {
  const baseten = backend('baseten', 'meta-models/muse-spark-open-1026', { critic: 'I think it looks nice!' });
  const result = await runCreativeLoop(brief, () => {}, { router: mk(KEYED, baseten, backend('meta', 'muse-spark-1.3')) });
  const m = result.concepts[0].models;
  assert.equal(m.find((x) => x.step === 'critic').reason, 'unparseable reply');
  assert.equal(m.find((x) => x.step === 'planner').fellBack, false);
});

test('open-model formatting slips in the planner and critic are tolerated, not treated as failures', async () => {
  const baseten = backend('baseten', 'meta-models/muse-spark-open-1026', {
    planner: '<think>I should pick a layout.</think>```json\n' + replies.planner.replace('}', ',}') + '\n```',
    critic: 'Sure! Here is the critique:\n' + replies.critic + '\nLet me know if you need more.',
  });
  const result = await runCreativeLoop(brief, () => {}, { router: mk(KEYED, baseten, backend('meta', 'muse-spark-1.3')) });
  const c = result.concepts[0];
  assert.equal(c.headline, 'Launch Week');
  assert.ok(c.models.every((m) => m.provider === 'baseten' && !m.fellBack));
  assert.equal(c.breakdown.parts.hierarchy.score, 7);
});

test('maxRounds limits a run to fewer rounds', async () => {
  const meta = backend('meta', 'muse-spark-1.3');
  const one = await runCreativeLoop({ ...brief, maxRounds: 1 }, () => {}, { router: mk({}, null, meta) });
  assert.equal(one.concepts.length, 1);
});
