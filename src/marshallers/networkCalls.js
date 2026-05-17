'use strict';

const { Marshaller } = require('./base');

class NetworkCallsMarshaller extends Marshaller {
  constructor() {
    super('network-call', 'Suspicious network call detection');
  }

  check(code) {
    const patterns = [
      /require\s*\(\s*['"]https?['"]\s*\)/,
      /require\s*\(\s*['"]net['"]\s*\)/,
      /require\s*\(\s*['"]dns['"]\s*\)/,
      /require\s*\(\s*['"]tls['"]\s*\)/,
      /require\s*\(\s*['"]dgram['"]\s*\)/,
      /require\s*\(\s*['"]http2['"]\s*\)/,
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /\.request\s*\(/,
      /require\s*\(\s*['"]node:(?:https?|net|dns|tls|dgram|http2)['"]\s*\)/,
      /import\s*\(\s*['"](?:node:)?(?:https?|net|dns|tls|dgram|http2)['"]\s*\)/,
    ];
    const matched = patterns.filter(p => p.test(code));
    if (matched.length === 0) return null;
    return { name: this.name, score: 4, detail: `Network call found (${matched.length} pattern(s))` };
  }
}

module.exports = new NetworkCallsMarshaller();
