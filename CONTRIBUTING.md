# Contributing

## Development

```bash
git clone https://github.com/KoblerS/np-audit.git
cd np-audit
npm test          # run all unit + E2E tests
npm link          # install npa globally from source
```

No build step, no transpilation — plain Node.js >= 18.

## Project structure

```
src/
├── cli.js              # Entry point, arg parsing
├── commands/           # CLI subcommands (scan, install, ci, config, alias)
├── core/
│   ├── detector.js     # Orchestrates marshallers, chunking for large files
│   ├── scanner.js      # Package resolution, tarball fetching, result aggregation
│   └── requireWalker.js  # require()/import graph traversal
├── marshallers/        # Detection modules (auto-discovered)
│   ├── base.js         # Marshaller base class
│   ├── index.js        # Registry / loader
│   └── *.js            # Individual marshallers
└── utils/              # Shared utilities (config, fetcher, output, etc.)
```

## Marshaller architecture

Each marshaller extends the `Marshaller` base class and implements one or both methods:

- `check(code)` — synchronous static code analysis, returns `Finding | null`
- `checkPackage(pkg, config)` — async package-level checks (APIs), returns `Promise<Finding | null>`

A `Finding` has the shape:

```js
{ name: 'marshaller-name', score: 5, detail: 'Human-readable explanation' }
```

### Writing a custom marshaller

```js
'use strict';

const { Marshaller } = require('./base');

class MyMarshaller extends Marshaller {
  constructor() {
    super('my-detector', 'Description of what it detects');
  }

  check(code) {
    // Return null if nothing suspicious
    const matches = code.match(/suspiciousPattern/g) || [];
    if (matches.length === 0) return null;

    return {
      name: this.name,
      score: 5,
      detail: `${matches.length} suspicious pattern(s) found`,
    };
  }
}

module.exports = new MyMarshaller();
```

Place the file in `src/marshallers/` — it will be auto-discovered by the registry.

Files excluded from auto-discovery: `index.js`, `base.js`, `cve.js` (package marshallers are registered separately).

### Scoring guidelines

| Score range | Meaning |
| ----------- | ------- |
| 1–4 | Low signal — informational, does not block |
| 5–9 | Medium signal — triggers WARN by default |
| 10–49 | High signal — suspicious but not definitive |
| 50+ | Critical — triggers DANGER/BLOCK |

Scores should scale with the density/severity of findings. A single `process.env` access is score 3; 2000+ `_0x` identifiers is score 80.

## Running tests

```bash
node test/index.js        # Full suite (unit + E2E)
node test/unit/cve.test.js  # Single test file
```

Tests use Node's built-in `assert` module — no external test framework.

## CI

The CI matrix runs on Ubuntu, macOS, and Windows across Node 18/20/22/24. All tests must pass on all platforms before merging.
