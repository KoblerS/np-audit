# np-audit-test-clean

Test fixture for [np-audit](https://github.com/KoblerS/np-audit).

A realistic but fully transparent `postinstall` script that checks the Node.js version.
`npa` should allow this through without warnings.

## Expected behaviour

```bash
npa i np-audit-test-clean
# → OK — npm install proceeds normally
```
