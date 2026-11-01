// The EXIF stripper removes camera and location metadata in place and --check reports which files still have it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const script = new URL('../../scripts/strip-exif.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

test('a JPEG with EXIF is flagged by --check, cleaned by the script, and clean afterwards', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cda-exif-'));
  const file = join(dir, 'photo.jpg');
  await sharp({ create: { width: 32, height: 32, channels: 3, background: '#445566' } }).jpeg().withExif({ IFD0: { Copyright: 'someone', Artist: 'a person' } }).toFile(file);
  assert.ok((await sharp(readFileSync(file)).metadata()).exif, 'the test image starts with EXIF');

  const before = spawnSync(process.execPath, [script, '--check', dir], { encoding: 'utf8' });
  assert.equal(before.status, 1);
  assert.match(before.stdout, /HAS METADATA/);

  const run = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /stripped/);
  const meta = await sharp(readFileSync(file)).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.width, 32);

  const after = spawnSync(process.execPath, [script, '--check', dir], { encoding: 'utf8' });
  assert.equal(after.status, 0);
  assert.match(after.stdout, /clean/);
});
