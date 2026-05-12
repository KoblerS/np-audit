'use strict';

const path = require('path');

// Hard caps to prevent pathological inputs from exploding analysis time.
const MAX_FILES_PER_PACKAGE = 50;
const MAX_TOTAL_BYTES        = 5 * 1024 * 1024; // 5 MB total

/**
 * Walk all internal `require('./...')` / `require('../...')` / `import` chains
 * starting from an entry file, returning the full set of files that would be
 * loaded when the entry script runs.
 *
 * This is intentionally regex-based — the package advertises zero runtime
 * dependencies, so we don't pull in a JS parser. The trade-off: we accept
 * occasional false positives (a string literal that *looks* like a require
 * argument) and false negatives (dynamic requires built from variables).
 * Dynamic requires are explicitly recorded as a separate finding so the user
 * sees that *something* unresolvable was loaded.
 *
 * @param {string} entryPath              normalized path of the start file
 * @param {(p: string) => Buffer|null} readFile  callback that returns the file
 *                                              contents at a given normalized
 *                                              path, or null if not found
 * @returns {{
 *   files: Map<string, string>,           // path → source code
 *   dynamicRequires: Array<{file: string, hint: string}>,
 *   unresolved: Array<{file: string, target: string}>,
 *   truncated: boolean
 * }}
 */
function walkRequires(entryPath, readFile) {
  const files = new Map();
  const dynamicRequires = [];
  const unresolved = [];
  const queue = [entryPath];
  const seen = new Set();
  let totalBytes = 0;
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);

    if (files.size >= MAX_FILES_PER_PACKAGE) { truncated = true; break; }

    const buf = readFile(current);
    if (!buf) continue;

    totalBytes += buf.length;
    if (totalBytes > MAX_TOTAL_BYTES) { truncated = true; break; }

    const code = buf.toString('utf8');
    files.set(current, code);

    const { staticTargets, dynamicHints } = extractRequires(code);

    for (const hint of dynamicHints) {
      dynamicRequires.push({ file: current, hint });
    }

    for (const target of staticTargets) {
      // Only follow *internal* paths — explicit relative or absolute-within-package.
      // Package-name requires (e.g. require('lodash')) are external; the scanner
      // would have to resolve them as separate dependencies, which is out of
      // scope here — npm's own resolution will fetch and ship them, and they
      // appear independently in the lockfile so np-audit scans them anyway.
      if (!isInternalRequire(target)) continue;

      const resolved = resolveRelative(current, target, readFile);
      if (resolved) {
        if (!seen.has(resolved)) queue.push(resolved);
      } else {
        unresolved.push({ file: current, target });
      }
    }
  }

  return { files, dynamicRequires, unresolved, truncated };
}

/**
 * Extract every require/import target literal from a chunk of source code.
 * Splits the result into:
 *   - staticTargets:  string literals we can resolve at scan time
 *   - dynamicHints:   non-literal arguments (variables, template substitutions,
 *                     string concatenations) that signal a dynamic load
 */
function extractRequires(code) {
  const staticTargets = new Set();
  const dynamicHints = [];

  // 1. require('literal')   — including template strings without substitution
  const staticRe = /\brequire\s*\(\s*(['"`])([^'"`\n\r$]+)\1\s*\)/g;
  let m;
  while ((m = staticRe.exec(code)) !== null) {
    staticTargets.add(m[2]);
  }

  // 2. import 'literal'  and  import x from 'literal'  and  import x, {y} from 'literal'
  const importRe = /\bimport\s+(?:[^'"`;]+\s+from\s+)?(['"`])([^'"`\n\r$]+)\1/g;
  while ((m = importRe.exec(code)) !== null) {
    staticTargets.add(m[2]);
  }

  // 3. await import('literal') / import('literal') dynamic import with a literal arg
  const dynImportRe = /\bimport\s*\(\s*(['"`])([^'"`\n\r$]+)\1\s*\)/g;
  while ((m = dynImportRe.exec(code)) !== null) {
    staticTargets.add(m[2]);
  }

  // 4. Dynamic require: require(variable), require(expr+expr), require(`tpl${x}`)
  //    We capture only enough to record that *something* dynamic was loaded —
  //    the actual target is unknowable without execution.
  const dynamicRe = /\brequire\s*\(\s*([^)]*?)\s*\)/g;
  while ((m = dynamicRe.exec(code)) !== null) {
    const arg = m[1].trim();
    if (arg === '') continue;
    // Pure literal? Already captured above. Skip.
    if (/^(['"`])[^'"`\n\r$]+\1$/.test(arg)) continue;
    // Looks like a literal with embedded template expression, concatenation,
    // variable, member access, or function call. Record it.
    dynamicHints.push(arg.slice(0, 120));
  }

  // 5. Dynamic import: import(variable)
  const dynImportDynamicRe = /\bimport\s*\(\s*([^)]*?)\s*\)/g;
  while ((m = dynImportDynamicRe.exec(code)) !== null) {
    const arg = m[1].trim();
    if (arg === '') continue;
    if (/^(['"`])[^'"`\n\r$]+\1$/.test(arg)) continue;
    dynamicHints.push(`import(${arg.slice(0, 100)})`);
  }

  return {
    staticTargets: Array.from(staticTargets),
    dynamicHints,
  };
}

/**
 * Is this require target a relative or absolute-within-package path
 * (as opposed to a package-name import like 'lodash')?
 */
function isInternalRequire(target) {
  return target.startsWith('./') || target.startsWith('../') || target.startsWith('/');
}

/**
 * Resolve a relative require target against the directory of the requiring
 * file, applying Node's resolution rules: try the path as-is, then with
 * common extensions, then as a directory's index file.
 *
 * @param {string} fromFile  normalized path of the requiring file
 * @param {string} target    the require argument string
 * @param {(p: string) => Buffer|null} readFile
 * @returns {string|null}    normalized path of the resolved file
 */
function resolveRelative(fromFile, target, readFile) {
  const fromDir = path.posix.dirname(fromFile.replace(/\\/g, '/'));
  // Strip a leading absolute slash if present — we treat all paths as
  // package-relative.
  const rel = target.startsWith('/') ? target.slice(1) : target;
  const joined = path.posix.normalize(path.posix.join(fromDir, rel));

  const candidates = [
    joined,
    joined + '.js',
    joined + '.mjs',
    joined + '.cjs',
    joined + '.json',
    joined + '/index.js',
    joined + '/index.mjs',
    joined + '/index.cjs',
  ];

  for (const c of candidates) {
    if (readFile(c)) return c;
  }
  return null;
}

module.exports = {
  walkRequires,
  extractRequires,
  resolveRelative,
  isInternalRequire,
  // Exported for tests
  MAX_FILES_PER_PACKAGE,
  MAX_TOTAL_BYTES,
};
