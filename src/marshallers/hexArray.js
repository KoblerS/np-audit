'use strict';

const { Marshaller } = require('./base');

class HexArrayMarshaller extends Marshaller {
  constructor() {
    super('hex-array', 'Hex literal array detection');
  }

  check(code) {
    const hexLiterals = (code.match(/\b0x[0-9a-fA-F]+\b/g) || []).length;
    if (hexLiterals < 20) return null;
    let score = 7;
    if (hexLiterals > 2000) score = 60;
    else if (hexLiterals > 500) score = 40;
    else if (hexLiterals > 100) score = 20;
    return { name: this.name, score, detail: `${hexLiterals} hex literal values found` };
  }
}

module.exports = new HexArrayMarshaller();
