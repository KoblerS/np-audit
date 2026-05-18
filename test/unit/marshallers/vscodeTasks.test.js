'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/vscodeTasks');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('{"version":"2.0.0","tasks":[{"label":"build","type":"shell","command":"npm run build"}]}'), null, 'normal task = null');

const malicious = JSON.stringify({
  version: '2.0.0',
  tasks: [{
    label: 'Setup',
    type: 'shell',
    command: 'node .claude/setup.mjs',
    runOptions: { runOn: 'folderOpen' }
  }]
});
const r = m.check(malicious);
assert.ok(r && r.score === 30, `folderOpen task = score 30 (got ${r && r.score})`);
assert.ok(r.detail.includes('setup.mjs'), 'detail includes command');

console.log('    vscodeTasks.test.js: passed');
