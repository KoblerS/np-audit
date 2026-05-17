'use strict';

const { Marshaller } = require('./base');
const { shannonEntropy } = require('../utils/entropy');

class HighEntropyMarshaller extends Marshaller {
  constructor() {
    super('high-entropy-string', 'High-entropy string detection');
  }

  check(code) {
    let maxEntropy = 0;
    let worst = '';
    const minLen = 50;

    for (const quote of ['"', "'", '`']) {
      let pos = 0;
      while (pos < code.length) {
        const start = code.indexOf(quote, pos);
        if (start === -1) break;

        let end = start + 1;
        while (end < code.length) {
          if (code[end] === '\\') { end += 2; continue; }
          if (code[end] === quote) break;
          end++;
        }

        if (end < code.length && end - start - 1 >= minLen) {
          const s = code.slice(start + 1, end);
          const e = shannonEntropy(s);
          if (e > maxEntropy) { maxEntropy = e; worst = s.slice(0, 40); }
        }
        pos = end + 1;
      }
    }

    if (maxEntropy >= 4.5) {
      return {
        name: this.name,
        score: 6,
        detail: `Entropy ${maxEntropy.toFixed(2)} in string "${worst}…"`,
      };
    }

    const concatChainRe = /(?:['"`][^'"`\n]{0,40}['"`]\s*\+\s*){5,}['"`][^'"`\n]{0,40}['"`]/g;
    let m;
    let bestChain = '';
    while ((m = concatChainRe.exec(code)) !== null) {
      const literals = m[0].match(/['"`]([^'"`\n]{0,40})['"`]/g) || [];
      const joined = literals.map(l => l.slice(1, -1)).join('');
      if (joined.length >= 40) {
        const e = shannonEntropy(joined);
        if (e > maxEntropy) { maxEntropy = e; bestChain = joined.slice(0, 40); }
      }
    }

    if (maxEntropy >= 4.5) {
      return {
        name: this.name,
        score: 6,
        detail: `Entropy ${maxEntropy.toFixed(2)} in concatenated literals "${bestChain}…"`,
      };
    }

    return null;
  }
}

module.exports = new HighEntropyMarshaller();
