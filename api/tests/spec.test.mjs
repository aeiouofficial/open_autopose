/* Node test suite for the tp.job/v1 contract. Dependency-free: uses node:test +
 * node:assert and the SAME api/tp-spec.js the browser app embeds. Run with:
 *   node --test api/tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiDir = join(__dirname, '..');
const require = createRequire(import.meta.url);
const TPSpec = require(join(apiDir, 'tp-spec.js'));

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('exports validateJob + normalizeJob + SPEC_VERSION', () => {
  assert.equal(TPSpec.SPEC_VERSION, 'tp.job/v1');
  assert.equal(typeof TPSpec.validateJob, 'function');
  assert.equal(typeof TPSpec.normalizeJob, 'function');
});

test('empty job is valid and fully defaulted', () => {
  const r = TPSpec.validateJob({});
  assert.equal(r.valid, true, r.errors.join('; '));
  const n = TPSpec.normalizeJob({});
  assert.equal(n.fps, 'auto');
  assert.deepEqual(n.range, { mode: 'all' });
  assert.equal(n.characters, 1);
  assert.equal(n.pose.enabled, true);
  assert.equal(n.pose.style, 'openpose');
  assert.equal(n.depth.enabled, false);
  assert.equal(n.depth.engine, 'fast');
  assert.deepEqual(n.output, { format: ['mp4'], resolution: 'source' });
});

test('all bundled example jobs validate as declared', () => {
  const exDir = join(apiDir, 'examples');
  for (const f of readdirSync(exDir).filter(f => f.endsWith('.json'))) {
    const spec = readJson(join(exDir, f));
    const r = TPSpec.validateJob(spec);
    if (f.startsWith('invalid')) assert.equal(r.valid, false, `${f} should be invalid`);
    else assert.equal(r.valid, true, `${f} should be valid: ${r.errors.join('; ')}`);
  }
});

test('range: frames, seconds, and rejects backwards ranges', () => {
  assert.deepEqual(TPSpec.normalizeJob({ range: { inFrame: 10, outFrame: 40 } }).range, { mode: 'frames', inFrame: 10, outFrame: 40 });
  assert.deepEqual(TPSpec.normalizeJob({ range: { startSec: 1, endSec: 3 } }).range, { mode: 'seconds', startSec: 1, endSec: 3 });
  assert.equal(TPSpec.validateJob({ range: { inFrame: 40, outFrame: 10 } }).valid, false);
  assert.equal(TPSpec.validateJob({ range: { startSec: 3, endSec: 1 } }).valid, false);
});

test('enum + bound violations are rejected', () => {
  assert.equal(TPSpec.validateJob({ depth: { engine: 'turbo' } }).valid, false);
  assert.equal(TPSpec.validateJob({ characters: 9 }).valid, false);
  assert.equal(TPSpec.validateJob({ characters: 0 }).valid, false);
  assert.equal(TPSpec.validateJob({ confidence: 2 }).valid, false);
  assert.equal(TPSpec.validateJob({ fps: 0 }).valid, false);
  assert.equal(TPSpec.validateJob({ fps: 500 }).valid, false);
  assert.equal(TPSpec.validateJob({ output: { format: 'gif' } }).valid, false);
  assert.equal(TPSpec.validateJob({ output: { resolution: 999 } }).valid, false);
});

test('fps accepts "auto" and in-band numbers', () => {
  assert.equal(TPSpec.validateJob({ fps: 'auto' }).valid, true);
  assert.equal(TPSpec.validateJob({ fps: 24 }).valid, true);
  assert.equal(TPSpec.normalizeJob({ fps: 30 }).fps, 30);
});

test('cross-field warnings: json-without-pose and vda-needs-webgpu', () => {
  const w1 = TPSpec.validateJob({ pose: { enabled: false }, output: { format: ['json'] } }).warnings.join(' ');
  assert.match(w1, /json requires pose tracking/i);
  const w2 = TPSpec.validateJob({ depth: { enabled: true, engine: 'vda' } }).warnings.join(' ');
  assert.match(w2, /webgpu/i);
});

test('normalizeJob throws on invalid input with a useful message', () => {
  assert.throws(() => TPSpec.normalizeJob({ characters: 42 }), /Invalid tp\.job\/v1/);
});

test('multi-format output is preserved and de-arrayed input works', () => {
  assert.deepEqual(TPSpec.normalizeJob({ output: { format: ['mp4', 'json'] } }).output.format, ['mp4', 'json']);
  assert.deepEqual(TPSpec.normalizeJob({ output: { format: 'png' } }).output.format, ['png']);
});

test('schema files are well-formed JSON', () => {
  const job = readJson(join(apiDir, 'tp.job.schema.json'));
  const man = readJson(join(apiDir, 'tp.manifest.schema.json'));
  assert.equal(job.$id.includes('tp.job/v1'), true);
  assert.equal(man.properties.manifest.const, 'tp.manifest/v1');
});
