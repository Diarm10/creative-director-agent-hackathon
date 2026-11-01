// The Offer (and other fields typed into the form for this run) count as approved facts.
// Banned words and banned claims still always win. The reviewer here is a fake that behaves like a
// consistent model, so these tests pin the logic around it, not Muse Spark itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFolioCompliance } from '../../src/lib/meta/creativeDirectorPure.ts';

const NEVER_CALLED = async () => {
  throw new Error('callText should not have been invoked');
};

const earbudsFolio = {
  bannedWords: ['cure'],
  bannedClaims: ['medical claims'],
  approvedFacts: ['The case holds three full charges'],
};

// Supported when the claim text appears in the approved sections of the prompt, banned when it
// mentions a medical topic, otherwise unsupported.
function fakeReviewer(claimsInCopy) {
  return async (prompt, _instructions, opts) => {
    assert.equal(opts?.temperature, 0, 'the check must ask for temperature 0');
    const approved = prompt.split('Banned claims')[1]?.split('Headline:')[0] ?? '';
    const claims = claimsInCopy.map((claim) => {
      if (/health|medical|hearing/i.test(claim)) return { claim, verdict: 'banned', reason: 'matches a banned claim' };
      return approved.toLowerCase().includes(claim.toLowerCase())
        ? { claim, verdict: 'supported' }
        : { claim, verdict: 'unsupported', reason: 'not in the approved facts' };
    });
    return JSON.stringify({ claims });
  };
}

test('a claim only in the Offer field passes, because the offer is approved for this run', async () => {
  const caller = fakeReviewer(['20% off this week']);
  const without = await checkFolioCompliance('Case for the commute', '20% off this week', earbudsFolio, caller);
  assert.equal(without.passed, false, 'without the offer as an approved fact it is unsupported');
  const withOffer = await checkFolioCompliance('Case for the commute', '20% off this week', earbudsFolio, caller, ['20% off this week']);
  assert.equal(withOffer.passed, true);
});

test('the same copy gets the same verdict every time', async () => {
  const caller = fakeReviewer(['20% off this week']);
  const results = [];
  for (let i = 0; i < 3; i++) {
    results.push((await checkFolioCompliance('Case', '20% off this week', earbudsFolio, caller, ['20% off this week'])).passed);
  }
  assert.deepEqual(results, [true, true, true]);
});

test('a banned word inside the offer still fails, without calling the model', async () => {
  const result = await checkFolioCompliance('A cure for dead batteries', 'Ten percent off', earbudsFolio, NEVER_CALLED, ['A cure for dead batteries']);
  assert.equal(result.passed, false);
  assert.match(result.reason, /cure/i);
});

test('a banned claim inside the offer still fails', async () => {
  const caller = fakeReviewer(['improves hearing health']);
  const result = await checkFolioCompliance('Sound', 'improves hearing health', earbudsFolio, caller, ['improves hearing health']);
  assert.equal(result.passed, false);
  assert.match(result.reason, /Banned claim/);
});

test('an invented claim still fails even with an offer supplied', async () => {
  const caller = fakeReviewer(['waterproof to 50 metres', '20% off this week']);
  const result = await checkFolioCompliance('Dive in', 'waterproof to 50 metres, 20% off this week', earbudsFolio, caller, ['20% off this week']);
  assert.equal(result.passed, false);
  assert.match(result.reason, /Unsupported claim "waterproof to 50 metres"/);
});

test('the prompt lists the run facts as approved', async () => {
  let seen = '';
  const caller = async (prompt) => { seen = prompt; return JSON.stringify({ claims: [] }); };
  await checkFolioCompliance('H', 'B', earbudsFolio, caller, ['Friday 14 November', 'Dublin']);
  assert.match(seen, /typed in by the user\): Friday 14 November; Dublin/);
});
