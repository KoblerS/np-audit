'use strict';

const fs      = require('fs');
const path    = require('path');
const { parseLockfile }                = require('../utils/lockfile');
const { fetchTarball, buildTarballUrl, verifyIntegrity } = require('../utils/fetcher');
const { parseTarGz, extractFile, getPackageJson }        = require('../utils/tarball');
const { detectObfuscation }            = require('./detector');
const { walkRequires, MAX_FILES_PER_PACKAGE, MAX_TOTAL_BYTES } = require('./requireWalker');
const { parseCommand }                 = require('../utils/command');
const { getPackageMarshallers }        = require('../marshallers');
const output                           = require('../utils/output');

// Lifecycle scripts that npm executes during install. The original tool only
// looked at preinstall/install/postinstall, but `prepare` is also automatically
// run for git dependencies and during `npm install` of local paths; and
// `preprepare`/`postprepare` wrap `prepare`. We also include `prepublish` (run
// during `npm install` historically — deprecated but still respected by older
// npm versions in the dependency graph).
const LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
];

/**
 * Main scan orchestrator.
 * @param {object} opts
 * @param {string}  opts.cwd
 * @param {object}  opts.config
 * @param {boolean} opts.noDev
 * @param {boolean} opts.verbose
 * @param {string|null} opts.singlePackage  name for single-package mode (deprecated, use packages)
 * @param {string[]|null} opts.packages  package names to scan
 * @returns {Promise<ScanResult[]>}
 */
async function scan(opts) {
  const { cwd, config, noDev, verbose, singlePackage, packages: packageList } = opts;

  let packages;
  let lockfileVersion = 1;
  let explicitPackageNames = new Set();

  // Support both single package (legacy) and multiple packages
  const targetPackages = packageList || (singlePackage ? [singlePackage] : null);

  if (targetPackages && targetPackages.length > 0) {
    // Scan specific packages from registry
    const allPackages = [];
    for (const pkg of targetPackages) {
      const resolved = await resolveSinglePackage(pkg, config);
      // Mark the first package (the explicitly requested one) as explicit
      if (resolved.length > 0) {
        const lastAt = pkg.lastIndexOf('@');
        const pkgName = lastAt > 0 ? pkg.slice(0, lastAt) : pkg;
        explicitPackageNames.add(pkgName);
      }
      allPackages.push(...resolved);
    }
    packages = allPackages;
  } else {
    const lockPath = path.join(cwd, 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      const parsed = parseLockfile(cwd);
      packages = parsed.packages;
      lockfileVersion = parsed.lockfileVersion;
    } else {
      // No lockfile — resolve from package.json
      packages = await resolveFromPackageJson(cwd, config, noDev);
    }
  }

  // Apply user skip filters (scopes, packages, dev)
  packages = packages.filter(pkg => {
    if (noDev && pkg.dev) return false;
    if (pkg.inBundle || pkg.link) return false;
    if (config.skipPackages && config.skipPackages.includes(pkg.name)) return false;
    if (config.skipScopes) {
      for (const scope of config.skipScopes) {
        if (pkg.name.startsWith(scope + '/') || pkg.name === scope) return false;
      }
    }
    return true;
  });

  // All non-skipped packages are eligible for package-level marshallers (CVE)
  const allPackages = packages;

  // Filter to only packages with lifecycle scripts for code analysis
  packages = packages.filter(pkg => {
    if (explicitPackageNames.has(pkg.name)) return true;
    if (lockfileVersion >= 2 && pkg.hasInstallScript === false) return false;
    return true;
  });

  if (verbose) output.info(`Scanning ${packages.length} packages...`);

  // Parallel fetch + scan with concurrency limit
  const results = await mapWithConcurrency(packages, config.parallelFetches, async (pkg) => {
    return scanPackage(pkg, cwd, config, verbose);
  });

  // Run package-level marshallers (CVE checks) on ALL packages, not just those with scripts
  if (config.checkVulnerabilities) {
    const packageMarshallers = getPackageMarshallers();
    const cveResults = await mapWithConcurrency(allPackages, config.parallelFetches, async (pkg) => {
      for (const marshaller of packageMarshallers) {
        const finding = await marshaller.checkPackage(pkg, config);
        if (finding) return { pkg, finding };
      }
      return null;
    });

    for (const cveResult of cveResults) {
      if (!cveResult) continue;
      const { pkg, finding } = cveResult;
      const existing = results.find(r => r && r.pkg && r.pkg.name === pkg.name);
      if (existing) {
        existing.findings.push(finding);
        if (finding.score > existing.score) {
          existing.score = finding.score;
          existing.verdict = verdictFromScore(finding.score, config);
        }
      } else {
        results.push({
          pkg,
          scripts: [],
          score: finding.score,
          findings: [finding],
          verdict: verdictFromScore(finding.score, config),
        });
      }
    }
  }

  const scanned = results.filter(Boolean);

  // Optionally scan the *current project's own* lifecycle scripts.
  if (config.scanSelf) {
    const selfResult = scanCwdProject(cwd, config);
    if (selfResult) scanned.unshift(selfResult);
  }

  // Scan IDE/tool config files that can auto-execute code
  const ideResults = scanIdeConfigs(cwd, config);
  scanned.push(...ideResults);

  scanned.totalPackages = allPackages.length + ideResults.length;
  return scanned;
}

