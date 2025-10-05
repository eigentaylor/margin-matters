#!/usr/bin/env node

/**
 * Dependency analyzer for tester.js and election-night.js
 * Uses jscodeshift to parse and analyze function dependencies
 */

const jscodeshift = require('jscodeshift');
const fs = require('fs');
const path = require('path');

const testerPath = path.join(__dirname, 'docs/tester.js');
const electionNightPath = path.join(__dirname, 'docs/election-night.js');

function analyzeFunctionCalls(filePath, fileName) {
  const source = fs.readFileSync(filePath, 'utf8');
  const ast = jscodeshift(source);
  
  const functionDefs = new Set();
  const functionCalls = new Set();
  
  // Find all function definitions
  ast.find(jscodeshift.FunctionDeclaration).forEach(path => {
    if (path.node.id && path.node.id.name) {
      functionDefs.add(path.node.id.name);
    }
  });
  
  // Find all function expressions assigned to variables
  ast.find(jscodeshift.VariableDeclarator).forEach(path => {
    if (path.node.init && 
        (path.node.init.type === 'FunctionExpression' || 
         path.node.init.type === 'ArrowFunctionExpression')) {
      if (path.node.id && path.node.id.name) {
        functionDefs.add(path.node.id.name);
      }
    }
  });
  
  // Find all function calls
  ast.find(jscodeshift.CallExpression).forEach(path => {
    if (path.node.callee.type === 'Identifier') {
      functionCalls.add(path.node.callee.name);
    }
  });
  
  return {
    fileName,
    functionDefs: Array.from(functionDefs),
    functionCalls: Array.from(functionCalls),
    definedCount: functionDefs.size,
    calledCount: functionCalls.size
  };
}

console.log('=== Dependency Analysis ===\n');

const testerAnalysis = analyzeFunctionCalls(testerPath, 'tester.js');
const electionNightAnalysis = analyzeFunctionCalls(electionNightPath, 'election-night.js');

console.log(`${testerAnalysis.fileName}:`);
console.log(`  Functions defined: ${testerAnalysis.definedCount}`);
console.log(`  Function calls: ${testerAnalysis.calledCount}`);
console.log('');

console.log(`${electionNightAnalysis.fileName}:`);
console.log(`  Functions defined: ${electionNightAnalysis.definedCount}`);
console.log(`  Function calls: ${electionNightAnalysis.calledCount}`);
console.log('');

// Find common function names (candidates for extraction)
const testerFuncs = new Set(testerAnalysis.functionDefs);
const electionNightFuncs = new Set(electionNightAnalysis.functionDefs);

const commonNames = Array.from(testerFuncs).filter(f => electionNightFuncs.has(f));

console.log('=== Common Function Names (Duplication Candidates) ===');
console.log(commonNames.length > 0 ? commonNames.join(', ') : 'None found');
console.log('');

// Find functions called but not defined (potential shared dependencies)
const testerExternal = Array.from(new Set(
  testerAnalysis.functionCalls.filter(c => !testerFuncs.has(c))
));

const electionNightExternal = Array.from(new Set(
  electionNightAnalysis.functionCalls.filter(c => !electionNightFuncs.has(c))
));

console.log('=== External Dependencies (first 20) ===');
console.log('tester.js:', testerExternal.slice(0, 20).join(', '));
console.log('election-night.js:', electionNightExternal.slice(0, 20).join(', '));
console.log('');

// Specific function analysis
const targetFunctions = [
  'clampMargin',
  'clamp01', 
  'clampByte',
  'clampShare',
  'allocateProportionalEVs',
  'formatUnitTooltip',
  'showMapTip',
  'hideMapTip',
  'formatLeader',
  'formatMarginText'
];

console.log('=== Target Functions for Extraction ===');
targetFunctions.forEach(fn => {
  const inTester = testerFuncs.has(fn) || testerAnalysis.functionCalls.includes(fn);
  const inElection = electionNightFuncs.has(fn) || electionNightAnalysis.functionCalls.includes(fn);
  const definedTester = testerFuncs.has(fn);
  const definedElection = electionNightFuncs.has(fn);
  
  if (inTester || inElection) {
    const status = [];
    if (definedTester) status.push('defined in tester.js');
    if (definedElection) status.push('defined in election-night.js');
    if (!definedTester && inTester) status.push('used in tester.js');
    if (!definedElection && inElection) status.push('used in election-night.js');
    
    console.log(`  ${fn}: ${status.join(', ')}`);
  }
});
