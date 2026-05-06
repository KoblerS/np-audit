'use strict';

const fs      = require('fs');
const path    = require('path');
const { parseLockfile }                = require('./lockfile');
const { fetchTarball, buildTarballUrl, verifyIntegrity } = require('./fetcher');
const { parseTarGz, extractFile, getPackageJson }        = require('./tarball');
const { detectObfuscation }            = require('./detector');
const output                           = require('./output');

/**
 * Main scan orchestrator.
 * @param {object} opts
 * @param {string}  opts.cwd
 * @param {object}  opts.config
 * @param {boolean} opts.noDev
 * @param {boolean} opts.verbose
 * @param {string|null} opts.singlePackage  name for single-package mode
 * @returns {Promise<ScanResult[]>}
 */
async function scan(opts) {
  const { cwd, config, noDev, verbose, singlePackage } = opts;

  let packages;
  let lockfileVersion = 1;
  if (singlePackage) {
    packages = await resolveSinglePackage(singlePackage, config);
  } else {
    const parsed = parseLockfile(cwd);
    packages = parsed.packages;
    lockfileVersion = parsed.lockfileVersion;
  }

  // Apply skip filters
  packages = packages.filter(pkg => {
    if (noDev && pkg.dev) return false;
    if (pkg.inBundle || pkg.link) return false;
    if (config.skipPackages && config.skipPackages.includes(pkg.name)) return false;
    if (config.skipScopes) {
      for (const scope of config.skipScopes) {
        if (pkg.name.startsWith(scope + '/') || pkg.name === scope) return false;
      }
    }
    // v2/v3 lockfiles reliably report hasInstallScript — skip definitive negatives
    if (lockfileVersion >= 2 && pkg.hasInstallScript === false) return false;
    return true;
  });

  if (verbose) output.info(`Scanning ${packages.length} packages...`);

  // Parallel fetch + scan with concurrency limit
  const results = await mapWithConcurrency(packages, config.parallelFetches, async (pkg) => {
    return scanPackage(pkg, cwd, config, verbose);
  });

  return results.filter(Boolean);
}

/**
 * Scan a single package for obfuscated install scripts.
 * @returns {ScanResult|null}  null if no install scripts found
 */
async function scanPackage(pkg, cwd, config, verbose) {
  let pkgJson = null;
  let source = 'registry';

  // Try local node_modules first
  const localPkgJson = tryReadLocalPackageJson(cwd, pkg);
  if (localPkgJson) {
    pkgJson = localPkgJson;
    source = 'local';
  }

  // If v2/v3 lockfile says no install script, skip unless we couldn't confirm locally
  if (source === 'local' && !hasInstallScripts(pkgJson)) {
    return null;
  }

  if (!pkgJson) {
    // v1 lockfile or package not installed — need to fetch
    if (!pkg.resolved && !pkg.version) return null;

    const tarballUrl = pkg.resolved || buildTarballUrl(pkg.name, pkg.version, config.registry);

    let tarBuffer;
    try {
      if (verbose) output.info(`Fetching ${pkg.name}@${pkg.version}...`);
      tarBuffer = await fetchTarball(tarballUrl, { timeout: config.timeout });
    } catch (err) {
      output.warn(`Could not fetch ${pkg.name}@${pkg.version}: ${err.message}`);
      return null;
    }

    if (!verifyIntegrity(tarBuffer, pkg.integrity)) {
      output.warn(`Integrity check failed for ${pkg.name}@${pkg.version} — skipping`);
      return null;
    }

    let files;
    try {
      files = parseTarGz(tarBuffer);
    } catch (err) {
      output.warn(`Could not parse tarball for ${pkg.name}@${pkg.version}: ${err.message}`);
      return null;
    }

    pkgJson = getPackageJson(files);
    if (!pkgJson) return null;

    if (!hasInstallScripts(pkgJson)) return null;

    // Analyze script files from tarball
    return analyzeScripts(pkg, pkgJson, files, config);
  }

  // Analyze from local node_modules
  return analyzeScriptsLocal(pkg, pkgJson, cwd, config);
}

/**
 * Analyze install scripts from a tarball's file map.
 */
function analyzeScripts(pkg, pkgJson, files, config) {
  const scripts = getInstallScripts(pkgJson);
  if (scripts.length === 0) return null;

  const scriptResults = [];

  for (const { lifecycle, command } of scripts) {
    const scriptFile = extractScriptFileFromCommand(command);
    if (!scriptFile) {
      // Inline shell command — analyze the command string itself
      const result = detectObfuscation(command, config);
      scriptResults.push({ lifecycle, file: '(inline)', code: command, ...result });
      continue;
    }

    const fileBuf = extractFile(files, scriptFile);
    if (!fileBuf) continue;

    const code = fileBuf.toString('utf8');
    const result = detectObfuscation(code, config);
    scriptResults.push({ lifecycle, file: scriptFile, code, ...result });
  }

  if (scriptResults.length === 0) return null;

  const maxScore = Math.max(...scriptResults.map(r => r.score));
  const allFindings = scriptResults.flatMap(r => r.findings);
  const verdict = verdictFromScore(maxScore, config);

  return { pkg, scripts: scriptResults, score: maxScore, findings: allFindings, verdict };
}

