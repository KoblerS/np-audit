'use strict';

const { scan } = require('../core/scanner');
const { runAware, runNpm } = require('../utils/aware');
const output = require('../utils/output');

module.exports = {
  name: 'install',
  aliases: ['i'],
  description: 'Audit then run npm install',

  help() {
    return `
  npa install — Audit dependencies then run npm install

  Usage:
    npa install [package] [options]

  Options:
    --aware, -a   Interactive mode: review and allow/deny scripts
    --json        Output scan results as JSON
    --no-dev      Skip devDependencies in scan
    --verbose     Show detailed findings
    -h, --help    Show this help

  Examples:
    npa install                Install all deps after audit
    npa install lodash         Add lodash after auditing it
    npa install --aware        Review scripts interactively
`;
  },

  async run({ args, flags, config, cwd }) {
    const pkgName = args[0] || null;

    output.printScanHeader();

    const results = await scan({
      cwd,
      config,
      noDev:         flags.noDev,
      verbose:       flags.verbose,
      singlePackage: pkgName,
    });

    if (flags.json) {
      process.stdout.write(JSON.stringify(toJsonReport(results), null, 2) + '\n');
    } else {
      printResults(results);
    }

    const blocked = results.filter(r => r.verdict === 'BLOCK');

    if (blocked.length > 0 && !flags.aware) {
      output.error(`${blocked.length} package(s) blocked due to obfuscated install scripts.`);
      output.log(output.dim('  Run with --aware to interactively decide which scripts to allow.'));
      process.exit(1);
    }

    const npmArgs = pkgName ? [pkgName] : [];

    if (flags.aware) {
      const packagesWithScripts = results.filter(r => r.verdict !== 'OK' || r.scripts.length > 0);
      const exit = await runAware({
        results: packagesWithScripts.length > 0 ? packagesWithScripts : results,
        command: 'install',
        npmArgs,
        cwd,
      });
      process.exit(exit);
    } else {
      const exit = runNpm('install', npmArgs, cwd);
      process.exit(exit);
    }
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
