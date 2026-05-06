// np-audit-test-clean — postinstall.js
// A realistic but completely transparent postinstall script.
// This is what a legitimate package might do: check node version compatibility.

const pkg = require('./package.json');
const [major] = process.versions.node.split('.').map(Number);

if (major < 18) {
  console.warn(`[${pkg.name}] Warning: Node.js >= 18 recommended (found ${process.versions.node})`);
} else {
  console.log(`[${pkg.name}] postinstall OK -- Node.js ${process.versions.node}`);
}
