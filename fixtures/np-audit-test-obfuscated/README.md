# np-audit-test-obfuscated

Test fixture for [np-audit](https://github.com/KoblerS/np-audit).

Simulates a supply chain attack: the `postinstall` script uses real obfuscation patterns
(`_0x` variable naming, hex-encoded string arrays, `Buffer.from(..., 'base64')`,
`String.fromCharCode`) that `npa` should detect and block.

**The payload is completely harmless** — it only prints a message to stdout.
It is intentionally written to trigger `npa`'s static detectors without causing any harm.

## Expected behaviour

```bash
npa i np-audit-test-obfuscated
# → BLOCK (score >= 7) — npm install never runs
```
