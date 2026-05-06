'use strict';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_YELLOW = '\x1b[43m';

const NO_COLOR = !process.stdout.isTTY || process.env.NO_COLOR || process.env.CI;

function c(code, text) {
  if (NO_COLOR) return text;
  return `${code}${text}${RESET}`;
}

function bold(text) { return c(BOLD, text); }
function dim(text) { return c(DIM, text); }
function red(text) { return c(RED, text); }
function green(text) { return c(GREEN, text); }
function yellow(text) { return c(YELLOW, text); }
function blue(text) { return c(BLUE, text); }
function cyan(text) { return c(CYAN, text); }
function white(text) { return c(WHITE, text); }

function error(msg) {
  process.stderr.write(red(`✖ ${msg}`) + '\n');
}

function warn(msg) {
  process.stderr.write(yellow(`⚠ ${msg}`) + '\n');
}

function info(msg) {
  process.stdout.write(cyan(`ℹ ${msg}`) + '\n');
}

function success(msg) {
  process.stdout.write(green(`✔ ${msg}`) + '\n');
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

function verdictBadge(verdict) {
  if (NO_COLOR) return `[${verdict}]`;
  if (verdict === 'BLOCK') return `${BG_RED}${BOLD} BLOCK ${RESET}`;
  if (verdict === 'WARN')  return `${BG_YELLOW}\x1b[30m WARN  ${RESET}`;
  return `${GREEN} OK    ${RESET}`;
}

function printScanHeader() {
  log('');
  log(bold(cyan('npa') + ' — npm package auditor'));
  log(dim('Static obfuscation detection for install scripts'));
  log(dim('─'.repeat(60)));
  log('');
}

function printPackageResult(pkg, result) {
  const badge = verdictBadge(result.verdict);
  const name = bold(`${pkg.name}@${pkg.version}`);
  const score = result.score > 0 ? dim(` (score: ${result.score})`) : '';
  log(`  ${badge} ${name}${score}`);
  for (const finding of result.findings) {
    log(`         ${dim('└')} ${yellow(finding.name)}: ${dim(finding.detail)}`);
  }
}

function printSummary(results) {
  const blocked = results.filter(r => r.verdict === 'BLOCK').length;
  const warned  = results.filter(r => r.verdict === 'WARN').length;
  const ok      = results.filter(r => r.verdict === 'OK').length;

  log('');
  log(dim('─'.repeat(60)));
  log(`  ${green(String(ok))} clean   ${yellow(String(warned))} warnings   ${red(String(blocked))} blocked`);
  log('');
}

module.exports = {
  bold, dim, red, green, yellow, blue, cyan, white,
  error, warn, info, success, log,
  verdictBadge, printScanHeader, printPackageResult, printSummary,
  RESET, BOLD, DIM, RED, GREEN, YELLOW, BLUE, CYAN,
};
