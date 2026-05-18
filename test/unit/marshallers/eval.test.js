'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/eval');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.ok(m.check('eval("code")'), 'detects eval()');
assert.ok(m.check('new Function("return 1")'), 'detects new Function');
assert.ok(m.check('(0, eval)("code")'), 'detects indirect eval');
assert.ok(m.check('globalThis["eval"]("x")'), 'detects bracket-access eval');
assert.ok(m.check('({}).constructor.constructor("code")()'), 'detects constructor chain');
assert.ok(m.check("setTimeout('alert(1)', 100)"), 'detects setTimeout with string');
assert.ok(m.check("require('vm')"), 'detects require vm');
assert.strictEqual(m.check('setTimeout(fn, 100)'), null, 'setTimeout with function ref is OK');

console.log('    eval.test.js: passed');
