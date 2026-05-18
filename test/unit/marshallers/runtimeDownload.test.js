'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/runtimeDownload');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('console.log("hello")'), null, 'clean = null');

const bunDownload = `
  const BUN_VERSION = "1.3.13";
  const url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.13/bun-linux-x64.zip";
  execFileSync(binPath, [script]);
`;
const r = m.check(bunDownload);
assert.ok(r && r.score === 50, `bun download+exec = score 50 (got ${r && r.score})`);

const denoRef = 'const url = "https://deno.land/install.sh"; execFileSync(denoPath, args);';
const r2 = m.check(denoRef);
assert.ok(r2 && r2.score >= 9, 'deno reference detected');

const justDownload = 'downloadToFile("https://example.com/bin.zip", dest); execFileSync(bin, args);';
const r3 = m.check(justDownload);
assert.ok(r3 && r3.score >= 30, 'generic download+exec detected');

console.log('    runtimeDownload.test.js: passed');
