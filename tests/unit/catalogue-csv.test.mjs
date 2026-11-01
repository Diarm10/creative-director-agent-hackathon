// The catalogue CSV reader and the 12 product cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCatalogue, parseCsv, csvLine, MAX_PRODUCTS } from '../../src/lib/catalogue/csv.ts';

const head = 'sku,product,audience,image\n';

test('a normal file reads into rows', () => {
  const r = readCatalogue(head + 'a1,white mug,online shoppers,a1.jpg\na2,steel flask,online shoppers,a2.jpg\n');
  assert.equal(r.error, null);
  assert.deepEqual(r.rows.map((x) => x.sku), ['a1', 'a2']);
  assert.equal(r.rows[1].product, 'steel flask');
});

test('quoted commas, doubled quotes, Windows line ends and a leading byte order mark are handled', () => {
  const r = readCatalogue('﻿sku,product,audience,image\r\nb1,"mug, large ""blue""","people, at home",b1.jpg\r\n');
  assert.equal(r.error, null);
  assert.equal(r.rows[0].product, 'mug, large "blue"');
  assert.equal(r.rows[0].audience, 'people, at home');
});

test('shop and fact are optional columns: empty when absent, read when present', () => {
  const plain = readCatalogue(head + 'a1,mug,x,a1.jpg\n');
  assert.equal(plain.rows[0].shop, '');
  assert.equal(plain.rows[0].fact, '');
  const rich = readCatalogue('sku,product,audience,image,shop,fact\na1,mug,x,a1.jpg,Fernhill Home,"A white mug, with a handle"\na2,lamp,x,a2.jpg,Fernhill Home,\n');
  assert.equal(rich.rows[0].shop, 'Fernhill Home');
  assert.equal(rich.rows[0].fact, 'A white mug, with a handle');
  assert.equal(rich.rows[1].fact, '');
});

test('column names may be in any order and any case', () => {
  const r = readCatalogue('IMAGE,Sku,Audience,Product\nc.jpg,c1,everyone,lamp\n');
  assert.deepEqual(r.rows[0], { sku: 'c1', product: 'lamp', audience: 'everyone', image: 'c.jpg', shop: '', fact: '' });
});

test('more than 12 products is refused with a plain sentence and nothing is loaded', () => {
  const rows = Array.from({ length: MAX_PRODUCTS + 1 }, (_, i) => `s${i},p${i},x,i${i}.jpg`).join('\n');
  const r = readCatalogue(head + rows);
  assert.deepEqual(r.rows, []);
  assert.match(r.error, /13 products/);
  assert.match(r.error, /limit is 12/);
  const exactly = readCatalogue(head + Array.from({ length: MAX_PRODUCTS }, (_, i) => `s${i},p${i},x,i${i}.jpg`).join('\n'));
  assert.equal(exactly.rows.length, 12);
});

test('missing columns, empty files, header only, missing sku or image, and repeated skus are all refused plainly', () => {
  assert.match(readCatalogue('').error, /empty/i);
  assert.match(readCatalogue('sku,product\n1,a\n').error, /Missing: audience, image/);
  assert.match(readCatalogue(head).error, /no products/);
  assert.match(readCatalogue(head + ',mug,x,m.jpg\n').error, /Row 2/);
  assert.match(readCatalogue(head + 'a,mug,x,m.jpg\na,lamp,x,l.jpg\n').error, /"a"/);
});

test('parseCsv skips blank lines, and csvLine quotes only where needed', () => {
  assert.deepEqual(parseCsv('a,b\n\n\nc,d\n'), [['a', 'b'], ['c', 'd']]);
  assert.equal(csvLine(['x', 'a,b', 'say "hi"', 3]), 'x,"a,b","say ""hi""",3');
});

test('the bundled sample CSV is valid and has 12 products with 12 photos on disk', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const r = readCatalogue(readFileSync('demo-assets/catalogue/catalogue.csv', 'utf8'));
  assert.equal(r.error, null);
  assert.equal(r.rows.length, 12);
  const files = new Set(readdirSync('demo-assets/catalogue'));
  for (const row of r.rows) assert.ok(files.has(row.image), row.image);
  assert.equal([...files].filter((f) => f.endsWith('.jpg')).length, 12);
  for (const row of r.rows) assert.equal(row.shop, 'Fernhill Home');
  assert.ok(r.rows.every((row) => !/handmade|discount|%|cm\b|inch/i.test(row.fact)), 'facts claim nothing that cannot be seen');
  assert.ok(r.rows.every((row) => !/[\u2013\u2014]/.test(row.fact)));
});

test('the Demo set picks eight sample rows in the demo order, and leaves out any that are missing', async () => {
  const { readFileSync } = await import('node:fs');
  const { readCatalogue } = await import('../../src/lib/catalogue/csv.ts');
  const { DEMO_SKUS, pickDemoRows } = await import('../../src/lib/catalogue/model.ts');
  const rows = readCatalogue(readFileSync('demo-assets/catalogue/catalogue.csv', 'utf8')).rows;
  assert.deepEqual(pickDemoRows(rows).map((r) => r.sku), ['mug-white', 'tote-jute', 'lamp-table', 'stool-wooden', 'notebook-black', 'flask-steel', 'busy-background', 'pouch-in-hand']);
  assert.equal(DEMO_SKUS.length, 8);
  assert.deepEqual(pickDemoRows(rows.filter((r) => r.sku !== 'flask-steel')).map((r) => r.sku).length, 7);
  assert.deepEqual(pickDemoRows([]), []);
  assert.ok(pickDemoRows(rows).every((r) => r.shop === 'Fernhill Home'), 'all from the fictional shop');
});

test('a Look change keeps the layout when the Look allows it, else uses the Look\'s first; times read in plain words', async () => {
  const { archetypeFor } = await import('../../src/lib/catalogue/campaign.ts');
  const { durationText, bulkSummary } = await import('../../src/lib/catalogue/model.ts');
  assert.equal(archetypeFor('loud', 'behind'), 'behind');
  assert.equal(archetypeFor('loud', 'product'), 'product');
  assert.equal(archetypeFor('sticker', 'behind'), 'product', 'Sticker Pack only has the studio layout');
  assert.equal(archetypeFor('magazine', 'behind'), 'behind');
  assert.equal(archetypeFor('nonsense', 'behind'), 'behind');
  assert.equal(durationText(12400), '12 s');
  assert.equal(durationText(466000), '7 min 46 s');
  assert.equal(durationText(0), '0 s');
  const plan = { redraw: [], byHand: [], photographs: [{}], busy: [] };
  assert.equal(bulkSummary(5, 0, { ...plan, photographs: [] }, 12000), 'Redrew 5 ads in 12 s. Scores are out of date until you revise an ad.');
  assert.match(bulkSummary(4, 0, plan, 9000), /^Redrew 4 ads in 9 s\. 1 skipped because effects apply to cut-out ads only/);
});
