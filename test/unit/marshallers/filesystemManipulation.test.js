'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/filesystemManipulation');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('fs.readFileSync("x")'), null, 'read = null');
const r1 = m.check('fs.writeFileSync("x", "data")');
assert.ok(r1 && r1.score === 3, 'write = score 3');
const r2 = m.check('fs.writeFileSync("x", "y"); fs.chmodSync("x", 0o755)');
assert.ok(r2 && r2.score === 4, 'write + chmod = score 4');
assert.ok(m.check('fs.symlinkSync("a", "b")'), 'symlink detected');

console.log('    filesystemManipulation.test.js: passed');
