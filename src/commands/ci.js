'use strict';

const { scan } = require('../core/scanner');
const { runAware, runNpm } = require('../utils/review');
const output = require('../utils/output');

module.exports = {
  name: 'ci',
  aliases: [],
  description: 'Audit then run npm ci',

  help() {
    return `
  npa ci — Audit dependencies then run npm ci

  Usage:
    npa ci [options]

  Options:
    --review, -r   Interactive mode: review and allow/deny scripts
    --json        Output scan results as JSON
    --no-dev      Skip devDependencies in scan
    --verbose     Show detailed findings
    -h, --help    Show this help

  Examples:
    npa ci            Clean install after audit
    npa ci --review    Review scripts interactively
`;
  },

  async run({ flags, config, cwd }) {
    const spinner = !flags.json && !config.silent ? output.createSpinner('Auditing packages...') : null;
    if (spinner) spinner.start();
    const t0 = Date.now();
    const results = await scan({ cwd, config, noDev: flags.noDev, verbose: flags.verbose });
    const elapsedMs = Date.now() - t0;
    if (spinner) spinner.stop();
    const hasIssues = results.some(r => r.verdict !== 'OK');
    const silent = config.silent && !hasIssues;

    output.printScanHeader(silent);

    if (flags.json) {
      process.stdout.write(JSON.stringify(toJsonReport(results), null, 2) + '\n');
    } else {
      printResults(results, silent);
      if (!silent) output.printSummary(results, elapsedMs);
    }

    const blocked = results.filter(r => r.verdict === 'BLOCK');

    if (blocked.length > 0 && !flags.review) {
      output.error(`${blocked.length} package(s) blocked — suspicious or malicious packages detected.`);
      process.exit(1);
    }

    if (flags.review) {
      const exit = await runAware({ results, command: 'ci', npmArgs: [], cwd });
      process.exit(exit);
    } else {
      const exit = runNpm('ci', [], cwd);
      process.exit(exit);
    }
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
