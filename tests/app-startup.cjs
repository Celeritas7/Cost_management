// Run with Node and Playwright installed: node tests/app-startup.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const babel = require(require.resolve('playwright').replace(/index.js$/, 'lib/transform/babelBundle.js'));
const source = fs.readFileSync(path.join(__dirname, '../js/app.jsx'), 'utf8');
// Compile the entire app, not only isolated components: any syntax error blocks startup.
const compiled = babel.babelTransform(source, 'app.jsx', false, [], []).code;
new vm.Script(compiled);
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('const JR_LINES ='), source.indexOf('// ── Phase 15a')), context);
const has = (set, name) => vm.runInContext(set + '.has(stnKey(' + JSON.stringify(name) + '))', context);
assert.equal(has('NON_JR_STATION_KEYS', 'Wakoshi'), true);
assert.equal(has('NON_JR_STATION_KEYS', 'Ikebukuro'), false);
assert.equal(has('UNPRICED_JR_STATION_KEYS', 'Nisshin'), true);
assert.equal(has('UNPRICED_JR_STATION_KEYS', 'Omiya'), false);
assert.equal(has('JR_INDEX', 'Naka-Urawa'), true);
assert.equal(has('JR_ADJ', 'Wakoshi'), false);
assert.equal(has('JR_ADJ', 'Nisshin'), false);
console.log('PASS: full app compiles; station catalog initializes; Tobu/Kawagoe manual-fare boundaries and shared JR stations preserved');
