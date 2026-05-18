'use strict';

const { Marshaller } = require('./base');

class RuntimeDownloadMarshaller extends Marshaller {
  constructor() {
    super('runtime-download', 'External runtime download and execution');
  }

  check(code) {
    // Detect downloading external runtimes (common evasion: use Bun/Deno to bypass Node-based tools)
    const runtimePatterns = [
      /bun-(?:linux|darwin|windows)/i,
      /oven-sh\/bun/i,
      /deno\.land/i,
      /denoland\/deno/i,
      /BUN_VERSION/,
      /DENO_VERSION/,
      /bun\.exe/,
      /deno\.exe/,
    ];

    // Detect execution of downloaded binaries
    const execPatterns = [
      /execFileSync\s*\(\s*\w*[Bb]un/,
      /execFileSync\s*\(\s*\w*[Dd]eno/,
      /execFile\s*\(\s*\w*[Bb]un/,
      /execFile\s*\(\s*\w*[Dd]eno/,
      /spawn\s*\(\s*\w*[Bb]un/,
      /spawn\s*\(\s*\w*[Dd]eno/,
      // Generic: download + chmod + exec pattern
      /chmodSync\s*\([^)]*0o?755\)[\s\S]{0,500}execFileSync/,
      /chmod[\s\S]{0,200}exec(?:File)?(?:Sync)?\s*\(/,
    ];

    // Detect download URLs for binaries combined with execution
    const downloadExecPatterns = [
      /https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download[\s\S]{0,1000}exec(?:File)?(?:Sync)?\s*\(/,
      /downloadToFile[\s\S]{0,2000}exec(?:File)?(?:Sync)?\s*\(/,
      /createWriteStream[\s\S]{0,2000}exec(?:File)?(?:Sync)?\s*\(/,
    ];

    const runtimeMatches = runtimePatterns.filter(p => p.test(code));
    const execMatches = execPatterns.filter(p => p.test(code));
    const downloadExecMatches = downloadExecPatterns.filter(p => p.test(code));

    if (runtimeMatches.length === 0 && downloadExecMatches.length === 0) return null;

    const details = [];

    if (runtimeMatches.length > 0) {
      details.push(`external runtime reference (${runtimeMatches.length} pattern(s))`);
    }
    if (execMatches.length > 0) {
      details.push(`executes downloaded binary (${execMatches.length} pattern(s))`);
    }
    if (downloadExecMatches.length > 0) {
      details.push('downloads and executes remote binary');
    }

    // High score: downloading a runtime to execute code is a major evasion technique
    let score = 9;
    if (runtimeMatches.length > 0 && (execMatches.length > 0 || downloadExecMatches.length > 0)) {
      score = 50;
    } else if (downloadExecMatches.length > 0) {
      score = 30;
    }

    return { name: this.name, score, detail: details.join('; ') };
  }
}

module.exports = new RuntimeDownloadMarshaller();
