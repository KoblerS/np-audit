'use strict';

const { Marshaller } = require('./base');

class VscodeTasksMarshaller extends Marshaller {
  constructor() {
    super('vscode-autorun', 'VS Code tasks with automatic execution');
  }

  check(code) {
    // Detect tasks.json content with runOn: folderOpen (auto-executes on project open)
    if (!code.includes('runOn') && !code.includes('folderOpen')) return null;

    const hasFolderOpen = /["']runOn["']\s*:\s*["']folderOpen["']/.test(code);
    if (!hasFolderOpen) return null;

    // Extract the command being auto-run
    const commandMatch = code.match(/["']command["']\s*:\s*["']([^"']+)["']/);
    const command = commandMatch ? commandMatch[1] : 'unknown';

    return {
      name: this.name,
      score: 30,
      detail: `VS Code task auto-executes on folder open: "${command}"`,
    };
  }
}

module.exports = new VscodeTasksMarshaller();
