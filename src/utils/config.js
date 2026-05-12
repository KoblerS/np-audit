'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.npmauditor.json');

const DEFAULT_CONFIG = Object.freeze({
  blockScore:      7,
  warnScore:       4,
  registry:        'https://registry.npmjs.org',
  timeout:         30000,
  parallelFetches: 5,
  skipScopes:      [],
  skipPackages:    [],
  silent:          false,
  scanSelf:        true,
  maxTarballSize:  '50MB', // Max unpacked tarball size (e.g. '5MB', '1GB', or bytes as number)
});

const VALID_KEYS = new Set(Object.keys(DEFAULT_CONFIG));

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig(cwd) {
  const base    = { ...DEFAULT_CONFIG };
  // Parse the default maxTarballSize string to bytes
  base.maxTarballSize = parseSize(base.maxTarballSize);
  const global_ = readJSON(GLOBAL_CONFIG_PATH) || {};
  const local   = cwd ? readJSON(path.join(cwd, '.npmauditor.json')) || {} : {};
  return Object.assign(base, coerce(global_), coerce(local));
}

/**
 * Parse size strings like '5MB', '1GB', '500KB' to bytes.
 * @param {string|number} value
 * @returns {number} Size in bytes
 */
function parseSize(value) {
  if (typeof value === 'number') return Math.max(0, value);
  if (typeof value !== 'string') return 0;

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();

  const multipliers = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  const bytes = num * (multipliers[unit] || 1);

  // Cap at available RAM to prevent out-of-memory
  const totalMem = os.totalmem();
  return Math.min(Math.max(0, Math.floor(bytes)), totalMem);
}

function coerce(obj) {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!VALID_KEYS.has(key)) continue;
    const def = DEFAULT_CONFIG[key];
    if (key === 'maxTarballSize') {
      result[key] = parseSize(val);
    } else if (Array.isArray(def)) {
      result[key] = Array.isArray(val) ? val : [val];
    } else if (typeof def === 'number') {
      const n = Number(val);
      if (!isNaN(n)) result[key] = n;
    } else if (typeof def === 'boolean') {
      result[key] = val === true || val === 'true' || val === '1';
    } else {
      result[key] = val;
    }
  }
  return result;
}

function setGlobalConfig(key, rawValue) {
  if (!VALID_KEYS.has(key)) {
    throw new Error(`Unknown config key "${key}". Valid keys: ${[...VALID_KEYS].join(', ')}`);
  }
  const current = readJSON(GLOBAL_CONFIG_PATH) || {};
  const patch = coerce({ [key]: rawValue });
  if (Object.keys(patch).length === 0) {
    throw new Error(`Invalid value "${rawValue}" for key "${key}"`);
  }
  const updated = Object.assign(current, patch);
  fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  return updated;
}

function getGlobalConfigPath() {
  return GLOBAL_CONFIG_PATH;
}

module.exports = { loadConfig, setGlobalConfig, getGlobalConfigPath, DEFAULT_CONFIG, VALID_KEYS, parseSize };
