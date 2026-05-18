'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/highEntropy');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('const s = "hello world";'), null, 'short string = null');
const highEntropy = 'const s = "' + 'aB3$kLm9@pQr5vWx1Yz7#hJnFgTcEiDoUbA4sKlM8PqR6VwX2yZ0' + '";';
assert.ok(m.check(highEntropy), 'high-entropy long string detected');

console.log('    highEntropy.test.js: passed');
