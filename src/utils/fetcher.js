'use strict';

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const url    = require('url');

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT = 30000;

/**
 * Perform an HTTP/HTTPS GET and collect the response body as a Buffer.
 * Follows redirects up to MAX_REDIRECTS.
 * @param {string} rawUrl
 * @param {object} opts  { timeout?, headers? }
 * @returns {Promise<Buffer>}
 */
function fetch(rawUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    let redirects = 0;

    function request(target) {
      const parsed = new url.URL(target);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const reqOpts = {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers:  Object.assign({
          'User-Agent': 'npa/1.0.0 (npm-auditor)',
          'Accept':     '*/*',
        }, opts.headers || {}),
      };

      const timeout = opts.timeout || DEFAULT_TIMEOUT;
      const req = lib.request(reqOpts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (++redirects > MAX_REDIRECTS) {
            return reject(new Error(`Too many redirects for ${rawUrl}`));
          }
          res.resume();
          return request(res.headers.location);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${target}`));
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end',  () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });

      req.setTimeout(timeout, () => {
        req.destroy(new Error(`Request timed out after ${timeout}ms: ${target}`));
      });

      req.on('error', reject);
      req.end();
    }

    request(rawUrl);
  });
}

/**
 * Fetch a tarball as a Buffer.
 * @param {string} tarballUrl
 * @param {object} opts  { timeout? }
 * @returns {Promise<Buffer>}
 */
function fetchTarball(tarballUrl, opts = {}) {
  return fetch(tarballUrl, opts);
}

/**
 * Fetch JSON from npm registry.
 * @param {string} jsonUrl
 * @param {object} opts  { timeout? }
 * @returns {Promise<object>}
 */
async function fetchJSON(jsonUrl, opts = {}) {
  const buf = await fetch(jsonUrl, {
    ...opts,
    headers: { 'Accept': 'application/json' },
  });
  return JSON.parse(buf.toString('utf8'));
}

/**
 * Build the canonical tarball URL when the lockfile resolved field is missing.
 * @param {string} name      package name (may be scoped)
 * @param {string} version
 * @param {string} registry  base URL e.g. 'https://registry.npmjs.org'
 * @returns {string}
 */
function buildTarballUrl(name, version, registry) {
  const base = registry.replace(/\/$/, '');
  if (name.startsWith('@')) {
    // Scoped: @scope/pkg → @scope/pkg/-/@scope/pkg-version.tgz
    const [scope, pkg] = name.split('/');
    const encoded = encodeURIComponent(scope) + '%2F' + pkg;
    return `${base}/${encoded}/-/${pkg}-${version}.tgz`;
  }
  return `${base}/${name}/-/${name}-${version}.tgz`;
}

/**
 * Verify a tarball Buffer against an integrity string from the lockfile.
 * Supports sha512-<base64> and sha1-<base64>.
 * @param {Buffer} buffer
 * @param {string} integrity  e.g. "sha512-abc123=="
 * @returns {boolean}  true if valid or integrity is empty
 */
function verifyIntegrity(buffer, integrity) {
  if (!integrity) return true;
  const match = integrity.match(/^(sha512|sha1)-(.+)$/);
  if (!match) return true;
  const [, algo, expected] = match;
  const actual = crypto.createHash(algo).update(buffer).digest('base64');
  return actual === expected;
}

module.exports = { fetchTarball, fetchJSON, buildTarballUrl, verifyIntegrity };
