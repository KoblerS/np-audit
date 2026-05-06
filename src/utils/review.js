'use strict';

const readline = require('readline');
const path     = require('path');
const { spawnSync } = require('child_process');
const output   = require('./output');

const KEY_UP    = '\x1b[A';
const KEY_DOWN  = '\x1b[B';
const KEY_SPACE = ' ';
const KEY_ENTER = '\r';
const KEY_ENTER2 = '\n';
const KEY_QUIT  = 'q';

/**
 * Run the interactive --aware TUI.
 * Shows packages with install scripts and lets the user toggle which to allow.
 * After confirmation, runs npm install --ignore-scripts, then executes allowed scripts.
 *
 * @param {object} opts
 * @param {ScanResult[]} opts.results  packages that have install scripts
 * @param {string}       opts.command  'install' | 'ci'
 * @param {string[]}     opts.npmArgs  extra args for npm command
 * @param {string}       opts.cwd
 * @returns {Promise<number>}  exit code
 */
async function runAware(opts) {
  const { results, command, npmArgs, cwd } = opts;

  if (results.length === 0) {
    output.success('No install scripts found. Running npm without restrictions.');
    return runNpm(command, npmArgs, cwd);
  }

  // Default: allow OK scripts, deny BLOCK scripts, warn for WARN
  const items = results.map(r => ({
    result: r,
    allowed: r.verdict !== 'BLOCK',
  }));

  let cursor = 0;

  // Use alternate screen buffer on supported terminals (not legacy Windows console)
  const useAltScreen = process.stdout.isTTY && (
    process.platform !== 'win32' ||
    process.env.WT_SESSION ||  // Windows Terminal
    process.env.ConEmuPID      // ConEmu
  );

  if (useAltScreen) {
    process.stdout.write('\x1b[?1049h');
  }

  function render() {
    process.stdout.write('\x1b[H\x1b[2J');
    output.log('');
    output.log(output.bold('  npa --review mode'));
    output.log(output.dim('  Use ↑/↓ to navigate, SPACE to toggle, ENTER to confirm, q to quit'));
    output.log('');
    output.log(`  Found ${items.length} package(s) with install scripts:\n`);

    items.forEach((item, i) => {
      const { result } = item;
      const pkg    = result.pkg;
      const badge  = output.verdictBadge(result.verdict);
      const toggle = item.allowed ? output.green('[✓ allow]') : output.red('[✗ deny ]');
      const cursor_ = i === cursor ? output.cyan(' ▶ ') : '   ';
      const name   = `${pkg.name}@${pkg.version}`;
      const scripts = result.scripts.map(s => `${s.lifecycle}: ${s.file}`).join(', ');
      output.log(`  ${cursor_}${toggle} ${output.bold(name)} ${output.dim(scripts)} ${badge}`);

      if (i === cursor && result.findings.length > 0) {
        for (const f of result.findings) {
          output.log(`         ${output.dim('└ ' + f.name + ': ' + f.detail)}`);
        }
      }
    });

    output.log('');
    const allowed = items.filter(i => i.allowed).length;
    output.log(`  ${output.green(String(allowed))} allowed  ${output.red(String(items.length - allowed))} denied`);
    output.log('');
  }

  await new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Non-TTY fallback: just use defaults and proceed
      resolve();
      return;
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    render();

    function onKey(str, key) {
      if (!key) return;

      if (key.name === 'up' || str === KEY_UP) {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
      } else if (key.name === 'down' || str === KEY_DOWN) {
        cursor = (cursor + 1) % items.length;
        render();
      } else if (str === KEY_SPACE) {
        items[cursor].allowed = !items[cursor].allowed;
        render();
      } else if (str === KEY_ENTER || str === KEY_ENTER2 || key.name === 'return') {
        cleanup();
        resolve();
      } else if (str === KEY_QUIT || (key.ctrl && key.name === 'c')) {
        cleanup();
        process.stdout.write('\n');
        process.exit(0);
      }
    }

    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('keypress', onKey);
      process.stdin.pause();
    }

    process.stdin.on('keypress', onKey);
  });

  // Exit alternate screen buffer (restores previous screen)
  if (useAltScreen) {
    process.stdout.write('\x1b[?1049l');
  }

  const allowedItems = items.filter(i => i.allowed);
  const deniedItems  = items.filter(i => !i.allowed);

  output.log('');
  output.info(`Proceeding with ${allowedItems.length} allowed / ${deniedItems.length} denied`);

  // Get names of denied packages to exclude from install
  const deniedNames = new Set(deniedItems.map(i => i.result.pkg.name));

  // Filter npmArgs to exclude denied packages
  let filteredNpmArgs = npmArgs.filter(arg => {
    // Extract package name (handle @scope/pkg and pkg@version formats)
    const name = arg.startsWith('@')
      ? arg.split('/').slice(0, 2).join('/').split('@').slice(0, 2).join('@').replace(/@[^@]*$/, '') || arg.split('@').slice(0, 2).join('@')
      : arg.split('@')[0];
    return !deniedNames.has(name);
  });

  // If all explicitly requested packages are denied, abort
  if (npmArgs.length > 0 && filteredNpmArgs.length === 0) {
    output.error('All requested packages were denied. Aborting install.');
    return 1;
  }

  if (deniedItems.length > 0) {
    if (filteredNpmArgs.length > 0 || npmArgs.length === 0) {
      output.warn('Running npm with --ignore-scripts (will run allowed scripts manually after)');
      const code = runNpm(command, [...filteredNpmArgs, '--ignore-scripts'], cwd);
      if (code !== 0) return code;

      for (const item of allowedItems) {
        const exitCode = runPackageScripts(item.result, cwd);
        if (exitCode !== 0) {
          output.error(`Script for ${item.result.pkg.name} exited with code ${exitCode}`);
        }
      }
      return 0;
    } else {
      output.warn('No packages to install after excluding denied packages.');
      return 0;
    }
  } else {
    return runNpm(command, filteredNpmArgs.length > 0 ? filteredNpmArgs : npmArgs, cwd);
  }
}

/**
 * Spawn npm install/ci and return the exit code.
 * Sets NPA_RUNNING=1 to prevent recursive hooks when npm is aliased to npa.
 */
function runNpm(command, args, cwd) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArgs = command === 'ci' ? ['ci', ...args] : ['install', ...args];
  const result = spawnSync(npmCmd, npmArgs, {
    stdio: 'inherit',
    cwd,
    env: { ...process.env, NPA_RUNNING: '1' },
  });
  return result.status || 0;
}

/**
 * Run the install scripts for a single package from its node_modules directory.
 */
function runPackageScripts(scanResult, cwd) {
  const pkgDir = path.join(cwd, 'node_modules', scanResult.pkg.name);

  for (const scriptInfo of scanResult.scripts) {
    if (scriptInfo.file === '(inline)') {
      output.info(`Running inline ${scriptInfo.lifecycle} for ${scanResult.pkg.name}`);
      const result = spawnSync(scriptInfo.code, {
        shell: true,
        stdio: 'inherit',
        cwd:   pkgDir,
      });
      if (result.status !== 0) return result.status;
    } else {
      const scriptPath = path.join(pkgDir, scriptInfo.file);
      output.info(`Running ${scriptInfo.lifecycle} (${scriptInfo.file}) for ${scanResult.pkg.name}`);
      const result = spawnSync(process.execPath, [scriptPath], {
        stdio: 'inherit',
        cwd:   pkgDir,
      });
      if (result.status !== 0) return result.status;
    }
  }

  return 0;
}

module.exports = { runAware, runNpm };
