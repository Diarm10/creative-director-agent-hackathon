// What "Download approved ads" holds, and the batch pool that runs products two at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { exportRows, resultsCsv } from '../../src/lib/catalogue/model.ts';
import { buildApprovedZip } from '../../src/lib/catalogue/export.ts';
import { runPool } from '../../src/lib/catalogue/batch.ts';

const JPEG_B64 = Buffer.from('fake jpeg bytes').toString('base64');
const concept = (extra = {}) => ({
  round: 2, imageB64: JPEG_B64, imageMime: 'image/jpeg', headline: 'Sip slowly', body: 'A white mug', score: 9, defects: [], breakdown: null,
  fidelity: { sameProduct: true, differences: [] }, folioCheck: { passed: true, reason: null }, models: [], ...extra,
});
const item = (sku, score, approval) => ({
  id: sku, row: { sku, product: 'white ceramic mug', audience: 'online shoppers', image: `${sku}.jpg` }, photoUrl: 'x', check: null, checkStatus: 'done',
  runAnyway: false, runStatus: 'done', run: { status: 'done', concepts: [concept({ score })], finalPickIndex: 0, notes: [] }, progress: '', error: null, approval,
});

test('only approved ads are exported: pending and rejected stay out, even with a good score', () => {
  const rows = exportRows([item('a', 9, 'approved'), item('b', 9, 'pending'), item('c', 9, 'rejected'), item('d', 6, 'approved')]);
  assert.deepEqual(rows.map((r) => r.sku), ['a', 'd']);
  assert.equal(rows[0].reason, 'Approved by a person');
  assert.match(rows[1].reason, /Approved by a person despite: .*score is 6/);
});

test('results.csv has the five columns and quotes where needed', () => {
  const csv = resultsCsv(exportRows([item('a', 7, 'approved')]));
  const [head, line] = csv.trim().split('\n');
  assert.equal(head, 'sku,product,status,score,reason');
  assert.match(line, /^a,white ceramic mug,approved,7,"Approved by a person despite:/);
});

test('the ZIP holds each approved final as sku.jpg plus results.csv, and nothing else; no approvals means no ZIP', () => {
  assert.equal(buildApprovedZip([item('a', 9, 'pending')]), null);
  const zip = buildApprovedZip([item('a', 9, 'approved'), item('b', 9, 'rejected'), item('c', 9, 'approved')]);
  assert.equal(zip.count, 2);
  const files = unzipSync(zip.bytes);
  assert.deepEqual(Object.keys(files).sort(), ['a.jpg', 'c.jpg', 'results.csv']);
  assert.equal(Buffer.from(files['a.jpg']).toString(), 'fake jpeg bytes');
  assert.equal(strFromU8(files['results.csv']).trim().split('\n').length, 3);
});

test('the batch pool runs two at a time, keeps input order, and stops starting new jobs after a stop message', async () => {
  let active = 0;
  let peak = 0;
  const started = [];
  const worker = async (n) => {
    started.push(n);
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return n;
  };
  const all = await runPool([1, 2, 3, 4, 5, 6], worker, { concurrency: 2 });
  assert.equal(peak, 2);
  assert.deepEqual(all.results, [1, 2, 3, 4, 5, 6]);
  assert.equal(all.stopped, null);

  started.length = 0;
  const stopping = await runPool([1, 2, 3, 4, 5, 6], worker, { concurrency: 2, shouldStop: (n) => (n === 2 ? 'limit reached' : null) });
  assert.equal(stopping.stopped, 'limit reached');
  assert.ok(started.length < 6, `started ${started.length}`);
  assert.equal(stopping.results[5], undefined);
});
