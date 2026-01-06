/**
 * Build script for regression runner.
 * Compiles the regression runner to dist/ at repo root.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

console.log('Building regression runner...');

// Compile TypeScript (outputs directly to dist/ at repo root)
console.log('Compiling TypeScript...');
execSync('npx tsc -p tsconfig.regression.json', { cwd: ROOT, stdio: 'inherit' });

// Verify output
const distFile = path.join(ROOT, 'dist', 'regression-runner.js');
if (fs.existsSync(distFile)) {
    console.log('✓ regression-runner.js built successfully');
    console.log(`  Location: ${distFile}`);
} else {
    console.error('✗ regression-runner.js not found after build!');
    process.exit(1);
}

console.log('Build complete!');

