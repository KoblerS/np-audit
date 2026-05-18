'use strict';

const assert = require('assert');
const { getStaticMarshallers } = require('../../../src/marshallers');
const { Marshaller } = require('../../../src/marshallers/base');

const marshallers = getStaticMarshallers();

// All marshallers are instances of Marshaller
assert.ok(marshallers.every(m => m instanceof Marshaller), 'all are Marshaller instances');
assert.ok(marshallers.every(m => typeof m.check === 'function'), 'all have check()');
assert.strictEqual(marshallers.length, 13, '13 static marshallers loaded');

// All return null for clean code
for (const m of marshallers) {
  const clean = m.check('const x = 1; function hello() { return "world"; }');
  assert.strictEqual(clean, null, `${m.name}: clean code returns null`);
}

// Run individual test files
require('./eval.test');
require('./obfuscatorIo.test');
require('./highEntropy.test');
require('./hexEscapes.test');
require('./fromCharCode.test');
require('./base64Exec.test');
require('./childProcess.test');
require('./hexArray.test');
require('./processEnv.test');
require('./networkCalls.test');
require('./filesystemManipulation.test');
require('./runtimeDownload.test');
require('./vscodeTasks.test');

console.log('  marshallers/: all tests passed');
