'use strict';

/**
 * E2E tests that exercise resolveFromPackageJson and collectDeps using a
 * local HTTP mock registry — covers the resolveVersion integration paths
 * in scanner.js that require live registry responses.
 *
 * Uses async child_process.spawn (not spawnSync) so the mock HTTP server's
 * event-loop callbacks can fire while the child process is running.
 */

const assert    = require('assert');
const fs        = require('fs');
const http      = require('http');
const path      = require('path');
const os        = require('os');
const { spawn } = require('child_process');

const CLI = path.join(__dirname, '../../bin/npa.js');

function runCLI(args, cwd, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', NPA_DEBUG: '1', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); resolve({ status: null, stdout, stderr }); }, 15000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ status: code, stdout, stderr }); });
  });
}

function withTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-registry-'));
  return {
    dir,
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

function createFakeModule(dir, name, pkgJson) {
  const pkgDir = path.join(dir, 'node_modules', name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
}

function makeVersionEntry(version, deps = {}) {
  return {
    dist: { tarball: `http://placeholder/${version}.tgz`, integrity: '' },
    scripts: {},
    dependencies: deps,
  };
}

function startMockRegistry(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url).replace(/^\//, '');
      const body = routes[url];
      if (body) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      } else {
        res.writeHead(404);
        res.end('{}');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

module.exports = (async () => {

  // ─── Test 1: resolveFromPackageJson — partial version falls back to latest ───
  // No lockfile; package.json has "^1" range; registry returns dist-tags.latest.
  {
    const { dir, cleanup } = withTmpDir();
    const routes = {
      'reg-clean-pkg': {
        'dist-tags': { latest: '1.2.3' },
        versions: { '1.2.3': makeVersionEntry('1.2.3') },
      },
    };
    const { server, url } = await startMockRegistry(routes);

    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'test-app', version: '1.0.0', dependencies: { 'reg-clean-pkg': '^1' } })
      );
      fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({ registry: url }));
      createFakeModule(dir, 'reg-clean-pkg', { name: 'reg-clean-pkg', version: '1.2.3' });

      const result = await runCLI(['scan'], dir);
      assert.strictEqual(result.status, 0, `registry test 1: exit 0. stderr: ${result.stderr}`);
    } finally {
      server.close();
      cleanup();
    }
    console.log('  Test 1 passed: resolveFromPackageJson resolves partial version via dist-tags.latest');
  }

  // ─── Test 2: collectDeps — dependency partial version resolved via dist-tags ─
  // Single-package scan; top-level package has a dep with range "^2";
  // registry resolves it to "2.5.0" via dist-tags.latest.
  {
    const { dir, cleanup } = withTmpDir();
    const routes = {
      'reg-top-pkg': {
        'dist-tags': { latest: '3.0.0' },
        versions: { '3.0.0': makeVersionEntry('3.0.0', { 'reg-dep-pkg': '^2' }) },
      },
      'reg-dep-pkg': {
        'dist-tags': { latest: '2.5.0' },
        versions: { '2.5.0': makeVersionEntry('2.5.0') },
      },
    };
    const { server, url } = await startMockRegistry(routes);

    try {
      fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({ registry: url }));
      createFakeModule(dir, 'reg-top-pkg', { name: 'reg-top-pkg', version: '3.0.0' });
      createFakeModule(dir, 'reg-dep-pkg', { name: 'reg-dep-pkg', version: '2.5.0' });

      const result = await runCLI(['scan', 'reg-top-pkg'], dir);
      assert.strictEqual(result.status, 0, `registry test 2: exit 0. stderr: ${result.stderr}`);
    } finally {
      server.close();
      cleanup();
    }
    console.log('  Test 2 passed: collectDeps resolves partial dep version via dist-tags.latest');
  }

  console.log('  registry.test.js: all tests passed');
})();
