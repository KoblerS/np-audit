'use strict';

const fs = require('fs');
const path = require('path');

const commands = new Map();

// Load all command modules from this directory
const files = fs.readdirSync(__dirname).filter(f => f !== 'index.js' && f.endsWith('.js'));

for (const file of files) {
  const cmd = require(path.join(__dirname, file));
  commands.set(cmd.name, cmd);
  for (const alias of cmd.aliases || []) {
    commands.set(alias, cmd);
  }
}

module.exports = {
  commands,

  get(name) {
    return commands.get(name);
  },

  list() {
    const seen = new Set();
    const result = [];
    for (const cmd of commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  },
};
