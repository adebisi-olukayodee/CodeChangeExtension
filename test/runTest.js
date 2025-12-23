// Load vscode mock before anything else
require('./vscode-mock');

const path = require('path');
const Mocha = require('mocha');
const glob = require('glob');

// Create a new Mocha instance
const mocha = new Mocha({
    ui: 'bdd',
    timeout: 10000,
    color: true
});

// Find all test files in the compiled output (excluding fixtures)
const testRoot = path.join(__dirname, '..', 'out', 'test');
const testFiles = glob.sync('**/*.test.js', { cwd: testRoot, absolute: true })
    .filter(file => !file.includes('fixtures')); // Exclude fixture test files

// Add test files to Mocha
testFiles.forEach(file => {
    mocha.addFile(file);
});

// Run the tests
mocha.run(failures => {
    process.exit(failures ? 1 : 0);
});

