'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_CODE_SIZE = 500000; // 500KB - chunk larger files
const CHUNK_STRIDE  = 250000; // 50% overlap between adjacent chunks

// ─── Individual detection checks ─────────────────────────────────────────────

/**
 * Detect eval / dynamic code execution, including common indirect-eval tricks.
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
    // Indirect eval — (0, eval)(...) is the canonical sloppy-mode trick
    /\(\s*0\s*,\s*eval\s*\)\s*\(/,
    // Bracket access on a global object: global['eval'], globalThis["eval"], window['eval'],
    // and the same with the string built from concatenation: globalThis['ev'+'al']
    /(?:global|globalThis|window|self|this)\s*\[\s*['"`](?:eval|Function)['"`]\s*\]\s*\(/,
    /(?:global|globalThis|window|self|this)\s*\[\s*['"`][^'"`]*['"`](?:\s*\+\s*['"`][^'"`]*['"`]){1,}\s*\]\s*\(/,
    // Function constructor accessed via prototype: ({}).constructor.constructor("...")()
    /\.constructor\s*\.\s*constructor\s*\(/,
    // setTimeout/setInterval with a string argument is a legacy eval vector
    /\b(?:setTimeout|setInterval)\s*\(\s*['"`]/,
    // require('vm') hint when combined with run* — covered above by vm.*, but catch the import too
    /require\s*\(\s*['"]vm['"]\s*\)/,
  ];
  const matched = patterns.filter(p => p.test(code));
  if (matched.length === 0) return null;
  return { name: 'eval/dynamic-exec', score: 8, detail: `eval-like call found (${matched.length} pattern(s))` };
}

/**
 * Detect obfuscator.io signature: _0x variable naming.
 * Score scales with density of obfuscation.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkObfuscatorIo(code) {
  const matches = code.match(/_0x[0-9a-fA-F]+/g) || [];
  if (matches.length < 3) return null;
  // Scale score: 3-10 = 9, 11-50 = 15, 51-200 = 30, 201-1000 = 50, 1000+ = 80
  let score = 9;
  if (matches.length > 1000) score = 80;
  else if (matches.length > 200) score = 50;
  else if (matches.length > 50) score = 30;
  else if (matches.length > 10) score = 15;
  return { name: 'obfuscator.io', score, detail: `${matches.length} _0x identifiers found` };
}

/**
 * Detect high-entropy strings (likely encoded/encrypted payloads).
 * Uses indexOf-based extraction to avoid regex stack overflow on large files.
 * Also detects concatenation chains used to defeat per-literal entropy checks.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkHighEntropy(code) {
  let maxEntropy = 0;
  let worst = '';
  const minLen = 50;

  // Simple string extraction without complex regex
  for (const quote of ['"', "'", '`']) {
    let pos = 0;
    while (pos < code.length) {
      const start = code.indexOf(quote, pos);
      if (start === -1) break;

      // Find end quote (skip escaped quotes)
      let end = start + 1;
      while (end < code.length) {
        if (code[end] === '\\') { end += 2; continue; }
        if (code[end] === quote) break;
        end++;
      }

      if (end < code.length && end - start - 1 >= minLen) {
        const s = code.slice(start + 1, end);
        const e = shannonEntropy(s);
        if (e > maxEntropy) { maxEntropy = e; worst = s.slice(0, 40); }
      }
      pos = end + 1;
    }
  }

  if (maxEntropy >= 4.5) {
    return {
      name: 'high-entropy-string',
      score: 6,
      detail: `Entropy ${maxEntropy.toFixed(2)} in string "${worst}…"`,
    };
  }

  // Concatenation chain: many small string literals joined with `+`.
  // Captures payloads split into <50-char chunks to dodge the per-literal entropy check.
  // We measure the entropy of the *aggregated* literals.
  const concatChainRe = /(?:['"`][^'"`\n]{0,40}['"`]\s*\+\s*){5,}['"`][^'"`\n]{0,40}['"`]/g;
  let m;
  let bestChain = '';
  while ((m = concatChainRe.exec(code)) !== null) {
    const literals = m[0].match(/['"`]([^'"`\n]{0,40})['"`]/g) || [];
    const joined = literals.map(l => l.slice(1, -1)).join('');
    if (joined.length >= 40) {
      const e = shannonEntropy(joined);
      if (e > maxEntropy) { maxEntropy = e; bestChain = joined.slice(0, 40); }
    }
  }

  if (maxEntropy >= 4.5) {
    return {
      name: 'high-entropy-string',
      score: 6,
      detail: `Entropy ${maxEntropy.toFixed(2)} in concatenated literals "${bestChain}…"`,
    };
  }

  return null;
}

/**
 * Detect dense \xNN and \uXXXX escape sequences.
 * Score scales with volume; \u and \x are summed.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkHexEscapes(code) {
  const hexMatches     = (code.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
  const unicodeMatches = (code.match(/\\u[0-9a-fA-F]{4}/g) || []).length
                       + (code.match(/\\u\{[0-9a-fA-F]+\}/g) || []).length;
  const total = hexMatches + unicodeMatches;
  if (total < 10) return null;
  // Scale: 10-50 = 5, 51-200 = 15, 201-1000 = 30, 1000+ = 50
  let score = 5;
  if (total > 1000) score = 50;
  else if (total > 200) score = 30;
  else if (total > 50) score = 15;
  const detail = unicodeMatches > 0
    ? `${hexMatches} \\xNN + ${unicodeMatches} \\uXXXX escapes found`
    : `${hexMatches} \\xNN hex escapes found`;
  return { name: 'hex-escape-density', score, detail };
}

/**
 * Detect String.fromCharCode (and its aliases) with many numeric arguments,
 * and large arrays of character codes that are typically reassembled into strings.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkFromCharCode(code) {
  // Direct (or property-access) call: String.fromCharCode(...) or anyObj.fromCharCode(...)
  let maxArgs = 0;
  const direct = /(?:String|[\w$]+)\.fromCharCode\s*\(([^)]+)\)/g;
  let match;
  while ((match = direct.exec(code)) !== null) {
    const args = match[1].split(',').filter(a => /^\s*\d+\s*$/.test(a));
    if (args.length > maxArgs) maxArgs = args.length;
  }

  // Decimal char-code arrays of length >= 8 that look like ASCII text
  // e.g. [101,118,97,108] -> "eval"
  const arrRe = /\[\s*((?:\d{1,3}\s*,\s*){7,}\d{1,3})\s*\]/g;
  let arrMatch;
  let maxArr = 0;
  while ((arrMatch = arrRe.exec(code)) !== null) {
    const nums = arrMatch[1].split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !Number.isNaN(n));
    // ASCII printable range — typical for char-code payloads
    const printable = nums.filter(n => n >= 32 && n <= 126).length;
    if (printable / nums.length >= 0.9 && nums.length > maxArr) maxArr = nums.length;
  }

  if (maxArgs >= 5) {
    return { name: 'fromCharCode', score: 7, detail: `fromCharCode with ${maxArgs} numeric args` };
  }
  if (maxArr >= 16) {
    // Treat large printable-ascii decimal arrays as equivalent to fromCharCode obfuscation
    return { name: 'fromCharCode', score: 7, detail: `decimal char-code array of length ${maxArr}` };
  }
  return null;
}

/**
 * Detect base64 / hex decoding combined with eval-like execution.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkBase64Exec(code) {
  const hasBase64 = /atob\s*\(|Buffer\.from\s*\([^)]*,\s*['"]base64['"]\)/.test(code);
  const hasHexDecode = /Buffer\.from\s*\([^)]*,\s*['"]hex['"]\)/.test(code);
  const hasExec   = /\beval\s*\(|new\s+Function\s*\(|\.exec\s*\(|\(\s*0\s*,\s*eval\s*\)\s*\(/.test(code);
  if (!hasBase64 && !hasHexDecode) return null;
  if (!hasExec) {
    const kind = hasBase64 ? 'Base64' : 'Hex';
    return { name: 'encoded-decode', score: 3, detail: `${kind} decode found — verify usage` };
  }
  const kind = hasBase64 ? 'Base64' : 'Hex';
  return { name: 'encoded-decode+exec', score: 8, detail: `${kind} decode with code execution found` };
}

/**
 * Detect child_process / shell execution patterns, including string-concatenated
 * `require('child' + '_process')` and access via require.call etc.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkChildProcess(code) {
  const patterns = [
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    // node:-prefixed import
    /require\s*\(\s*['"]node:child_process['"]\s*\)/,
    // String-concatenation bypass: require('child'+'_process'), require(\`child${''}_process\`)
    /require\s*\(\s*['"`][^'"`]*['"`](?:\s*\+\s*['"`][^'"`]*['"`])+\s*\)/,
    // Dynamic require with computed key — flag for review
    /require\s*\(\s*[a-zA-Z_$][\w$]*\s*\[/,
    /\bexec\s*\(/,
    /\bspawn\s*\(/,
    /\bexecSync\s*\(/,
    /\bspawnSync\s*\(/,
    /\bexecFile\s*\(/,
    /\bexecFileSync\s*\(/,
    /\bfork\s*\(/,
    // Worker threads can host eval-equivalent execution
    /require\s*\(\s*['"]worker_threads['"]\s*\)/,
    /new\s+Worker\s*\(/,
  ];
  const matched = patterns.filter(p => p.test(code));
  if (matched.length === 0) return null;
  return { name: 'child-process', score: 5, detail: `Shell/process execution found (${matched.length} pattern(s))` };
}

/**
 * Detect large hex literal arrays (common in minified obfuscated code).
 * Score scales with volume.
 * @param {string} code
 * @returns {Finding|null}
 */
