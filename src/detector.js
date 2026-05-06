'use strict';

// ─── Individual detection checks ─────────────────────────────────────────────

/**
 * Detect eval / dynamic code execution.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkEval(code) {
  const patterns = [
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /vm\.runInThisContext\s*\(/,
    /vm\.runInNewContext\s*\(/,
    /vm\.Script\s*\(/,
  ];
  const matched = patterns.filter(p => p.test(code));
  if (matched.length === 0) return null;
  return { name: 'eval/dynamic-exec', score: 8, detail: `eval-like call found (${matched.length} pattern(s))` };
}

/**
 * Detect obfuscator.io signature: _0x variable naming.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkObfuscatorIo(code) {
  const matches = code.match(/_0x[0-9a-fA-F]+/g) || [];
  if (matches.length < 3) return null;
  return { name: 'obfuscator.io', score: 9, detail: `${matches.length} _0x identifiers found` };
}

/**
 * Detect high-entropy strings (likely encoded/encrypted payloads).
 * @param {string} code
 * @returns {Finding|null}
 */
function checkHighEntropy(code) {
  // Extract string literals (single, double, template)
  const stringRe = /(?:"([^"\\]|\\.){50,}"|'([^'\\]|\\.){50,}'|`([^`\\]|\\.){50,}`)/g;
  let match;
  let maxEntropy = 0;
  let worst = '';
  while ((match = stringRe.exec(code)) !== null) {
    const s = match[0].slice(1, -1);
    const e = shannonEntropy(s);
    if (e > maxEntropy) { maxEntropy = e; worst = s.slice(0, 40); }
  }
  if (maxEntropy < 4.5) return null;
  return {
    name: 'high-entropy-string',
    score: 6,
    detail: `Entropy ${maxEntropy.toFixed(2)} in string "${worst}…"`,
  };
}

/**
 * Detect dense hex escape sequences (\x41).
 * @param {string} code
 * @returns {Finding|null}
 */
function checkHexEscapes(code) {
  const hexMatches = (code.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
  if (hexMatches < 10) return null;
  return { name: 'hex-escape-density', score: 5, detail: `${hexMatches} \\xNN hex escapes found` };
}

/**
 * Detect String.fromCharCode with many numeric arguments.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkFromCharCode(code) {
  const re = /String\.fromCharCode\s*\(([^)]+)\)/g;
  let match;
  let maxArgs = 0;
  while ((match = re.exec(code)) !== null) {
    const args = match[1].split(',').filter(a => /^\s*\d+\s*$/.test(a));
    if (args.length > maxArgs) maxArgs = args.length;
  }
  if (maxArgs < 5) return null;
  return { name: 'fromCharCode', score: 7, detail: `String.fromCharCode with ${maxArgs} numeric args` };
}

/**
 * Detect base64 decode combined with eval-like execution.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkBase64Exec(code) {
  const hasBase64 = /atob\s*\(|Buffer\.from\s*\([^)]*,\s*['"]base64['"]\)/.test(code);
  const hasExec   = /eval\s*\(|new\s+Function\s*\(|\.exec\s*\(/.test(code);
  if (!hasBase64) return null;
  if (hasBase64 && !hasExec) {
    return { name: 'base64-decode', score: 3, detail: 'Base64 decode found — verify usage' };
  }
  return { name: 'base64-decode+exec', score: 8, detail: 'Base64 decode with code execution found' };
}

/**
 * Detect child_process / shell execution patterns.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkChildProcess(code) {
  const patterns = [
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /\bexec\s*\(/,
    /\bspawn\s*\(/,
    /\bexecSync\s*\(/,
    /\bspawnSync\s*\(/,
    /\bexecFile\s*\(/,
  ];
  const matched = patterns.filter(p => p.test(code));
  if (matched.length === 0) return null;
  return { name: 'child-process', score: 5, detail: `Shell execution found (${matched.length} pattern(s))` };
}

/**
 * Detect large hex literal arrays (common in minified obfuscated code).
 * @param {string} code
 * @returns {Finding|null}
 */
function checkHexArray(code) {
  // Count 0x1234-style literals
  const hexLiterals = (code.match(/\b0x[0-9a-fA-F]+\b/g) || []).length;
  if (hexLiterals < 20) return null;
  return { name: 'hex-array', score: 7, detail: `${hexLiterals} hex literal values found` };
}

/**
 * Detect process.env access (potential credential exfiltration signal).
 * @param {string} code
 * @returns {Finding|null}
 */
function checkProcessEnv(code) {
  const matches = (code.match(/process\.env\b/g) || []).length;
  if (matches === 0) return null;
  return { name: 'process-env', score: 3, detail: `${matches} process.env access(es)` };
}

/**
 * Detect suspicious network calls (data exfiltration).
 * @param {string} code
 * @returns {Finding|null}
 */
function checkNetworkCalls(code) {
  const patterns = [
    /require\s*\(\s*['"]https?['"]\s*\)/,
    /require\s*\(\s*['"]net['"]\s*\)/,
    /require\s*\(\s*['"]dns['"]\s*\)/,
    /fetch\s*\(/,
    /XMLHttpRequest/,
    /\.request\s*\(/,
  ];
  const matched = patterns.filter(p => p.test(code));
  if (matched.length === 0) return null;
  return { name: 'network-call', score: 4, detail: `Network call found (${matched.length} pattern(s))` };
}

// ─── Entropy helper ──────────────────────────────────────────────────────────

function shannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ─── Main detection function ─────────────────────────────────────────────────

const CHECKS = [
  checkEval,
  checkObfuscatorIo,
  checkHighEntropy,
  checkHexEscapes,
  checkFromCharCode,
  checkBase64Exec,
  checkChildProcess,
  checkHexArray,
  checkProcessEnv,
  checkNetworkCalls,
];

/**
 * Run all checks against a code string.
 * @param {string} code
 * @param {object} config  { blockScore, warnScore }
 * @returns {{ score: number, findings: Finding[], verdict: 'BLOCK'|'WARN'|'OK' }}
 */
function detectObfuscation(code, config = { blockScore: 7, warnScore: 4 }) {
  if (!code || typeof code !== 'string') {
    return { score: 0, findings: [], verdict: 'OK' };
  }

  const findings = [];
  for (const check of CHECKS) {
    const result = check(code);
    if (result) findings.push(result);
  }

  // Score = highest individual finding score (weighted max — avoid double-penalizing)
  const score = findings.length > 0
    ? Math.max(...findings.map(f => f.score))
    : 0;

  let verdict;
  if (score >= config.blockScore) verdict = 'BLOCK';
  else if (score >= config.warnScore) verdict = 'WARN';
  else verdict = 'OK';

  return { score, findings, verdict };
}

module.exports = {
  detectObfuscation,
  shannonEntropy,
  // Export individual checks for testing
  checkEval,
  checkObfuscatorIo,
  checkHighEntropy,
  checkHexEscapes,
  checkFromCharCode,
  checkBase64Exec,
  checkChildProcess,
  checkHexArray,
  checkProcessEnv,
  checkNetworkCalls,
};
