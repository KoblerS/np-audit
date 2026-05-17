'use strict';

const { Marshaller } = require('./base');

class FromCharCodeMarshaller extends Marshaller {
  constructor() {
    super('fromCharCode', 'String.fromCharCode obfuscation detection');
  }

  check(code) {
    let maxArgs = 0;
    const direct = /(?:String|[\w$]+)\.fromCharCode\s*\(([^)]+)\)/g;
    let match;
    while ((match = direct.exec(code)) !== null) {
      const args = match[1].split(',').filter(a => /^\s*\d+\s*$/.test(a));
      if (args.length > maxArgs) maxArgs = args.length;
    }

    const arrRe = /\[\s*((?:\d{1,3}\s*,\s*){7,}\d{1,3})\s*\]/g;
    let arrMatch;
    let maxArr = 0;
    while ((arrMatch = arrRe.exec(code)) !== null) {
      const nums = arrMatch[1].split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !Number.isNaN(n));
      const printable = nums.filter(n => n >= 32 && n <= 126).length;
      if (printable / nums.length >= 0.9 && nums.length > maxArr) maxArr = nums.length;
    }

    if (maxArgs >= 5) {
      return { name: this.name, score: 7, detail: `fromCharCode with ${maxArgs} numeric args` };
    }
    if (maxArr >= 16) {
      return { name: this.name, score: 7, detail: `decimal char-code array of length ${maxArr}` };
    }
    return null;
  }
}

module.exports = new FromCharCodeMarshaller();
