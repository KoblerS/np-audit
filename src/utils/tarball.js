'use strict';

const zlib = require('zlib');

const BLOCK_SIZE = 512;

/**
 * Parse a tar.gz buffer and return a Map<normalizedPath, Buffer>.
 * Pure Node.js — no external dependencies.
 * Handles GNU long name (typeflag 'L') and POSIX ustar extended headers (typeflag 'x').
 * @param {Buffer} gzipBuffer
 * @param {number} [maxSize] Maximum total unpacked size in bytes
 * @returns {Map<string, Buffer>}
 */
function parseTarGz(gzipBuffer, maxSize = null) {
  const tar = zlib.gunzipSync(gzipBuffer);
  const files = new Map();
  let totalUnpackedSize = 0;

  let offset = 0;
  let pendingLongName = null;

  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.slice(offset, offset + BLOCK_SIZE);

    // Two consecutive zero blocks = EOF
    if (isZeroBlock(header)) {
      const next = tar.slice(offset + BLOCK_SIZE, offset + BLOCK_SIZE * 2);
      if (next.length === 0 || isZeroBlock(next)) break;
    }

    offset += BLOCK_SIZE;

    const typeFlag = String.fromCharCode(header[156]) || '0';
    const rawName  = readNullTerminated(header, 0, 100);
    const prefix   = readNullTerminated(header, 345, 155);
    const sizeOctal = header.slice(124, 136).toString('ascii').trim();
    const size     = parseInt(sizeOctal, 8) || 0;
    const dataBlocks = Math.ceil(size / BLOCK_SIZE);
    const dataEnd  = offset + dataBlocks * BLOCK_SIZE;

    if (typeFlag === 'L') {
      // GNU long filename — data block contains the real name
      pendingLongName = tar.slice(offset, offset + size).toString('utf8').replace(/\0/g, '');
      offset = dataEnd;
      continue;
    }

    if (typeFlag === 'x' || typeFlag === 'g') {
      // POSIX extended header — skip
      pendingLongName = null;
      offset = dataEnd;
      continue;
    }

    let name = pendingLongName || (prefix ? `${prefix}/${rawName}` : rawName);
    pendingLongName = null;
    name = name.replace(/\0/g, '');

    if ((typeFlag === '0' || typeFlag === '\0') && size > 0) {
      totalUnpackedSize += size;
      if (maxSize !== null && maxSize !== undefined && totalUnpackedSize > maxSize) {
        throw new Error(`Tarball unpacked size (${totalUnpackedSize} bytes) exceeds limit (${maxSize} bytes) — potential zip bomb`);
      }
      files.set(name, tar.slice(offset, offset + size));
    }

    offset = dataEnd;
  }

  return files;
}

/**
 * Extract a specific file from a parsed tarball map.
 * Tries exact path and then strips one leading path component (e.g. "package/").
 * @param {Map<string, Buffer>} files
 * @param {string} filePath
 * @returns {Buffer|null}
 */
function extractFile(files, filePath) {
  if (files.has(filePath)) return files.get(filePath);
  // Try with "package/" prefix (npm tarball convention)
  const prefixed = `package/${filePath}`;
  if (files.has(prefixed)) return files.get(prefixed);
  // Try stripping one leading component
  for (const [key, val] of files) {
    const stripped = key.replace(/^[^/]+\//, '');
    if (stripped === filePath) return val;
  }
  return null;
}

/**
 * Get the package.json buffer from a tarball.
 * @param {Map<string, Buffer>} files
 * @returns {object|null} parsed package.json
 */
function getPackageJson(files) {
  const buf = extractFile(files, 'package.json');
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function isZeroBlock(buf) {
  for (let i = 0; i < BLOCK_SIZE; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

function readNullTerminated(buf, start, maxLen) {
  const end = Math.min(start + maxLen, buf.length);
  let len = start;
  while (len < end && buf[len] !== 0) len++;
  return buf.slice(start, len).toString('utf8');
}

module.exports = { parseTarGz, extractFile, getPackageJson };
