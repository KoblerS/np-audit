'use strict';

const { loadConfig, DEFAULT_CONFIG } = require('./utils/config');
const commands = require('./commands');
const output = require('./utils/output');

const VERSION = require('../package.json').version;
const NAME    = require('../package.json').name;

function buildMainHelp() {
  const cmdList = commands.list();
  const lines = cmdList.map(cmd => {
    const aliases = cmd.aliases.length ? ` (alias: ${cmd.aliases.join(', ')})` : '';
    return `    npa ${cmd.name.padEnd(20)} ${cmd.description}${aliases}`;
  });

  return `
  npa — npm package auditor ${VERSION}
  Statically detects obfuscated code in npm install scripts.

  Usage:
${lines.join('\n')}

  Flags:
    --review, -r   Interactive mode: choose which scripts to allow
    --json        Machine-readable JSON output
    --no-dev      Skip devDependencies
    --verbose     Show extra detail
    --version     Print version
    --help, -h    Print this help (use <command> -h for command help)

  Config keys (stored in ~/.npmauditor.json):
    blockScore       Score threshold for hard block (default: ${DEFAULT_CONFIG.blockScore})
    warnScore        Score threshold for warning (default: ${DEFAULT_CONFIG.warnScore})
    registry         npm registry URL (default: ${DEFAULT_CONFIG.registry})
    timeout          HTTP timeout in ms (default: ${DEFAULT_CONFIG.timeout})
    parallelFetches  Concurrent downloads (default: ${DEFAULT_CONFIG.parallelFetches})
    skipScopes       Array of @scopes to skip
    skipPackages     Array of package names to skip
    maxTarballSize   Max unpacked tarball size (default: ${DEFAULT_CONFIG.maxTarballSize})
`;
}

function parseArgs(argv) {
  const args  = argv.slice(2);
  const flags = {
    review:  false,
    json:    false,
    noDev:   false,
    verbose: false,
    version: false,
    help:    false,
  };
  const positionals = [];
  const rawArgs = [];

  for (const arg of args) {
    switch (arg) {
      case '--review':
      case '-r':         flags.review  = true; break;
      case '--json':     flags.json    = true; break;
      case '--no-dev':   flags.noDev   = true; break;
      case '--verbose':  flags.verbose = true; break;
      case '--version':
      case '-v':         flags.version = true; break;
      case '--help':
      case '-h':         flags.help    = true; break;
      default:
        if (!arg.startsWith('-')) positionals.push(arg);
    }
  }

  const command = positionals[0] || null;
  const cmdArgs = positionals.slice(1);
  const commandIndex = args.indexOf(command);
  if (commandIndex !== -1) {
    rawArgs.push(...args.slice(commandIndex + 1));
  }
  return { command, args: cmdArgs, rawArgs, flags };
}

async function main() {
  const parsed = parseArgs(process.argv);
  const { command, args, rawArgs, flags } = parsed;
  const cwd    = process.cwd();
  const config = loadConfig(cwd);

  if (flags.version) {
    process.stdout.write(`npa ${VERSION} (${NAME})\n`);
    return;
  }

  if (flags.help && command) {
    const cmd = commands.get(command);
    if (cmd) {
      process.stdout.write(cmd.help() + '\n');
      return;
    }
  }

  if (flags.help || !command) {
    process.stdout.write(buildMainHelp() + '\n');
    return;
  }

  const cmd = commands.get(command);
  if (!cmd) {
    output.error(`Unknown command: "${command}". Run npa --help for usage.`);
    process.exit(1);
  }

  await cmd.run({ args, rawArgs, flags, config, cwd });
}

main().catch(err => {
  output.error(err.message);
  if (process.env.NPA_DEBUG) console.error(err);
  process.exit(1);
});
