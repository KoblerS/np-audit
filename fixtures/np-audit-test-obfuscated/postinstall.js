// np-audit-test-obfuscated — postinstall.js
// This file simulates a real supply chain attack obfuscation pattern.
// The actual payload is completely harmless — it only prints a message.
// It is intentionally written to trigger np-audit's detection heuristics.

// Obfuscator.io-style: _0x variable naming + hex-encoded string array
var _0x1a2b = ['\x6e\x70\x2d\x61\x75\x64\x69\x74', '\x74\x65\x73\x74', '\x66\x69\x78\x74\x75\x72\x65'];
var _0x3c4d = function(_0x5e6f) { return _0x1a2b[_0x5e6f]; };

// Base64-encoded payload (decodes to the harmless message below)
var _0x7g8h = Buffer.from('Y29uc29sZS5sb2coJ1tucC1hdWRpdC10ZXN0LW9iZnVzY2F0ZWRdIFBPU1RJTlNUQUxMIFJBTiAtIHRoaXMgaXMgYSBoYXJtbGVzcyB0ZXN0IGZpeHR1cmUgZm9yIG5wLWF1ZGl0Jyk=', 'base64').toString();

// String.fromCharCode reconstruction (spells out "eval")
var _0x9i0j = String.fromCharCode(101, 118, 97, 108);

// THIS DOES NOT ACTUALLY EVAL ANYTHING — the variable is never called as a function.
// The patterns above are sufficient to trigger np-audit's static detectors.

// Actual harmless payload:
console.log('[np-audit-test-obfuscated] POSTINSTALL RAN — this is a harmless test fixture for np-audit');
console.log('[np-audit-test-obfuscated] In a real attack, this script would be malicious.');
console.log('[np-audit-test-obfuscated] np-audit should have blocked this before it ran.');
