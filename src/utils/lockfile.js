'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Parse package-lock.json (v1, v2, v3) and return a normalized flat array of packages.
 * @param {string} cwd  directory containing package-lock.json
 * @returns {{ lockfileVersion: number, packages: PackageDescriptor[] }}
 */
function parseLockfile(cwd) {
  const lockPath = path.join(cwd, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error(`package-lock.json not found in ${cwd}. Run "npm install" first or use "npa install".`);
  }

  let lockData;
  try {
    lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse package-lock.json: ${e.message}`);
  }

  const version = lockData.lockfileVersion || 1;
  let packages;

  if (version >= 2 && lockData.packages) {
    packages = flattenV2(lockData.packages);
  } else if (lockData.dependencies) {
    packages = flattenV1(lockData.dependencies);
  } else {
    packages = [];
  }

  return { lockfileVersion: version, packages };
}

/**
 * Flatten v2/v3 lockfile packages object (key → descriptor).
 * @param {object} pkgsObj
 * @returns {PackageDescriptor[]}
 */
function flattenV2(pkgsObj) {
  const result = [];
  for (const [key, entry] of Object.entries(pkgsObj)) {
    if (key === '') continue; // root package
    if (entry.link) continue; // workspace symlink

    const name = nameFromKey(key);
    if (!name) continue;

    result.push({
      name,
      version:          entry.version || '',
      resolved:         entry.resolved || '',
      integrity:        entry.integrity || '',
      hasInstallScript: entry.hasInstallScript === true,
      dev:              entry.dev === true,
      optional:         entry.optional === true,
      inBundle:         entry.inBundle === true,
      link:             false,
      _lockKey:         key,
    });
  }
  return result;
}

/**
 * Recursively flatten v1 lockfile dependencies tree.
 * @param {object} deps
 * @param {PackageDescriptor[]} result
 * @returns {PackageDescriptor[]}
 */
function flattenV1(deps, result = []) {
  for (const [name, entry] of Object.entries(deps || {})) {
    result.push({
      name,
      version:          entry.version || '',
      resolved:         entry.resolved || '',
      integrity:        entry.integrity || '',
      hasInstallScript: false, // not indicated in v1 — must check
      dev:              entry.dev === true,
      optional:         entry.optional === true,
      inBundle:         entry.bundled === true,
      link:             false,
      _lockKey:         `node_modules/${name}`,
    });
    if (entry.dependencies) {
      flattenV1(entry.dependencies, result);
    }
  }
  return result;
}

/**
 * Extract the npm package name from a v2/v3 lockfile key.
 * Examples:
 *   "node_modules/express"           → "express"
 *   "node_modules/@babel/core"       → "@babel/core"
 *   "foo/node_modules/bar"           → "bar"
 */
function nameFromKey(key) {
  const match = key.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)$/);
  return match ? match[1] : null;
}

module.exports = { parseLockfile, nameFromKey };
