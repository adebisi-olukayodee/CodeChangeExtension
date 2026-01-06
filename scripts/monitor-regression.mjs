import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const testId = process.argv[2] || "zod-v3-to-v4";
const OUT_DIR = path.join(ROOT, "regressions", "out");
const WORKSPACE = path.join(ROOT, ".regression-workspace", testId);
const actualPath = path.join(OUT_DIR, `${testId}.actual.json`);

console.log(`\n[monitor] Monitoring regression: ${testId}\n`);

// Check repository status
if (fs.existsSync(WORKSPACE)) {
  console.log(`✓ Repository cloned: ${WORKSPACE}`);
  try {
    const gitHead = fs.readFileSync(path.join(WORKSPACE, ".git", "HEAD"), "utf8").trim();
    console.log(`  Current HEAD: ${gitHead}`);
  } catch (e) {
    // Ignore
  }
} else {
  console.log(`⏳ Repository not cloned yet`);
}

// Check output file
if (fs.existsSync(actualPath)) {
  const stats = fs.statSync(actualPath);
  const size = stats.size;
  const modified = stats.mtime;
  console.log(`✓ Output file exists: ${actualPath}`);
  console.log(`  Size: ${(size / 1024).toFixed(2)} KB`);
  console.log(`  Last modified: ${modified.toLocaleString()}`);
  
  try {
    const data = JSON.parse(fs.readFileSync(actualPath, "utf8"));
    if (data.beforeSha && data.afterSha) {
      console.log(`✓ Regression completed!`);
      console.log(`  Before: ${data.beforeSha.substring(0, 7)}`);
      console.log(`  After:  ${data.afterSha.substring(0, 7)}`);
      if (data.exportsDiff) {
        console.log(`  Exports: +${data.exportsDiff.added?.length || 0} -${data.exportsDiff.removed?.length || 0}`);
      }
      if (data.apiDiff) {
        console.log(`  API: +${data.apiDiff.added?.length || 0} -${data.apiDiff.removed?.length || 0} ~${data.apiDiff.modified?.length || 0}`);
      }
    } else if (data.error) {
      console.log(`✗ Regression failed: ${data.error}`);
    } else {
      console.log(`⏳ Regression in progress...`);
    }
  } catch (e) {
    console.log(`⏳ Output file exists but not valid JSON yet (still writing)`);
  }
} else {
  console.log(`⏳ Output file not created yet`);
}

// Check expected file
const expectedPath = path.join(ROOT, "regressions", testId, "expected.json");
if (fs.existsSync(expectedPath)) {
  console.log(`✓ Expected file exists: ${expectedPath}`);
} else {
  console.log(`⏳ Expected file not created yet (will be created after promotion)`);
}

console.log(`\n[monitor] Run this command again to refresh status\n`);









