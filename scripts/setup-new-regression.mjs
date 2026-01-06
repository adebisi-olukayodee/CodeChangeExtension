import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const CFG_PATH = path.join(ROOT, "regressions", "config.json");

/**
 * Helper script to set up a new regression test.
 * Usage: node scripts/setup-new-regression.mjs <test-id>
 * 
 * This will:
 * 1. Run the regression
 * 2. Promote to expected.json
 * 3. Run the test to verify it passes
 */
async function main() {
  const testId = process.argv[2];
  if (!testId) {
    console.error("Usage: node scripts/setup-new-regression.mjs <test-id>");
    console.error("Example: node scripts/setup-new-regression.mjs zod-v3-to-v4");
    process.exit(1);
  }

  const cfg = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
  const testConfig = cfg.repos.find(r => r.id === testId);
  
  if (!testConfig) {
    console.error(`[setup] ERROR: Test '${testId}' not found in config.json`);
    process.exit(1);
  }

  console.log(`[setup] Setting up regression test: ${testId}`);
  console.log(`[setup] Description: ${testConfig.description || 'N/A'}`);
  console.log(`[setup] URL: ${testConfig.url}`);
  console.log(`[setup] Refs: ${testConfig.beforeRef} -> ${testConfig.afterRef}`);
  console.log(`\n[setup] Step 1: Running regression...`);
  
  try {
    // Use the generic regression command with test ID as argument
    execSync(`npm run compile:regression && node scripts/run-regressions.mjs ${testId}`, { stdio: 'inherit', cwd: ROOT });
  } catch (e) {
    console.error(`[setup] ERROR: Regression failed. Fix issues before promoting.`);
    process.exit(1);
  }

  console.log(`\n[setup] Step 2: Promoting to expected.json...`);
  try {
    execSync(`npm run promote:expected ${testId}`, { stdio: 'inherit', cwd: ROOT });
  } catch (e) {
    console.error(`[setup] ERROR: Failed to promote expected.json`);
    process.exit(1);
  }

  console.log(`\n[setup] Step 3: Verifying test passes...`);
  try {
    execSync(`node regressions/test-runner.mjs ${testId}`, { stdio: 'inherit', cwd: ROOT });
    console.log(`\n[setup] ✓ Test setup complete!`);
    console.log(`[setup] The test will now run automatically in CI.`);
    console.log(`[setup] To enable this test, remove "skip": true from config.json`);
  } catch (e) {
    console.error(`[setup] ERROR: Test verification failed. Check expected.json.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[setup] Fatal error:", err);
  process.exit(1);
});

