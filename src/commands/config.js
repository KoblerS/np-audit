'use strict';

const { setGlobalConfig, getGlobalConfigPath, DEFAULT_CONFIG } = require('../utils/config');
const output = require('../utils/output');

module.exports = {
  name: 'config',
  aliases: ['c'],
  description: 'View or modify npa configuration',

  help() {
    return `
  npa config — View or modify npa configuration

  Usage:
    npa config get              Show all config values
    npa config set <key> <val>  Set a config value

  Config keys:
    blockScore       Score threshold for hard block (default: ${DEFAULT_CONFIG.blockScore})
    warnScore        Score threshold for warning (default: ${DEFAULT_CONFIG.warnScore})
    registry         npm registry URL
    timeout          HTTP timeout in ms (default: ${DEFAULT_CONFIG.timeout})
    parallelFetches  Concurrent downloads (default: ${DEFAULT_CONFIG.parallelFetches})
    skipScopes       Array of @scopes to skip (JSON)
    skipPackages     Array of package names to skip (JSON)

  Examples:
    npa config get
    npa config set blockScore 10
    npa config set skipScopes '["@myorg"]'
`;
  },

  async run({ args, config }) {
    const subcommand = args[0];

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
      const key   = args[1];
      const value = args[2];
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
  },
};
