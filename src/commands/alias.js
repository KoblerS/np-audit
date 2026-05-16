'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const output = require('../utils/output');

const BASH_HOOK = `# npa npm hook
alias npm='npa'`;

const POWERSHELL_HOOK = `# npa npm hook
Set-Alias -Name npm -Value npa`;

module.exports = {
  name: 'alias',
  aliases: [],
  description: 'Shell hook to auto-scan before npm install/ci',

  help() {
    return `
  npa alias — Shell alias to use npa as an npm drop-in replacement

  Usage:
    npa alias                Print the shell alias
    npa alias --install      Add alias to shell profile (~/.zshrc or ~/.bashrc)
    npa alias --uninstall    Remove alias from shell profile

  With the alias active, all npm commands pass through npa.
  Install/ci/add commands are scanned before execution.
  All other commands (run, test, publish, etc.) forward directly to npm.

  Examples:
    npa alias                     Print alias for manual installation
    npa alias --install           Auto-install to detected shell
    eval "$(npa alias)"           Load alias in current session only
`;
  },

  run({ rawArgs }) {
    const install = rawArgs.includes('--install') || rawArgs.includes('-i');
    const uninstall = rawArgs.includes('--uninstall') || rawArgs.includes('-u');

    const { shell, hook, profilePath } = detectShell();

    if (uninstall) {
      return doUninstall(profilePath);
    }

    if (install) {
      return doInstall(hook, profilePath);
    }

    // Print hook
    process.stdout.write(hook + '\n');
    output.log('');
    output.log(output.dim(`  Add to your shell profile, or run: npa alias --install`));
  },
};

function detectShell() {
  if (process.platform === 'win32') {
    return { shell: 'powershell', hook: POWERSHELL_HOOK, profilePath: null };
  }

  const userShell = process.env.SHELL || '';
  if (userShell.includes('zsh')) {
    return { shell: 'zsh', hook: BASH_HOOK, profilePath: path.join(os.homedir(), '.zshrc') };
  }

  return { shell: 'bash', hook: BASH_HOOK, profilePath: path.join(os.homedir(), '.bashrc') };
}

function doUninstall(profilePath) {
  if (!profilePath) {
    output.error('Auto-uninstall not supported for PowerShell. Remove manually from $PROFILE');
    return;
  }

  if (!fs.existsSync(profilePath)) {
    output.warn('No profile found at ' + profilePath);
    return;
  }

  const content = fs.readFileSync(profilePath, 'utf8');
  if (!content.includes('# npa npm hook')) {
    output.warn('npa hook not found in ' + profilePath);
    return;
  }

  // Remove all known hook formats (old function, new alias)
  const cleaned = content
    .replace(/\n*# npa npm hook\n(?:npm\(\) \{[\s\S]*?\n\}|npm\(\)[^\n]+|alias npm='npa'|Set-Alias[^\n]*)\n*/g, '\n');
  fs.writeFileSync(profilePath, cleaned);
  output.success(`Removed npa hook from ${profilePath}`);
  output.log(output.dim('  Run: source ' + profilePath + ' (or restart your terminal)'));
}

function doInstall(hook, profilePath) {
  if (!profilePath) {
    output.error('Auto-install not supported for PowerShell. Copy the output manually to $PROFILE');
    process.stdout.write('\n' + hook + '\n');
    return;
  }

  const content = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf8') : '';

  // Migrate from old format (function or multi-line) to new alias
  const hasOldHook = content.includes('# npa npm hook') && !content.includes("alias npm='npa'");
  if (hasOldHook) {
    output.warn('Deprecated: The old npm() shell function hook is no longer needed.');
    output.log(output.dim('  npa now forwards unknown commands to npm directly.'));
    output.log(output.dim('  Replacing with: alias npm=\'npa\''));
    output.log('');
    const migrated = content
      .replace(/\n*# npa npm hook\n(?:npm\(\) \{[\s\S]*?\n\}|npm\(\)[^\n]+)\n*/g, '\n\n' + hook + '\n');
    fs.writeFileSync(profilePath, migrated);
    output.success(`Migrated npa hook to new format in ${profilePath}`);
    output.log(output.dim('  Run: source ' + profilePath + ' (or restart your terminal)'));
    return;
  }

  if (content.includes('# npa npm hook')) {
    output.warn('npa hook already installed in ' + profilePath);
    return;
  }

  fs.appendFileSync(profilePath, '\n\n' + hook + '\n');
  output.success(`Installed npa hook to ${profilePath}`);
  output.log(output.dim('  Run: source ' + profilePath + ' (or restart your terminal)'));
}
