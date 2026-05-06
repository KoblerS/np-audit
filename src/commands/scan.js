'use strict';

const { scan } = require('../core/scanner');
const output = require('../utils/output');

module.exports = {
  name: 'scan',
  aliases: ['s'],
  description: 'Scan only, no npm invocation',

  help() {
    return `
  npa scan — Scan dependencies for obfuscated install scripts

  Usage:
    npa scan [options]

  Options:
    --json        Output results as JSON
    --no-dev      Skip devDependencies
    --verbose     Show detailed findings
    -h, --help    Show this help

  Examples:
    npa scan              Scan all dependencies
    npa scan --no-dev     Scan production dependencies only
    npa scan --json       Output machine-readable JSON
`;
  },

  async run({ flags, config, cwd }) {
    output.printScanHeader();

    const results = await scan({ cwd, config, noDev: flags.noDev, verbose: flags.verbose });

    if (flags.json) {
      process.stdout.write(JSON.stringify(toJsonReport(results), null, 2) + '\n');
      const hasBlock = results.some(r => r.verdict === 'BLOCK');
      process.exit(hasBlock ? 1 : 0);
    }

    printResults(results);
    output.printSummary(results.map(r => ({ verdict: r.verdict })));

    const hasBlock = results.some(r => r.verdict === 'BLOCK');
    process.exit(hasBlock ? 1 : 0);
  },
};

function printResults(results) {
  if (results.length === 0) {
    output.success('No packages with install scripts found.');
    return;
  }
  for (const r of results) {
    output.printPackageResult(r.pkg, r);
  }
}

function toJsonReport(results) {
  return {
    summary: {
      total:   results.length,
      blocked: results.filter(r => r.verdict === 'BLOCK').length,
      warned:  results.filter(r => r.verdict === 'WARN').length,
      ok:      results.filter(r => r.verdict === 'OK').length,
    },
    packages: results.map(r => ({
      name:     r.pkg.name,
      version:  r.pkg.version,
      verdict:  r.verdict,
      score:    r.score,
      findings: r.findings,
      scripts:  r.scripts.map(s => ({ lifecycle: s.lifecycle, file: s.file, score: s.score })),
    })),
  };
}
