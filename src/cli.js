'use strict';

const { scan }      = require('./scanner');
const { runAware, runNpm } = require('./aware');
const { loadConfig, setGlobalConfig, getGlobalConfigPath, DEFAULT_CONFIG } = require('./config');
const output        = require('./output');

const VERSION = require('../package.json').version;
const NAME    = require('../package.json').name;

const HELP = `
  npa — npm package auditor ${VERSION}
  Statically detects obfuscated code in npm install scripts.

  Usage:
    npa install [package]    Audit then run npm install  (alias: i)
    npa ci                   Audit then run npm ci
    npa scan                 Scan only, no npm invocation (alias: s)
    npa config get           Show current configuration   (alias: c)
    npa config set <k> <v>   Set a config value

  Flags:
    --aware, -a   Interactive mode: choose which scripts to allow
    --json        Machine-readable JSON output
    --no-dev      Skip devDependencies
    --verbose     Show extra detail
    --version     Print version
    --help, -h    Print this help

  Config keys (stored in ~/.npmauditor.json):
    blockScore       Score threshold for hard block (default: ${DEFAULT_CONFIG.blockScore})
    warnScore        Score threshold for warning (default: ${DEFAULT_CONFIG.warnScore})
    registry         npm registry URL (default: ${DEFAULT_CONFIG.registry})
    timeout          HTTP timeout in ms (default: ${DEFAULT_CONFIG.timeout})
    parallelFetches  Concurrent downloads (default: ${DEFAULT_CONFIG.parallelFetches})
    skipScopes       Array of @scopes to skip
    skipPackages     Array of package names to skip

  Install:
    npm install -g np-audit
    npx np-audit scan
`;

function parseArgs(argv) {
  const args  = argv.slice(2);
  const flags = {
    aware:   false,
    json:    false,
    noDev:   false,
    verbose: false,
    version: false,
    help:    false,
  };
  const positionals = [];

  for (const arg of args) {
    switch (arg) {
      case '--aware':
      case '-a':         flags.aware   = true; break;
      case '--json':     flags.json    = true; break;
      case '--no-dev':   flags.noDev   = true; break;
      case '--verbose':  flags.verbose = true; break;
      case '--version':  flags.version = true; break;
      case '--help':
      case '-h':         flags.help    = true; break;
      default:
        if (!arg.startsWith('-')) positionals.push(arg);
    }
  }

  const command = positionals[0] || null;
  const cmdArgs = positionals.slice(1);
  return { command, cmdArgs, flags };
}

async function runInstall(pkgName, flags, config, cwd) {
  output.printScanHeader();

  const results = await scan({
    cwd,
    config,
    noDev:         flags.noDev,
    verbose:       flags.verbose,
    singlePackage: pkgName || null,
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
}

async function runCi(flags, config, cwd) {
  output.printScanHeader();

  const results = await scan({ cwd, config, noDev: flags.noDev, verbose: flags.verbose });

  if (flags.json) {
    process.stdout.write(JSON.stringify(toJsonReport(results), null, 2) + '\n');
  } else {
    printResults(results);
  }

  const blocked = results.filter(r => r.verdict === 'BLOCK');

  if (blocked.length > 0 && !flags.aware) {
    output.error(`${blocked.length} package(s) blocked due to obfuscated install scripts.`);
    process.exit(1);
  }

  if (flags.aware) {
    const exit = await runAware({ results, command: 'ci', npmArgs: [], cwd });
    process.exit(exit);
  } else {
    const exit = runNpm('ci', [], cwd);
    process.exit(exit);
  }
}

async function runScan(flags, config, cwd) {
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
}

async function runConfig(cmdArgs, config) {
  const subcommand = cmdArgs[0];

  if (subcommand === 'get') {
    const globalPath = getGlobalConfigPath();
    output.log(output.bold('  Current npa configuration'));
    output.log(output.dim(`  (global: ${globalPath})`));
    output.log('');
    for (const [key, val] of Object.entries(config)) {
      output.log(`  ${output.cyan(key.padEnd(18))} ${JSON.stringify(val)}`);
    }
    output.log('');
    return;
  }

  if (subcommand === 'set') {
    const key   = cmdArgs[1];
    const value = cmdArgs[2];
    if (!key || value === undefined) {
      output.error('Usage: npa config set <key> <value>');
      process.exit(1);
    }
    try {
      const updated = setGlobalConfig(key, value);
      output.success(`Set ${key} = ${JSON.stringify(updated[key])}`);
      output.log(output.dim(`  Written to ${getGlobalConfigPath()}`));
    } catch (err) {
      output.error(err.message);
      process.exit(1);
    }
    return;
  }

  output.error(`Unknown config subcommand: "${subcommand}". Use "get" or "set".`);
  process.exit(1);
}

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

async function main() {
  const { command, cmdArgs, flags } = parseArgs(process.argv);
  const cwd    = process.cwd();
  const config = loadConfig(cwd);

  if (flags.version) {
    process.stdout.write(`npa ${VERSION} (${NAME})\n`);
    return;
  }

  if (flags.help || !command) {
    process.stdout.write(HELP + '\n');
    return;
  }

  switch (command) {
    case 'install':
    case 'i':        await runInstall(cmdArgs[0] || null, flags, config, cwd); break;
    case 'ci':       await runCi(flags, config, cwd); break;
    case 'scan':
    case 's':        await runScan(flags, config, cwd); break;
    case 'config':
    case 'c':        await runConfig(cmdArgs, config); break;
    default:
      output.error(`Unknown command: "${command}". Run npa --help for usage.`);
      process.exit(1);
  }
}

main().catch(err => {
  output.error(err.message);
  if (process.env.NPA_DEBUG) console.error(err);
  process.exit(1);
});
