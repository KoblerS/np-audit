'use strict';

const { scan } = require('../core/scanner');
const output = require('../utils/output');

module.exports = {
  name: 'scan',
  aliases: ['s'],
  description: 'Scan only, no npm invocation',

  help() {
    return `
  npa scan — Scan dependencies for security issues

  Usage:
    npa scan [package] [options]

  Options:
    --json        Output results as JSON
    --no-dev      Skip devDependencies
    --verbose     Show detailed findings
    -h, --help    Show this help

  Examples:
    npa scan              Scan all dependencies
    npa scan lodash       Scan a specific package before installing
    npa scan --no-dev     Scan production dependencies only
    npa scan --json       Output machine-readable JSON
`;
  },

  async run({ args, flags, config, cwd }) {
    const packages = args.filter(a => !a.startsWith('-'));
    const spinner = !flags.json && !config.silent ? output.createSpinner('Auditing packages...') : null;
    if (spinner) spinner.start();
    const t0 = Date.now();
    const results = await scan({ cwd, config, noDev: flags.noDev, verbose: flags.verbose, packages: packages.length > 0 ? packages : null });
    const elapsedMs = Date.now() - t0;
    if (spinner) spinner.stop();
    const hasIssues = results.some(r => r.verdict !== 'OK');
    const silent = config.silent && !hasIssues;

    output.printScanHeader(silent);

    if (flags.json) {
      process.stdout.write(JSON.stringify(toJsonReport(results), null, 2) + '\n');
      const hasBlock = results.some(r => r.verdict === 'BLOCK');
      process.exit(hasBlock ? 1 : 0);
    }

    printResults(results, silent);
    if (!silent) output.printSummary(results, elapsedMs);

    const hasBlock = results.some(r => r.verdict === 'BLOCK');
    process.exit(hasBlock ? 1 : 0);
  },
};

function printResults(results, silent = false) {
  if (silent) return;
  if (results.length === 0) {
    output.success('No issues found.');
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
