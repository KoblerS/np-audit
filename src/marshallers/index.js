'use strict';

const fs   = require('fs');
const path = require('path');

const MARSHALLERS_DIR = __dirname;
const EXCLUDE = new Set(['index.js', 'base.js', 'cve.js']);

let _staticMarshallers = null;

function getStaticMarshallers() {
  if (_staticMarshallers) return _staticMarshallers;

  _staticMarshallers = fs.readdirSync(MARSHALLERS_DIR)
    .filter(f => f.endsWith('.js') && !EXCLUDE.has(f))
    .map(f => require(path.join(MARSHALLERS_DIR, f)));

  return _staticMarshallers;
}

function getPackageMarshallers() {
  return [require('./cve')];
}

module.exports = { getStaticMarshallers, getPackageMarshallers };