/**
 * Scan the lifecycle scripts of the CWD's own package.json.
 * Returns null when there is no package.json or no relevant scripts.
 */
function scanCwdProject(cwd, config) {
  const pkgJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return null;

  let pkgJson;
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  } catch {
    return null;
  }

  if (!hasInstallScripts(pkgJson)) return null;

  // Synthesize a package descriptor so the report renders consistently.
  const pkg = {
    name:    pkgJson.name || '(current project)',
    version: pkgJson.version || '0.0.0',
    self:    true,
  };

  // The CWD reader resolves paths relative to the project root (where
  // package.json lives), so the local-fs reader is reused.
  return analyzeScriptsLocalFromDir(pkg, pkgJson, cwd, config);
}

const IDE_CONFIG_FILES = [
  '.vscode/tasks.json',
  '.vscode/settings.json',
  '.vscode/launch.json',
  '.claude/settings.json',
];

function scanIdeConfigs(cwd, config) {
  const results = [];

  for (const relPath of IDE_CONFIG_FILES) {
    const fullPath = path.join(cwd, relPath);
    if (!fs.existsSync(fullPath)) continue;

    let code;
    try { code = fs.readFileSync(fullPath, 'utf8'); } catch { continue; }

    const result = detectObfuscation(code, config);
    if (result.score === 0) continue;

    results.push({
      pkg: { name: relPath, version: '', self: true },
      scripts: [{ lifecycle: 'ide-config', file: relPath, code, ...result }],
      score: result.score,
      findings: result.findings,
      verdict: result.verdict,
    });

    // Also scan any files referenced by commands in tasks.json
    if (relPath.endsWith('tasks.json')) {
      const referenced = extractReferencedScripts(code, cwd);
      for (const { file, scriptCode } of referenced) {
        const scriptResult = detectObfuscation(scriptCode, config);
        if (scriptResult.score > 0) {
          const existing = results.find(r => r.pkg.name === relPath);
          if (existing) {
            existing.scripts.push({ lifecycle: 'task-script', file, code: scriptCode, ...scriptResult });
            existing.findings.push(...scriptResult.findings);
            if (scriptResult.score > existing.score) {
              existing.score = scriptResult.score;
              existing.verdict = verdictFromScore(scriptResult.score, config);
            }
          }
        }
      }
    }
  }

  return results;
}

