// The planner may only describe what the product image shows. A headline that names a colour, material or part the
// image does not show (the snake plant "in Terracotta" with no pot in the ad) is sent back once, and if it comes back
// the same the product's own name is used.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';
const cutoutPng = await sharp({ create: { width: 60, height: 120, channels: 4, background: { r: 30, g: 90, b: 40, alpha: 1 } } }).png().toBuffer();

const state = { inspection: {}, plans: [], planPrompts: [], rewrites: 0 };
mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'muse-spark-1.3', image: 'muse-image-1.0', segment: 'sam-3.1' },
    meta: {
      responses: {
        create: async ({ input }) => {
          const prompt = input[0].content[0].text;
          if (prompt.includes('Look at this product photo')) return { output_text: JSON.stringify(state.inspection) };
          if (prompt.includes('Image 1 is the real product')) return { output_text: JSON.stringify({ sameProduct: true, differences: [] }) };
          return { output_text: JSON.stringify({ score: 7, biggest_weakness: 'Plain', fix: 'x', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false }) };
        },
      },
    },
    text: async (input) => {
      if (input.includes('senior designer')) {
        state.planPrompts.push(input);
        if (input.includes('cannot be seen in the product image')) state.rewrites++;
        const plan = state.plans.length > 1 ? state.plans.shift() : state.plans[0];
        return JSON.stringify({ archetype: 'behind', art_prompt: '', badge: [], cta: 'Shop now', pattern: 'grid', ...plan });
      }
      if (input.includes('Banned claims')) return JSON.stringify({ claims: [] });
      return '{}';
    },
    generateImage: async () => { throw new Error('no image'); },
    editImage: async () => { throw new Error('no image'); },
    ImageBudget: class { async take() {} },
  },
});
mock.module('../../src/lib/meta/segment.ts', {
  namedExports: {
    cutOutProduct: async () => ({ png: cutoutPng, box: { left: 0, top: 0, width: 60, height: 120 }, matches: 1, method: 'concept', prompt: 'test' }),
    locateInScene: async () => null,
  },
});
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) });
const { runCreativeLoop } = await import('../../src/lib/meta/loop.ts');

const brief = {
  briefType: 'product', clientName: 'Fernhill Home', productNoun: 'snake plant', productImageUrl: 'data:image/png;base64,ZmFrZQ==', audience: 'online shoppers',
  facts: 'A plant with tall, narrow, striped green leaves in a terracotta-coloured pot', maxRounds: 1,
};
const reset = (plans) => {
  state.inspection = { description: 'a tall snake plant with narrow striped green leaves', visible: ['green leaves', 'stripes'], printed_text: [] };
  state.plans = plans; state.planPrompts.length = 0; state.rewrites = 0;
};

test('a headline naming terracotta, which the image does not show, is rewritten once from what is visible', async () => {
  reset([{ headline: 'Snake Plant In Terracotta', subline: 'Tall striped leaves' }, { headline: 'Tall Striped Snake Plant', subline: 'Narrow green leaves' }]);
  const result = await runCreativeLoop(brief);
  assert.equal(state.rewrites, 1);
  assert.equal(result.concepts[0].headline, 'Tall Striped Snake Plant');
  assert.ok(!/terracotta/i.test(`${result.concepts[0].headline} ${result.concepts[0].body}`));
});

test('the planner is told what the image shows, and not to name anything else, even from a fact', async () => {
  reset([{ headline: 'Tall Striped Snake Plant', subline: 'Narrow green leaves' }]);
  await runCreativeLoop(brief);
  assert.equal(state.rewrites, 0, 'a clean headline is not sent back');
  assert.match(state.planPrompts[0], /The product image shows: .*snake plant/);
  assert.match(state.planPrompts[0], /never name a colour, material or part that it does not show, even if a fact above mentions it/);
});

test('if the rewrite still names it, a plain safe line is the headline and a subline that names it is dropped', async () => {
  reset([{ headline: 'Snake Plant In Terracotta', subline: 'Striped leaves in a terracotta pot' }]);
  const result = await runCreativeLoop(brief);
  assert.equal(state.rewrites, 1);
  assert.equal(result.concepts[0].headline, 'Grow Slowly', 'a plain safe line for plants: the product name alone is not allowed as a headline');
  assert.equal(result.concepts[0].body, '');
});