function checkHexArray(code) {
  // Count 0x1234-style literals
  const hexLiterals = (code.match(/\b0x[0-9a-fA-F]+\b/g) || []).length;
  if (hexLiterals < 20) return null;
  // Scale: 20-100 = 7, 101-500 = 20, 501-2000 = 40, 2000+ = 60
  let score = 7;
  if (hexLiterals > 2000) score = 60;
  else if (hexLiterals > 500) score = 40;
  else if (hexLiterals > 100) score = 20;
  return { name: 'hex-array', score, detail: `${hexLiterals} hex literal values found` };
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
    /require\s*\(\s*['"]tls['"]\s*\)/,
    /require\s*\(\s*['"]dgram['"]\s*\)/,
    /require\s*\(\s*['"]http2['"]\s*\)/,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\.request\s*\(/,
    // node:-prefixed imports (Node 16+)
    /require\s*\(\s*['"]node:(?:https?|net|dns|tls|dgram|http2)['"]\s*\)/,
    // Dynamic import of these modules
    /import\s*\(\s*['"](?:node:)?(?:https?|net|dns|tls|dgram|http2)['"]\s*\)/,
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
 * For large files, uses a sliding window (50% overlap) so payloads cannot
 * hide in the gaps between fixed start/middle/end chunks.
 * @param {string} code
 * @param {object} config  { blockScore, warnScore }
 * @returns {{ score: number, findings: Finding[], verdict: 'BLOCK'|'WARN'|'OK' }}
 */
function detectObfuscation(code, config = { blockScore: 50, warnScore: 20 }) {
  if (!code || typeof code !== 'string') {
    return { score: 0, findings: [], verdict: 'OK' };
  }

  // For large files, slide a window across the entire content. With a 500KB
  // window and 250KB stride, every byte appears in at least one window — so a
  // payload at any offset is guaranteed to be analyzed in a single contiguous
  // chunk.
  const chunks = [];
  if (code.length > MAX_CODE_SIZE) {
    let start = 0;
    while (start < code.length) {
      chunks.push(code.slice(start, start + MAX_CODE_SIZE));
      if (start + MAX_CODE_SIZE >= code.length) break;
      start += CHUNK_STRIDE;
    }
  } else {
    chunks.push(code);
  }

  const allFindings = new Map(); // Dedupe by name, keep highest score

  for (const chunk of chunks) {
    for (const check of CHECKS) {
      const result = check(chunk);
      if (result) {
        const existing = allFindings.get(result.name);
        if (!existing || result.score > existing.score) {
          allFindings.set(result.name, result);
        }
      }
    }
  }

  const findings = Array.from(allFindings.values());

  // Score = highest individual finding score
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
