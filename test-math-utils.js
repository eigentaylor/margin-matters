#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const moduleCode = fs.readFileSync(path.join(__dirname, 'docs/utils/mathUtils.js'), 'utf8');
const window = {};
eval(moduleCode);

console.log('=== Math Utils Module Tests ===\n');
function test(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  const status = pass ? '✓' : '✗';
  console.log(`${status} ${name}: ${actual} ${pass ? '===' : '!=='} ${expected}`);
  return pass;
}

let allPass = true;
console.log('--- clampMargin tests ---');
allPass &= test('clampMargin(0)', window.MathUtils.clampMargin(0), 0);
allPass &= test('clampMargin(0.5)', window.MathUtils.clampMargin(0.5), 0.5);
allPass &= test('clampMargin(-0.5)', window.MathUtils.clampMargin(-0.5), -0.5);
allPass &= test('clampMargin(2) < 1', window.MathUtils.clampMargin(2) < 1, true);
allPass &= test('clampMargin(-2) > -1', window.MathUtils.clampMargin(-2) > -1, true);

console.log('\n--- clamp01 tests ---');
allPass &= test('clamp01(0)', window.MathUtils.clamp01(0), 0);
allPass &= test('clamp01(1)', window.MathUtils.clamp01(1), 1);
allPass &= test('clamp01(-1)', window.MathUtils.clamp01(-1), 0);
allPass &= test('clamp01(2)', window.MathUtils.clamp01(2), 1);

console.log('\n--- clampByte tests ---');
allPass &= test('clampByte(128)', window.MathUtils.clampByte(128), 128);
allPass &= test('clampByte(0)', window.MathUtils.clampByte(0), 0);
allPass &= test('clampByte(255)', window.MathUtils.clampByte(255), 255);
allPass &= test('clampByte(-10)', window.MathUtils.clampByte(-10), 0);
allPass &= test('clampByte(300)', window.MathUtils.clampByte(300), 255);

console.log('\n' + '='.repeat(40));
console.log(allPass ? '✓ All tests passed!' : '✗ Some tests failed');
console.log('='.repeat(40));
process.exit(allPass ? 0 : 1);
