'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/hexEscapes');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('var x = "\\x41";'), null, '1 escape = null');
const dense = 'var x = "' + Array.from({length: 15}, (_, i) => `\\x${(65+i).toString(16)}`).join('') + '";';
assert.ok(m.check(dense), '15 escapes = finding');
const unicode = 'var x = "' + Array.from({length: 12}, () => '\\u0041').join('') + '";';
assert.ok(m.check(unicode), '12 unicode escapes = finding');

console.log('    hexEscapes.test.js: passed');
