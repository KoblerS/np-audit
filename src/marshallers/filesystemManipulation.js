'use strict';

const { Marshaller } = require('./base');

class FilesystemManipulationMarshaller extends Marshaller {
  constructor() {
    super('filesystem-manipulation', 'Filesystem manipulation detection');
  }

  check(code) {
    const writePatterns = [
      /fs\.write(?:File)?(?:Sync)?\s*\(/,
      /fs\.append(?:File)?(?:Sync)?\s*\(/,
      /fs\.create(?:WriteStream)?\s*\(/,
      /\.pipe\s*\(/,
    ];
    const permissionPatterns = [
      /fs\.chmod(?:Sync)?\s*\(/,
      /fs\.chown(?:Sync)?\s*\(/,
      /fs\.access(?:Sync)?\s*\(/,
    ];
    const linkPatterns = [
      /fs\.symlink(?:Sync)?\s*\(/,
      /fs\.link(?:Sync)?\s*\(/,
    ];

    const writeMatches = writePatterns.filter(p => p.test(code)).length;
    const permMatches = permissionPatterns.filter(p => p.test(code)).length;
    const linkMatches = linkPatterns.filter(p => p.test(code)).length;

    if (writeMatches === 0 && permMatches === 0 && linkMatches === 0) return null;

    const details = [];
    if (writeMatches > 0) details.push(`${writeMatches} write operation(s)`);
    if (permMatches > 0) details.push(`${permMatches} permission change(s)`);
    if (linkMatches > 0) details.push(`${linkMatches} symlink operation(s)`);

    let score = 3;
    if ((writeMatches > 0 ? 1 : 0) + (permMatches > 0 ? 1 : 0) + (linkMatches > 0 ? 1 : 0) >= 2) {
      score = 4;
    }

    return { name: this.name, score, detail: details.join(', ') };
  }
}

module.exports = new FilesystemManipulationMarshaller();
