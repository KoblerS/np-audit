'use strict';

const { Marshaller } = require('./base');

class ObfuscatorIoMarshaller extends Marshaller {
  constructor() {
    super('obfuscator.io', 'Obfuscator.io signature detection');
  }

  check(code) {
    const matches = code.match(/_0x[0-9a-fA-F]+/g) || [];
    if (matches.length < 3) return null;
    let score = 9;
    if (matches.length > 1000) score = 80;
    else if (matches.length > 200) score = 50;
    else if (matches.length > 50) score = 30;
    else if (matches.length > 10) score = 15;
    return { name: this.name, score, detail: `${matches.length} _0x identifiers found` };
  }
}

module.exports = new ObfuscatorIoMarshaller();
