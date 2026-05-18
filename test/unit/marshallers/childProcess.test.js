'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/childProcess');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('const fs = require("fs")'), null, 'fs = null');
assert.ok(m.check('require("child_process")'), 'direct require');
assert.ok(m.check('require("node:child_process")'), 'node: prefix');
assert.ok(m.check('execSync("ls")'), 'execSync');
assert.ok(m.check('new Worker("./w.js")'), 'new Worker');

console.log('    childProcess.test.js: passed');
