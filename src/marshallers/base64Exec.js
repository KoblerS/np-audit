'use strict';

const { Marshaller } = require('./base');

class Base64ExecMarshaller extends Marshaller {
  constructor() {
    super('encoded-decode', 'Encoded decode + execution detection');
  }

  check(code) {
    const hasBase64 = /atob\s*\(|Buffer\.from\s*\([^)]*,\s*['"]base64['"]\)/.test(code);
    const hasHexDecode = /Buffer\.from\s*\([^)]*,\s*['"]hex['"]\)/.test(code);
    const hasExec   = /\beval\s*\(|new\s+Function\s*\(|\.exec\s*\(|\(\s*0\s*,\s*eval\s*\)\s*\(/.test(code);
    if (!hasBase64 && !hasHexDecode) return null;
    const kind = hasBase64 ? 'Base64' : 'Hex';
    if (!hasExec) {
      return { name: 'encoded-decode', score: 3, detail: `${kind} decode found — verify usage` };
    }
    return { name: 'encoded-decode+exec', score: 8, detail: `${kind} decode with code execution found` };
  }
}

module.exports = new Base64ExecMarshaller();
