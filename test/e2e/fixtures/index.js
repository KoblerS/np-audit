'use strict';

/**
 * E2E test fixtures — helper to build realistic fake tarballs and lockfiles.
 */

const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');

function buildTar(files) {
  const BLOCK = 512;
  const blocks = [];

  for (const { name, content } of files) {
    const header = Buffer.alloc(BLOCK, 0);
    header.write(name, 0, 100, 'ascii');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    const sizeOctal = content.length.toString(8).padStart(11, '0') + '\0';
    header.write(sizeOctal, 124, 12, 'ascii');
    const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
    header.write(mtime, 136, 12, 'ascii');
    header[156] = 0x30;
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    header.fill(0x20, 148, 156);
    let checksum = 0;
    for (let i = 0; i < BLOCK; i++) checksum += header[i];
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header);
    const dataBlocks = Math.ceil(content.length / BLOCK);
    const dataBuf = Buffer.alloc(dataBlocks * BLOCK, 0);
    content.copy(dataBuf);
    blocks.push(dataBuf);
  }

  blocks.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(blocks);
}

/**
 * Build a .tgz Buffer for a fake npm package.
 * @param {object} pkgJson
 * @param {object} scripts  { [filename]: content }
 * @returns {Buffer}
 */
function buildFakeTarball(pkgJson, scripts = {}) {
  const files = [
    { name: 'package/package.json', content: Buffer.from(JSON.stringify(pkgJson, null, 2)) },
  ];
  for (const [name, content] of Object.entries(scripts)) {
    files.push({ name: `package/${name}`, content: Buffer.from(content) });
  }
  return zlib.gzipSync(buildTar(files));
}

/**
 * Build a minimal v2 lockfile object.
 * @param {Array<{name, version, resolved, hasInstallScript?, dev?}>} pkgs
 * @returns {object}
 */
function buildLockfile(pkgs) {
  const packages = { '': { name: 'test-project', version: '1.0.0' } };
  for (const pkg of pkgs) {
    packages[`node_modules/${pkg.name}`] = {
      version:          pkg.version,
      resolved:         pkg.resolved,
      integrity:        '',
      hasInstallScript: pkg.hasInstallScript || false,
      dev:              pkg.dev || false,
    };
  }
  return { name: 'test-project', lockfileVersion: 2, packages };
}

module.exports = { buildFakeTarball, buildLockfile };
