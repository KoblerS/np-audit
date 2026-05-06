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
  const global_ = readJSON(GLOBAL_CONFIG_PATH) || {};
  const local   = cwd ? readJSON(path.join(cwd, '.npmauditor.json')) || {} : {};
  return Object.assign(base, coerce(global_), coerce(local));
}

function coerce(obj) {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!VALID_KEYS.has(key)) continue;
    const def = DEFAULT_CONFIG[key];
    if (Array.isArray(def)) {
      result[key] = Array.isArray(val) ? val : [val];
    } else if (typeof def === 'number') {
      const n = Number(val);
      if (!isNaN(n)) result[key] = n;
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

module.exports = { loadConfig, setGlobalConfig, getGlobalConfigPath, DEFAULT_CONFIG, VALID_KEYS };
