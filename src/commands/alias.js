'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const output = require('../utils/output');

const BASH_HOOK = `# npa npm hook
npm() { [[ -n "$NPA_RUNNING" ]] && { command npm "$@"; return; }; case "$1" in scan) npa scan "\${@:2}"; return;; install|i|add) command -v npa >/dev/null && { local pkgs=(); for a in "\${@:2}"; do [[ "$a" != -* ]] && pkgs+=("$a"); done; if [[ \${#pkgs[@]} -gt 0 ]]; then npa scan "\${pkgs[@]}" || { echo "[npa] Blocked. Use 'npa install --review'"; return 1; }; else npa scan || { echo "[npa] Blocked. Use 'npa install --review'"; return 1; }; fi; };; ci) command -v npa >/dev/null && { npa scan || { echo "[npa] Blocked. Use 'npa ci --review'"; return 1; }; };; esac; command npm "$@"; }`;

const POWERSHELL_HOOK = `# npa npm hook
function npm { if($env:NPA_RUNNING){& npm.cmd @args;return}; if($args[0] -eq 'scan'){& npa scan @($args|Select-Object -Skip 1);return}; if($args[0] -in @('install','i','add')){$pkgs=@($args|Where-Object{$_ -notmatch '^-'}|Select-Object -Skip 1); if($pkgs.Count -gt 0){& npa scan @pkgs; if($LASTEXITCODE -ne 0){Write-Host "[npa] Blocked.";return 1}}else{& npa scan; if($LASTEXITCODE -ne 0){Write-Host "[npa] Blocked.";return 1}}}; if($args[0] -eq 'ci'){& npa scan; if($LASTEXITCODE -ne 0){Write-Host "[npa] Blocked.";return 1}}; & npm.cmd @args }`;

module.exports = {
  name: 'alias',
  aliases: [],
  description: 'Shell hook to auto-scan before npm install/ci',

  help() {
    return `
  npa alias — Shell hook to auto-scan before npm install/ci

  Usage:
    npa alias                Print the shell hook
    npa alias --install      Add hook to shell profile (~/.zshrc or ~/.bashrc)
    npa alias --uninstall    Remove hook from shell profile

  The hook intercepts npm install/ci/add commands and runs npa scan first.
  If issues are found, the install is blocked until resolved.

  Examples:
    npa alias                     Print hook for manual installation
    npa alias --install           Auto-install to detected shell
    eval "$(npa alias)"           Load hook in current session only
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

  const cleaned = content.replace(/\n*# npa npm hook\nnpm\(\)[^\n]+\n*/g, '\n');
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
  if (content.includes('# npa npm hook')) {
    output.warn('npa hook already installed in ' + profilePath);
    return;
  }

  fs.appendFileSync(profilePath, '\n\n' + hook + '\n');
  output.success(`Installed npa hook to ${profilePath}`);
  output.log(output.dim('  Run: source ' + profilePath + ' (or restart your terminal)'));
}
