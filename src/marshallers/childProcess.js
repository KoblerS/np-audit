'use strict';

const { Marshaller } = require('./base');

class ChildProcessMarshaller extends Marshaller {
  constructor() {
    super('child-process', 'Shell / process execution detection');
  }

  check(code) {
    const patterns = [
      /require\s*\(\s*['"]child_process['"]\s*\)/,
      /require\s*\(\s*['"]node:child_process['"]\s*\)/,
      /require\s*\(\s*['"`][^'"`]*['"`](?:\s*\+\s*['"`][^'"`]*['"`])+\s*\)/,
      /require\s*\(\s*[a-zA-Z_$][\w$]*\s*\[/,
      /\bexec\s*\(/,
      /\bspawn\s*\(/,
      /\bexecSync\s*\(/,
      /\bspawnSync\s*\(/,
      /\bexecFile\s*\(/,
      /\bexecFileSync\s*\(/,
      /\bfork\s*\(/,
      /require\s*\(\s*['"]worker_threads['"]\s*\)/,
      /new\s+Worker\s*\(/,
    ];
    const matched = patterns.filter(p => p.test(code));
    if (matched.length === 0) return null;
    return { name: this.name, score: 5, detail: `Shell/process execution found (${matched.length} pattern(s))` };
  }
}

module.exports = new ChildProcessMarshaller();
