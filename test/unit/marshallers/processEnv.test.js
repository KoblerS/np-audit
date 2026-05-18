'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/processEnv');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.ok(m.check('const token = process.env.TOKEN;'), 'detects access');

console.log('    processEnv.test.js: passed');
