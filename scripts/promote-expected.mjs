import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REGRESSIONS_DIR = path.join(ROOT, "regressions");
const OUT_DIR = path.join(ROOT, "regressions", "out");

/**
 * Extracts detailed shape information for verification
 */
function extractDetailedShape(shape) {
  if (!shape) return null;
  
  const detailed = {};
  
  if (shape.kind === 'function') {
    detailed.typeParameters = shape.typeParameters;
    detailed.overloads = shape.overloads?.length || 0;
    // Extract first overload details for verification
    if (shape.overloads && shape.overloads.length > 0) {
      const firstOverload = shape.overloads[0];
      detailed.overloadDetails = [{
        parameters: firstOverload.parameters?.map(p => ({
          name: p.name,
          type: p.type,
          optional: p.optional,
        })) || [],
        returnType: firstOverload.returnType,
      }];
    }
  } else if (shape.kind === 'class') {
    detailed.typeParameters = shape.typeParameters;
    detailed.memberCount = shape.members?.length || 0;
    detailed.hasConstructor = !!shape.constructor;
    // Extract key members for verification (first 5 public members)
    if (shape.members) {
      const publicMembers = shape.members
        .filter(m => m.visibility === 'public')
        .slice(0, 5)
        .map(m => ({
          name: m.name,
          kind: m.kind,
          visibility: m.visibility,
        }));
      if (publicMembers.length > 0) {
        detailed.members = publicMembers;
      }
    }
  } else if (shape.kind === 'type' || shape.kind === 'interface') {
    detailed.typeParameters = shape.typeParameters;
    detailed.propertyCount = shape.properties?.length || 0;
    // Extract key properties for verification (first 5)
    if (shape.properties && shape.properties.length > 0) {
      detailed.properties = shape.properties.slice(0, 5).map(p => ({
        name: p.name,
        type: p.type,
        optional: p.optional,
      }));
    }
  } else if (shape.kind === 'enum') {
    detailed.memberCount = shape.members?.length || 0;
    // Extract key members for verification (first 5)
    if (shape.members && shape.members.length > 0) {
      detailed.members = shape.members.slice(0, 5).map(m => ({
        name: m.name,
      }));
    }
  } else if (shape.kind === 'variable') {
    detailed.type = shape.type;
  }
  
  return detailed;
}

/**
 * Promotes actual.json to expected.json for a regression test.
 * Use this when you've verified the actual output is correct.
 */
