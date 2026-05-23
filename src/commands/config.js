'use strict';

const { setGlobalConfig, getGlobalConfigPath, DEFAULT_CONFIG } = require('../utils/config');
const { getAllMarshallers } = require('../marshallers');
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
    npa config marshallers      List all available marshallers

  Config keys:
    blockScore           Score threshold for hard block (default: ${DEFAULT_CONFIG.blockScore})
    warnScore            Score threshold for warning (default: ${DEFAULT_CONFIG.warnScore})
    registry             npm registry URL
    timeout              HTTP timeout in ms (default: ${DEFAULT_CONFIG.timeout})
    parallelFetches      Concurrent downloads (default: ${DEFAULT_CONFIG.parallelFetches})
    skipScopes           Array of @scopes to skip (JSON)
    skipPackages         Array of package names to skip (JSON)
    disabledMarshallers  Array of marshaller names to disable (JSON)

  Examples:
    npa config get
    npa config set blockScore 10
    npa config set skipScopes '["@myorg"]'
    npa config set disabledMarshallers '["process-env", "network-call"]'
    npa config marshallers
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
        output.log(`  ${output.cyan(key.padEnd(22))} ${JSON.stringify(val)}`);
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

    if (subcommand === 'marshallers') {
      const { static: staticMarshallers, package: packageMarshallers } = getAllMarshallers();
      const disabled = new Set(config.disabledMarshallers || []);

      output.log(output.bold('  Available marshallers'));
      output.log('');
      output.log(output.bold('  Static (code analysis):'));
      for (const m of staticMarshallers) {
        const status = disabled.has(m.name) ? output.dim(' [disabled]') : '';
        output.log(`    ${output.cyan(m.name.padEnd(26))} ${m.title}${status}`);
      }
      output.log('');
      output.log(output.bold('  Package-level:'));
      for (const m of packageMarshallers) {
        const status = disabled.has(m.name) ? output.dim(' [disabled]') : '';
        output.log(`    ${output.cyan(m.name.padEnd(26))} ${m.title}${status}`);
      }
      output.log('');
      if (disabled.size > 0) {
        output.log(output.dim(`  ${disabled.size} marshaller(s) currently disabled via config`));
        output.log('');
      }
      output.log(output.dim('  Disable with: npa config set disabledMarshallers \'["name1", "name2"]\''));
      output.log('');
      return;
    }

    output.error(`Unknown config subcommand: "${subcommand}". Use "get", "set", or "marshallers".`);
    process.exit(1);
  },
};
