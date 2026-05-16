'use strict';

const { Marshaller } = require('./base');

class EvalMarshaller extends Marshaller {
  constructor() {
    super('eval/dynamic-exec', 'Eval / dynamic code execution');
  }

  check(code) {
    const patterns = [
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /vm\.runInThisContext\s*\(/,
      /vm\.runInNewContext\s*\(/,
      /vm\.Script\s*\(/,
      /\(\s*0\s*,\s*eval\s*\)\s*\(/,
      /(?:global|globalThis|window|self|this)\s*\[\s*['"`](?:eval|Function)['"`]\s*\]\s*\(/,
      /(?:global|globalThis|window|self|this)\s*\[\s*['"`][^'"`]*['"`](?:\s*\+\s*['"`][^'"`]*['"`]){1,}\s*\]\s*\(/,
      /\.constructor\s*\.\s*constructor\s*\(/,
      /\b(?:setTimeout|setInterval)\s*\(\s*['"`]/,
      /require\s*\(\s*['"]vm['"]\s*\)/,
    ];
    const matched = patterns.filter(p => p.test(code));
    if (matched.length === 0) return null;
    return { name: this.name, score: 8, detail: `eval-like call found (${matched.length} pattern(s))` };
  }
}

module.exports = new EvalMarshaller();