async function main() {
  const testName = process.argv[2];
  if (!testName) {
    console.error("Usage: node scripts/promote-expected.mjs <test-name>");
    console.error("Example: node scripts/promote-expected.mjs date-fns-v2-to-v3");
    process.exit(1);
  }

  const testDir = path.join(REGRESSIONS_DIR, testName);
  const actualPath = path.join(OUT_DIR, `${testName}.actual.json`);

  if (!fs.existsSync(actualPath)) {
    console.error(`[promote] ERROR: Actual output not found: ${actualPath}`);
    console.error(`[promote] Run the regression first: npm run regression:${testName}`);
    process.exit(1);
  }

  const actual = JSON.parse(fs.readFileSync(actualPath, "utf8"));

  // Check if regression actually ran (has beforeSha/afterSha)
  if (!actual.beforeSha || !actual.afterSha) {
    console.error(`[promote] ERROR: Regression test did not run successfully.`);
    console.error(`[promote] Missing beforeSha or afterSha in actual.json`);
    console.error(`[promote] Make sure to run the regression first: npm run regression:${testName}`);
    process.exit(1);
  }

  // Guardrail: Prevent promoting broken expected.json files
  const beforeStats = actual.before?.exportStats || actual.exportStats;
  const afterStats = actual.after?.exportStats || actual.exportStats;
  
  if (beforeStats) {
    if (beforeStats.exportsTotal === 0 && beforeStats.reexportGroupsUnresolved > 0) {
      console.error(`[promote] ERROR: Cannot promote - before state has 0 exports but ${beforeStats.reexportGroupsUnresolved} unresolved re-exports`);
      console.error(`[promote] This indicates re-export resolution is failing. Fix re-export resolution before promoting.`);
      process.exit(1);
    }
  }
  
  if (afterStats) {
    if (afterStats.exportsTotal === 0 && afterStats.reexportGroupsUnresolved > 0) {
      console.error(`[promote] ERROR: Cannot promote - after state has 0 exports but ${afterStats.reexportGroupsUnresolved} unresolved re-exports`);
      console.error(`[promote] This indicates re-export resolution is failing. Fix re-export resolution before promoting.`);
      process.exit(1);
    }
  }
  
  // Check API snapshot shapes if in api-snapshot mode
  if (actual.apiSnapshotAfter) {
    const shapesBuilt = Object.keys(actual.apiSnapshotAfter.exports || {}).length;
    if (shapesBuilt === 0 && afterStats && afterStats.exportsTotal === 0) {
      console.error(`[promote] ERROR: Cannot promote - 0 API shapes built and 0 exports detected`);
      console.error(`[promote] This indicates the analyzer is not working correctly.`);
      process.exit(1);
    }
  }

  // Extract expected structure
  const expected = {
    metadata: {
      beforeSha: actual.beforeSha,
      afterSha: actual.afterSha,
      testName,
      description: `${testName} regression test`,
      pinnedRefs: {
        before: actual.beforeSha.substring(0, 7),
        after: actual.afterSha.substring(0, 7),
      },
    },
    counts: {
      exportsDiff: {
        added: actual.exportsDiff?.added?.length || 0,
        removed: actual.exportsDiff?.removed?.length || 0,
        changed: actual.exportsDiff?.changed?.length || 0,
      },
      apiDiff: {
        added: actual.apiDiff?.added?.length || 0,
        removed: actual.apiDiff?.removed?.length || 0,
        modified: actual.apiDiff?.modified?.length || 0,
        renamed: actual.apiDiff?.renamed?.length || 0,
      },
    },
    regressionChecks: actual.regressionChecks || {},
    sampleSymbols: {
      removed: (actual.apiDiff?.removed || []).slice(0, 15).map((r) => {
        const symbol = {
          name: r.identity.split("|")[0],
          kind: r.shape?.kind,
          shapeName: r.shape?.name,
        };
        // Add detailed shape information
        if (r.shape) {
          symbol.detailedShape = extractDetailedShape(r.shape);
        }
        return symbol;
      }),
      added: (actual.apiDiff?.added || []).slice(0, 15).map((a) => {
        const symbol = {
          name: a.identity.split("|")[0],
          kind: a.shape?.kind,
          shapeName: a.shape?.name,
        };
        // Add detailed shape information
        if (a.shape) {
          symbol.detailedShape = extractDetailedShape(a.shape);
        }
        return symbol;
      }),
    },
    assertions: {
      minShapesBuilt: Math.floor(
        (Object.keys(actual.apiSnapshotAfter?.exports || {}).length * 0.8)
      ),
      maxShapesBuilt: Math.ceil(
        (Object.keys(actual.apiSnapshotAfter?.exports || {}).length * 1.2)
      ),
      mustHaveRemovedExports: (actual.apiDiff?.removed?.length || 0) > 0,
      mustHaveAddedExports: (actual.apiDiff?.added?.length || 0) > 0,
    },
  };

  fs.mkdirSync(testDir, { recursive: true });
  const expectedPath = path.join(testDir, "expected.json");
  fs.writeFileSync(expectedPath, JSON.stringify(expected, null, 2));
  console.log(`[promote] ✓ Promoted ${actualPath} to ${expectedPath}`);
}

main().catch((err) => {
  console.error("[promote] Fatal error:", err);
  process.exit(1);
});

