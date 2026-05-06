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

  function render() {
    // Move cursor to top of list — use ANSI escape to clear + redraw
    process.stdout.write('\x1b[2J\x1b[H'); // clear screen
    output.log('');
    output.log(output.bold('  npa --aware mode'));
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

  // Clear screen after TUI exits
  process.stdout.write('\x1b[2J\x1b[H');

  const allowedItems = items.filter(i => i.allowed);
  const deniedItems  = items.filter(i => !i.allowed);

  output.log('');
  output.info(`Proceeding with ${allowedItems.length} allowed / ${deniedItems.length} denied`);

  if (deniedItems.length > 0) {
    output.warn('Running npm with --ignore-scripts (will run allowed scripts manually after)');
    const code = runNpm(command, [...npmArgs, '--ignore-scripts'], cwd);
    if (code !== 0) return code;

    for (const item of allowedItems) {
      const exitCode = runPackageScripts(item.result, cwd);
      if (exitCode !== 0) {
        output.error(`Script for ${item.result.pkg.name} exited with code ${exitCode}`);
      }
    }
    return 0;
  } else {
    return runNpm(command, npmArgs, cwd);
  }
}

/**
 * Spawn npm install/ci and return the exit code.
 */
function runNpm(command, args, cwd) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArgs = command === 'ci' ? ['ci', ...args] : ['install', ...args];
  const result = spawnSync(npmCmd, npmArgs, { stdio: 'inherit', cwd });
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
