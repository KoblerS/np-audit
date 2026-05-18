'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/networkCalls');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('const fs = require("fs")'), null, 'fs = null');
assert.ok(m.check('require("https")'), 'require https');
assert.ok(m.check('fetch("http://example.com")'), 'fetch()');
assert.ok(m.check('require("node:dns")'), 'node:dns');

console.log('    networkCalls.test.js: passed');
