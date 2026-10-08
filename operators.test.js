#!/usr/bin/env node
'use strict';
// Tests for operators.js: who runs each vault. Run: node operators.test.js
const assert = require('assert');
const O = require('./operators.js');
let passed = 0;
const test = (name, fn) => { try { fn(); console.log('  PASS  ' + name); passed++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; } };

test('by name', () => {
  assert.strictEqual(O.byName('TAU cbETH Dynamic Looping').name, 'Tau Labs');
  assert.strictEqual(O.byName('TESS USDC Lending Optimiser').name, 'Tesseract');
  assert.strictEqual(O.byName('Tesseract USDC Vault Share').name, 'Tesseract');
  assert.strictEqual(O.byName('Harvest WETH vault Base').name, 'Harvest');
  assert.strictEqual(O.byName('Base ETH Lending Optimizer'), null);   // Clearstar's, by its atomist, not IPOR by its name
  assert.strictEqual(O.byName('yoUSD Loooper').name, 'Yo');
  assert.strictEqual(O.byName('К3 Capital ETH Maxi').name, 'K3 Capital');   // a Cyrillic К
  assert.strictEqual(O.byName('Taurus Vault'), null);
  assert.strictEqual(O.byName('Apple Carry Trade'), null);
  // by its share symbol, where the name says nothing
  assert.strictEqual(O.byName('USDC Lending Optimizer Tezos', 'TAUUSDCTZS').name, 'Tau Labs');
  assert.strictEqual(O.byName('cbBTC Carry', '$TAUSIUSDcbBTC').name, 'Tau Labs');
  assert.strictEqual(O.byName('Apple Carry Trade', 'AAPLCT'), null);
});
test('a vault named for no one takes its owner\'s other vaults\' operator, else IPOR where its alpha runs it', () => {
  const m = O.assign([
    { address: 'a', name: 'TAU Lending Optimizer', owner: '0xd556' },
    { address: 'b', name: 'Prime HELOC Loop', owner: '0xd556' },
    { address: 'c', name: 'rETH Liquity LP Carry', owner: '0x1d46', iporAlpha: true },
    { address: 'd', name: 'Apple Carry Trade' },
    { address: 'e', name: 'Base cbETH Loooper', owner: '0xb3cf59a5f12ca319861376c5e63eef4790a42b44', iporAlpha: true },
    { address: 'f', name: 'Apple Carry Trade', owner: '0xd556a9fa4dd83ade79b89f4a431c57169d00d4a6' },
  ]);
  assert.deepStrictEqual(m, { a: 'tau', b: 'tau', c: 'ipor', e: 'clearstar', f: 'tau' });
});
test('every operator\'s logo is on disk', () => {
  const fs = require('fs');
  for (const o of O.OPERATORS) if (o.logo) assert.ok(fs.existsSync(__dirname + '/icons/operators/' + o.logo), o.logo);
});
console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
