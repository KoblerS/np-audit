'use strict';

const { Marshaller } = require('./base');

class ProcessEnvMarshaller extends Marshaller {
  constructor() {
    super('process-env', 'Process environment access detection');
  }

  check(code) {
    const matches = (code.match(/process\.env\b/g) || []).length;
    if (matches === 0) return null;
    return { name: this.name, score: 3, detail: `${matches} process.env access(es)` };
  }
}

module.exports = new ProcessEnvMarshaller();
