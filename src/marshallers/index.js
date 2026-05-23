'use strict';

const fs   = require('fs');
const path = require('path');

const MARSHALLERS_DIR = __dirname;
const EXCLUDE = new Set(['index.js', 'base.js', 'cve.js']);

let _staticMarshallers = null;

function loadStaticMarshallers() {
  if (!_staticMarshallers) {
    _staticMarshallers = fs.readdirSync(MARSHALLERS_DIR)
      .filter(f => f.endsWith('.js') && !EXCLUDE.has(f))
      .map(f => require(path.join(MARSHALLERS_DIR, f)));
  }
  return _staticMarshallers;
}

function getStaticMarshallers(disabledMarshallers = []) {
  const all = loadStaticMarshallers();
  if (disabledMarshallers.length === 0) return all;
  const disabled = new Set(disabledMarshallers);
  return all.filter(m => !disabled.has(m.name));
}

function getPackageMarshallers(disabledMarshallers = []) {
  const all = [require('./cve')];
  if (disabledMarshallers.length === 0) return all;
  const disabled = new Set(disabledMarshallers);
  return all.filter(m => !disabled.has(m.name));
}

function getAllMarshallers() {
  return {
    static: loadStaticMarshallers(),
    package: [require('./cve')],
  };
}

module.exports = { getStaticMarshallers, getPackageMarshallers, getAllMarshallers };