function extractReferencedScripts(tasksJson, cwd) {
  const scripts = [];
  try {
    const tasks = JSON.parse(tasksJson);
    for (const task of tasks.tasks || []) {
      if (!task.command) continue;
      // Extract file paths from commands like "node .claude/setup.mjs"
      const match = task.command.match(/(?:node|bun|deno|sh|bash|python)\s+([^\s]+)/);
      if (match) {
        const scriptPath = path.join(cwd, match[1]);
        if (fs.existsSync(scriptPath)) {
          try {
            scripts.push({ file: match[1], scriptCode: fs.readFileSync(scriptPath, 'utf8') });
          } catch {}
        }
      }
    }
  } catch {}
  return scripts;
}

/**
 * Analyze a package's lifecycle scripts using a directory root as the
 * filesystem base. Used for both node_modules packages and the CWD itself.
 */
function analyzeScriptsLocalFromDir(pkg, pkgJson, rootDir, config) {
  const scripts = getInstallScripts(pkgJson);
  if (scripts.length === 0) return null;

  const reader = makeLocalReader(rootDir);
  const scriptResults = [];

  for (const { lifecycle, command } of scripts) {
    const refs = parseCommand(command);
    if (refs.length === 0) {
      const result = detectObfuscation(command, config);
      scriptResults.push({ lifecycle, file: '(inline)', code: command, ...result });
      continue;
    }
    for (const ref of refs) {
      if (ref.kind === 'inline') {
        const result = detectObfuscation(ref.code, config);
        scriptResults.push({ lifecycle, file: `(inline:${ref.interpreter})`, code: ref.code, ...result });
        continue;
      }
      if (ref.interpreter === 'node' || ref.interpreter === 'auto') {
        scriptResults.push(analyzeScriptWithWalker(lifecycle, ref.path, reader, config));
      } else {
        const buf = reader(ref.path);
        if (!buf) {
          scriptResults.push({
            lifecycle, file: ref.path, code: '', score: 0,
            findings: [{
              name: 'missing-script', score: 0,
              detail: `Command references "${ref.path}" but file not found`,
            }],
            verdict: 'OK',
          });
          continue;
        }
        const code = buf.toString('utf8');
        const result = detectObfuscation(code, config);
        scriptResults.push({ lifecycle, file: ref.path, code, ...result });
      }
    }
  }

  if (scriptResults.length === 0) return null;
  return summarizeResults(pkg, scriptResults, config);
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
      files = parseTarGz(tarBuffer, config.maxTarballSize);
    } catch (err) {
      if (err.message.includes('exceeds limit')) {
        // Tarball too large - return a special result indicating oversized tarball
        return {
          pkg,
          scripts: [],
          score: 0,
          findings: [{ name: 'oversized-tarball', score: 0, detail: err.message }],
          verdict: 'OK'
        };
      }
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
 * Analyze a single entry-script reference, including every internal
 * require/import target reachable from it. Returns one combined result row
 * per top-level script reference (not one per file walked), so the existing
 * report shape stays the same.
 *
 * @param {string} lifecycle               e.g. "postinstall"
 * @param {string} entryPath               normalized path of the entry file
 * @param {(p: string) => Buffer|null} readFile
 * @param {object} config
 * @returns {object} script result row
 */
function analyzeScriptWithWalker(lifecycle, entryPath, readFile, config) {
  const walk = walkRequires(entryPath, readFile);

  if (walk.files.size === 0) {
    return {
      lifecycle,
      file: entryPath,
      code: '',
      score: 0,
      findings: [{
        name: 'missing-script',
        score: 0,
        detail: `Command references "${entryPath}" but file not found`,
      }],
      verdict: 'OK',
    };
  }

  // Run detection on every walked file and aggregate.
  const findings = [];
  let maxScore = 0;
  let entryCode = '';

  for (const [filePath, code] of walk.files) {
    if (filePath === entryPath) entryCode = code;
    const result = detectObfuscation(code, config);
    if (result.score > maxScore) maxScore = result.score;
    // Tag each finding with the file it came from so the report makes sense
    // when multiple files contribute.
    for (const f of result.findings) {
      findings.push({
        ...f,
        detail: walk.files.size > 1 ? `[${filePath}] ${f.detail}` : f.detail,
      });
    }
  }

  // Surface dynamic requires as findings — these are unresolvable load
  // targets and the user should review them. They count as a small score
  // bump so a script that ONLY does require(variable) still warrants a look.
  for (const dr of walk.dynamicRequires) {
    findings.push({
      name: 'dynamic-require',
      score: 4,
      detail: `[${dr.file}] dynamic require/import: ${dr.hint}`,
    });
    if (4 > maxScore) maxScore = 4;
  }

  // Truncation is a defense-in-depth signal — a package that loads >50 files
  // from postinstall is suspicious in itself.
  if (walk.truncated) {
    findings.push({
      name: 'oversized-require-graph',
      score: 4,
      detail: `Require graph exceeded scan limits (>${MAX_FILES_PER_PACKAGE} files or ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB)`,
    });
    if (4 > maxScore) maxScore = 4;
  }

  // Unresolved internal requires (e.g. require('./does-not-exist')) are
  // recorded but not scored. They might be legitimate (lazy-loaded optional
  // deps) but are also a common camouflage technique.
  for (const u of walk.unresolved) {
    findings.push({
      name: 'unresolved-require',
      score: 0,
      detail: `[${u.file}] could not resolve "${u.target}"`,
    });
  }

  return {
    lifecycle,
    file: entryPath,
    code: entryCode,
    score: maxScore,
    findings,
    verdict: verdictFromScore(maxScore, config),
    walkedFiles: Array.from(walk.files.keys()),
  };
}

/**
 * Build a tarball-aware readFile callback. The tarball file map uses keys
 * like "package/<path>", so we normalize away the leading top-level dir.
 */
function makeTarballReader(files) {
  // Determine the leading-dir prefix once (typically "package/").
  let prefix = '';
  for (const key of files.keys()) {
    const slash = key.indexOf('/');
    if (slash > 0) { prefix = key.slice(0, slash + 1); break; }
  }
  return (normalizedPath) => {
    // Try with the detected prefix first, then exact, then any leading-dir strip.
    if (prefix) {
      const buf = files.get(prefix + normalizedPath);
      if (buf) return buf;
    }
    if (files.has(normalizedPath)) return files.get(normalizedPath);
    // Last-ditch: try every entry stripped of its leading component.
    for (const [k, v] of files) {
      if (k.replace(/^[^/]+\//, '') === normalizedPath) return v;
    }
    return null;
  };
}

/**
 * Build a local-filesystem readFile callback rooted at the package dir.
 */
function makeLocalReader(pkgDir) {
  return (normalizedPath) => {
    if (!pkgDir) return null;
    const abs = path.join(pkgDir, normalizedPath);
    // Guard against path traversal escaping the package root. Anything that
    // resolves outside pkgDir is treated as not-found.
    const rel = path.relative(pkgDir, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    try {
      return fs.readFileSync(abs);
    } catch {
      return null;
    }
  };
}

/**
 * Analyze install scripts from a tarball's file map.
 */
function analyzeScripts(pkg, pkgJson, files, config) {
  const scripts = getInstallScripts(pkgJson);
  if (scripts.length === 0) return null;

  const reader = makeTarballReader(files);
  const scriptResults = [];

  for (const { lifecycle, command } of scripts) {
    const refs = parseCommand(command);
    if (refs.length === 0) {
      const result = detectObfuscation(command, config);
      scriptResults.push({ lifecycle, file: '(inline)', code: command, ...result });
      continue;
    }

    for (const ref of refs) {
      if (ref.kind === 'inline') {
        const result = detectObfuscation(ref.code, config);
        scriptResults.push({ lifecycle, file: `(inline:${ref.interpreter})`, code: ref.code, ...result });
        continue;
      }

      // ref.kind === 'file'. Only Node-interpreted JS gets the require walk;
      // shell scripts and binary files are read once and analyzed flat.
      if (ref.interpreter === 'node' || ref.interpreter === 'auto') {
        scriptResults.push(analyzeScriptWithWalker(lifecycle, ref.path, reader, config));
      } else {
        const fileBuf = reader(ref.path);
        if (!fileBuf) {
          scriptResults.push({
            lifecycle,
            file: ref.path,
            code: '',
            score: 0,
            findings: [{
              name: 'missing-script',
              score: 0,
              detail: `Command references "${ref.path}" but file not found`,
            }],
            verdict: 'OK',
          });
          continue;
        }
        const code = fileBuf.toString('utf8');
        const result = detectObfuscation(code, config);
        scriptResults.push({ lifecycle, file: ref.path, code, ...result });
      }
    }
  }

  if (scriptResults.length === 0) return null;
  return summarizeResults(pkg, scriptResults, config);
}

/**
 * Analyze install scripts from local node_modules.
 */
function analyzeScriptsLocal(pkg, pkgJson, cwd, config) {
  const pkgDir = findLocalPackageDir(cwd, pkg.name);
  if (!pkgDir) return null;
  return analyzeScriptsLocalFromDir(pkg, pkgJson, pkgDir, config);
}

function summarizeResults(pkg, scriptResults, config) {
  const maxScore = Math.max(...scriptResults.map(r => r.score));
  const allFindings = scriptResults.flatMap(r => r.findings);
  const verdict = verdictFromScore(maxScore, config);
  return { pkg, scripts: scriptResults, score: maxScore, findings: allFindings, verdict };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasInstallScripts(pkgJson) {
  if (!pkgJson || !pkgJson.scripts) return false;
  return LIFECYCLE_SCRIPTS.some(lc => pkgJson.scripts[lc]);
}

function getInstallScripts(pkgJson) {
  const result = [];
  const s = pkgJson && pkgJson.scripts || {};
  for (const lc of LIFECYCLE_SCRIPTS) {
    if (s[lc]) result.push({ lifecycle: lc, command: s[lc] });
  }
  return result;
}

/**
 * Extract the first JS file path from a script command.
 *
 * @deprecated Superseded by `parseCommand` in src/utils/command.js, which
 * understands chained commands, shell scripts, `node -e`, multi-interpreter
 * pipelines, and returns *all* script references instead of just one. Kept
 * here only so external consumers importing this symbol don't break.
 * Returns null if no node-invoked JS file can be extracted.
 */
function extractScriptFileFromCommand(command) {
  const refs = parseCommand(command);
  const fileRef = refs.find(r => r.kind === 'file' && r.interpreter === 'node');
  return fileRef ? fileRef.path : null;
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
 * Extract the first clean X.Y.Z (or X.Y or X) semver from a range string.
 * Returns null if no clean version can be found.
 * Examples: "^5.1.0" → "5.1.0", "4.22.1 || ^5" → "4.22.1", "2" → "2", "*" → null
 */
function extractSemver(range) {
  const match = range.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?|\d+\.\d+|\d+)(?!\S*-)/);
  if (match) return match[1];
  return null;
}

/**
 * Resolve an extracted (possibly partial) version to a full version using registry metadata.
 * Falls back to dist-tags.latest when the partial version doesn't match any published version.
 */
function resolveVersion(extracted, meta) {
  if (meta.versions && meta.versions[extracted]) return extracted;
  const latest = meta['dist-tags'] && meta['dist-tags'].latest;
  if (latest && meta.versions && meta.versions[latest]) return latest;
  return null;
}

/**
 * Resolve dependencies from package.json when no lockfile exists.
 * @param {string} cwd
 * @param {object} config
 * @param {boolean} noDev
 * @returns {Promise<PackageDescriptor[]>}
 */
async function resolveFromPackageJson(cwd, config, noDev) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    // No package.json — nothing to scan (e.g. empty directory)
    return [];
  }

  let pkgJson;
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse package.json: ${err.message}`);
  }

  const deps = { ...pkgJson.dependencies };
  if (!noDev && pkgJson.devDependencies) {
    Object.assign(deps, pkgJson.devDependencies);
  }

  const packages = [];
  const { fetchJSON } = require('../utils/fetcher');

  for (const [name, range] of Object.entries(deps)) {
    const version = extractSemver(range);
    if (!version) continue;

    try {
      const encodedName = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
      const meta = await fetchJSON(`${config.registry}/${encodedName}`, { timeout: config.timeout });
      const resolvedVersion = resolveVersion(version, meta);
      if (!resolvedVersion) continue;
      const versionData = meta.versions[resolvedVersion];

      packages.push({
        name,
        version: resolvedVersion,
        resolved: versionData.dist && versionData.dist.tarball,
        integrity: versionData.dist && versionData.dist.integrity || '',
        hasInstallScript: !!(versionData.scripts &&
          (versionData.scripts.preinstall || versionData.scripts.postinstall || versionData.scripts.install)),
        dev: !!(pkgJson.devDependencies && pkgJson.devDependencies[name]),
        optional: false,
        inBundle: false,
        link: false,
      });
    } catch {
      // Skip packages we can't fetch metadata for
    }
  }

  return packages;
}

/**
 * Resolve a single package's dependency tree via the npm registry.
 * @param {string} packageSpec  e.g. "express" or "express@4.18.0"
 * @param {object} config
 * @returns {Promise<PackageDescriptor[]>}
 */
async function resolveSinglePackage(packageSpec, config) {
  let name, version;
  const lastAt = packageSpec.lastIndexOf('@');
  if (lastAt > 0) {
    name = packageSpec.slice(0, lastAt);
    version = packageSpec.slice(lastAt + 1);
  } else {
    name = packageSpec;
    version = 'latest';
  }

  const { fetchJSON } = require('../utils/fetcher');
  let meta;
  try {
    const encodedName = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
    meta = await fetchJSON(`${config.registry}/${encodedName}`, { timeout: config.timeout });
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

  async function collectDeps(deps, recurse) {
    const queue = Object.entries(deps || {}).filter(([depName]) => !seen.has(depName));
    // Mark all as seen first to avoid duplicate fetches
    for (const [depName] of queue) seen.add(depName);

    const resolutions = await mapWithConcurrency(queue, config.parallelFetches, async ([depName, range]) => {
      const extractedVersion = extractSemver(range);
      if (!extractedVersion) return null;

      let depScripts = false;
      let depDeps = null;
      let depTarball = buildTarballUrl(depName, extractedVersion, config.registry);
      let depIntegrity = '';
      let resolvedDepVersion = extractedVersion;

      try {
        const encodedDep = depName.startsWith('@') ? `@${encodeURIComponent(depName.slice(1))}` : encodeURIComponent(depName);
        const depMeta = await fetchJSON(`${config.registry}/${encodedDep}`, { timeout: config.timeout });
        const fullVersion = resolveVersion(extractedVersion, depMeta);
        const depData = fullVersion && depMeta.versions && depMeta.versions[fullVersion];
        if (depData) {
          resolvedDepVersion = fullVersion;
          depScripts = !!(depData.scripts &&
            (depData.scripts.preinstall || depData.scripts.postinstall || depData.scripts.install));
          depTarball = depData.dist && depData.dist.tarball || buildTarballUrl(depName, fullVersion, config.registry);
          depIntegrity = depData.dist && depData.dist.integrity || '';
          depDeps = depData.dependencies;
        }
      } catch {
        // Failed to fetch dep metadata — add with what we have
      }

      return {
        pkg: {
          name:             depName,
          version:          resolvedDepVersion,
          resolved:         depTarball,
          integrity:        depIntegrity,
          hasInstallScript: depScripts,
          dev:              false,
          optional:         false,
          inBundle:         false,
          link:             false,
        },
        depDeps,
      };
    });

    for (const r of resolutions) {
      if (!r) continue;
      packages.push(r.pkg);
      if (recurse && r.depDeps) await collectDeps(r.depDeps, true);
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

  seen.add(name);
  await collectDeps(versionData.dependencies, !!config.deepResolve);

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

module.exports = { scan, hasInstallScripts, extractScriptFileFromCommand, verdictFromScore, resolveVersion, extractSemver };
