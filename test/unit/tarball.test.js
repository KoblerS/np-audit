'use strict';

const assert  = require('assert');
const zlib    = require('zlib');
const { parseTarGz, extractFile, getPackageJson } = require('../../src/tarball');

// ─── Helpers to build minimal tar.gz in-memory ───────────────────────────────

function buildTar(files) {
  // files: [{name, content (Buffer)}]
  const BLOCK = 512;
  const blocks = [];

  for (const { name, content } of files) {
    const header = Buffer.alloc(BLOCK, 0);
    // Filename (offset 0, 100 bytes)
    header.write(name, 0, 100, 'ascii');
    // File mode (offset 100)
    header.write('0000644\0', 100, 8, 'ascii');
    // UID/GID (108, 116)
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    // Size (offset 124, 12 bytes, octal)
    const sizeOctal = content.length.toString(8).padStart(11, '0') + '\0';
    header.write(sizeOctal, 124, 12, 'ascii');
    // mtime (offset 136)
    const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
    header.write(mtime, 136, 12, 'ascii');
    // typeflag: '0' = regular file (offset 156)
    header[156] = 0x30; // '0'
    // ustar magic (offset 257)
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');

    // Compute checksum (offset 148, 8 bytes)
    header.fill(0x20, 148, 156); // spaces during checksum calc
    let checksum = 0;
    for (let i = 0; i < BLOCK; i++) checksum += header[i];
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

    blocks.push(header);

    // Data blocks
    const dataBlocks = Math.ceil(content.length / BLOCK);
    const dataBuf = Buffer.alloc(dataBlocks * BLOCK, 0);
    content.copy(dataBuf);
    blocks.push(dataBuf);
  }

  // Two zero blocks (EOF)
  blocks.push(Buffer.alloc(BLOCK * 2, 0));

  return Buffer.concat(blocks);
}

function buildTarGz(files) {
  return zlib.gzipSync(buildTar(files));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// Single file extraction
{
  const content = Buffer.from('console.log("hello")');
  const gz = buildTarGz([{ name: 'package/index.js', content }]);
  const files = parseTarGz(gz);
  assert.ok(files.has('package/index.js'), 'file present in map');
  assert.strictEqual(files.get('package/index.js').toString(), 'console.log("hello")', 'content matches');
}

// Multiple files
{
  const pkg = Buffer.from(JSON.stringify({ name: 'testpkg', version: '1.0.0', scripts: { postinstall: 'node install.js' } }));
  const install = Buffer.from('process.exit(0);');
  const gz = buildTarGz([
    { name: 'package/package.json', content: pkg },
    { name: 'package/install.js', content: install },
  ]);
  const files = parseTarGz(gz);
  assert.ok(files.has('package/package.json'), 'package.json present');
  assert.ok(files.has('package/install.js'), 'install.js present');
}

// getPackageJson
{
  const pkgData = { name: 'mypkg', version: '2.0.0', scripts: { preinstall: 'node pre.js' } };
  const gz = buildTarGz([
    { name: 'package/package.json', content: Buffer.from(JSON.stringify(pkgData)) },
  ]);
  const files = parseTarGz(gz);
  const parsed = getPackageJson(files);
  assert.deepStrictEqual(parsed, pkgData, 'getPackageJson returns parsed object');
}

// extractFile with "package/" prefix stripping
{
  const content = Buffer.from('data');
  const gz = buildTarGz([{ name: 'package/lib/util.js', content }]);
  const files = parseTarGz(gz);
  const extracted = extractFile(files, 'lib/util.js');
  assert.ok(extracted, 'extractFile strips package/ prefix');
  assert.strictEqual(extracted.toString(), 'data');
}

// Empty tarball (just EOF blocks)
{
  const gz = zlib.gzipSync(Buffer.alloc(1024, 0));
  const files = parseTarGz(gz);
  assert.strictEqual(files.size, 0, 'empty tarball returns empty map');
}

// Large file content (multi-block)
{
  const content = Buffer.alloc(1500, 0x41); // 1500 bytes of 'A'
  const gz = buildTarGz([{ name: 'package/big.js', content }]);
  const files = parseTarGz(gz);
  const result = files.get('package/big.js');
  assert.ok(result, 'large file present');
  assert.strictEqual(result.length, 1500, 'large file has correct length');
  assert.ok(result.every(b => b === 0x41), 'large file content correct');
}

console.log('  tarball.test.js: all tests passed');
