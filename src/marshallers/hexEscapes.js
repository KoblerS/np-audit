'use strict';

const { Marshaller } = require('./base');

class HexEscapesMarshaller extends Marshaller {
  constructor() {
    super('hex-escape-density', 'Dense hex/unicode escape detection');
  }

  check(code) {
    const hexMatches     = (code.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
    const unicodeMatches = (code.match(/\\u[0-9a-fA-F]{4}/g) || []).length
                         + (code.match(/\\u\{[0-9a-fA-F]+\}/g) || []).length;
    const total = hexMatches + unicodeMatches;
    if (total < 10) return null;
    let score = 5;
    if (total > 1000) score = 50;
    else if (total > 200) score = 30;
    else if (total > 50) score = 15;
    const detail = unicodeMatches > 0
      ? `${hexMatches} \\xNN + ${unicodeMatches} \\uXXXX escapes found`
      : `${hexMatches} \\xNN hex escapes found`;
    return { name: this.name, score, detail };
  }
}

module.exports = new HexEscapesMarshaller();