/**
 * Analyze install scripts from local node_modules.
 */
function analyzeScriptsLocal(pkg, pkgJson, cwd, config) {
  const scripts = getInstallScripts(pkgJson);
  if (scripts.length === 0) return null;

  const pkgDir = findLocalPackageDir(cwd, pkg.name);
  const scriptResults = [];

  for (const { lifecycle, command } of scripts) {
    const scriptFile = extractScriptFileFromCommand(command);
    if (!scriptFile) {
      const result = detectObfuscation(command, config);
      scriptResults.push({ lifecycle, file: '(inline)', code: command, ...result });
      continue;
    }

    const absolutePath = pkgDir ? path.join(pkgDir, scriptFile) : null;
    if (!absolutePath || !fs.existsSync(absolutePath)) continue;

    let code;
    try { code = fs.readFileSync(absolutePath, 'utf8'); } catch { continue; }

    const result = detectObfuscation(code, config);
    scriptResults.push({ lifecycle, file: scriptFile, code, ...result });
  }

  if (scriptResults.length === 0) return null;

  const maxScore = Math.max(...scriptResults.map(r => r.score));
  const allFindings = scriptResults.flatMap(r => r.findings);
  const verdict = verdictFromScore(maxScore, config);

  return { pkg, scripts: scriptResults, score: maxScore, findings: allFindings, verdict };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasInstallScripts(pkgJson) {
  if (!pkgJson || !pkgJson.scripts) return false;
  return !!(pkgJson.scripts.preinstall || pkgJson.scripts.postinstall || pkgJson.scripts.install);
}

function getInstallScripts(pkgJson) {
  const result = [];
  const s = pkgJson && pkgJson.scripts || {};
  for (const lc of ['preinstall', 'install', 'postinstall']) {
    if (s[lc]) result.push({ lifecycle: lc, command: s[lc] });
  }
  return result;
}

/**
 * Extract the JS file path from a script command like "node ./install.js" or "node scripts/setup".
 * Returns null if it's a pure shell command.
 */
function extractScriptFileFromCommand(command) {
  const m = command.match(/(?:^|\s)node\s+([^\s]+\.(?:js|mjs|cjs))/);
  if (m) return m[1].replace(/^\.\//, '');
  const m2 = command.match(/(?:^|\s)node\s+([^\s]+)(?:\s|$)/);
  if (m2) {
    const f = m2[1].replace(/^\.\//, '');
    if (!f.startsWith('-')) return f + (f.includes('.') ? '' : '.js');
  }
  return null;
}

function tryReadLocalPackageJson(cwd, pkg) {
  const dir = findLocalPackageDir(cwd, pkg.name);
  if (!dir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function findLocalPackageDir(cwd, name) {
  const candidate = path.join(cwd, 'node_modules', name);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

function verdictFromScore(score, config) {
  if (score >= config.blockScore) return 'BLOCK';
  if (score >= config.warnScore)  return 'WARN';
  return 'OK';
}

/**
 * Resolve a single package's dependency tree via the npm registry.
 * @param {string} packageSpec  e.g. "express" or "express@4.18.0"
 * @param {object} config
 * @returns {Promise<PackageDescriptor[]>}
 */
async function resolveSinglePackage(packageSpec, config) {
  const [name, version] = packageSpec.includes('@') && !packageSpec.startsWith('@')
    ? packageSpec.split('@')
    : [packageSpec, 'latest'];

  const { fetchJSON } = require('./fetcher');
  let meta;
  try {
    meta = await fetchJSON(`${config.registry}/${encodeURIComponent(name)}`, { timeout: config.timeout });
  } catch (err) {
    throw new Error(`Could not fetch registry metadata for "${name}": ${err.message}`);
  }

  const resolvedVersion = version === 'latest'
    ? (meta['dist-tags'] && meta['dist-tags'].latest)
    : version;

  const versionData = meta.versions && meta.versions[resolvedVersion];
  if (!versionData) throw new Error(`Version "${resolvedVersion}" not found for "${name}"`);

  const packages = [];
  const seen = new Set();

  function collectDeps(deps) {
    for (const [depName, range] of Object.entries(deps || {})) {
      if (seen.has(depName)) continue;
      seen.add(depName);
      // We don't resolve ranges here — just list direct deps; full tree would need more registry calls
      packages.push({
        name: depName,
        version: range.replace(/^[\^~>=<]/, ''),
        resolved: buildTarballUrl(depName, range.replace(/^[\^~>=<]/, ''), config.registry),
        integrity: '',
        hasInstallScript: false,
        dev: false,
        optional: false,
        inBundle: false,
        link: false,
      });
    }
  }

  // Include the package itself
  packages.unshift({
    name,
    version: resolvedVersion,
    resolved: versionData.dist && versionData.dist.tarball,
    integrity: versionData.dist && versionData.dist.integrity || '',
    hasInstallScript: !!(versionData.scripts &&
      (versionData.scripts.preinstall || versionData.scripts.postinstall || versionData.scripts.install)),
    dev: false,
    optional: false,
    inBundle: false,
    link: false,
  });

  collectDeps(versionData.dependencies);

  return packages;
}

/**
 * Async map with concurrency limit.
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

module.exports = { scan, hasInstallScripts, extractScriptFileFromCommand, verdictFromScore };
