import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REGRESSIONS_DIR = path.join(ROOT, "regressions");
const OUT_DIR = path.join(ROOT, "regressions", "out");

/**
 * Verifies detailed shape information for a symbol.
 * Returns array of error messages (empty if all checks pass).
 */
function verifyDetailedShape(expected, actualShape, symbolName, context) {
  const errors = [];
  
  if (!actualShape) {
    errors.push(`${context} symbol '${symbolName}' has no shape`);
    return errors;
  }
  
  // Verify basic kind
  if (expected.kind && actualShape.kind !== expected.kind) {
    errors.push(
      `${context} symbol '${symbolName}' has wrong kind: expected ${expected.kind}, got ${actualShape.kind}`
    );
    return errors; // Can't verify further if kind is wrong
  }
  
  // Verify shape name
  if (expected.shapeName && actualShape.name !== expected.shapeName) {
    if (!actualShape.name || !actualShape.name.includes(expected.shapeName)) {
      errors.push(
        `${context} symbol '${symbolName}' has wrong shape name: expected '${expected.shapeName}', got '${actualShape.name}'`
      );
    }
  }
  
  // Detailed shape verification based on kind
  if (expected.detailedShape) {
    if (actualShape.kind === 'function') {
      errors.push(...verifyFunctionShape(expected.detailedShape, actualShape, symbolName, context));
    } else if (actualShape.kind === 'class') {
      errors.push(...verifyClassShape(expected.detailedShape, actualShape, symbolName, context));
    } else if (actualShape.kind === 'type' || actualShape.kind === 'interface') {
      errors.push(...verifyTypeShape(expected.detailedShape, actualShape, symbolName, context));
    } else if (actualShape.kind === 'enum') {
      errors.push(...verifyEnumShape(expected.detailedShape, actualShape, symbolName, context));
    } else if (actualShape.kind === 'variable') {
      errors.push(...verifyVariableShape(expected.detailedShape, actualShape, symbolName, context));
    }
  }
  
  return errors;
}

/**
 * Verifies function shape details: parameters, return type, overloads, generics
 */
function verifyFunctionShape(expected, actual, symbolName, context) {
  const errors = [];
  
  // Check type parameters
  if (expected.typeParameters) {
    const actualTypeParams = actual.typeParameters || [];
    if (actualTypeParams.length !== expected.typeParameters.length) {
      errors.push(
        `${context} function '${symbolName}' has ${actualTypeParams.length} type parameters, expected ${expected.typeParameters.length}`
      );
    } else {
      for (let i = 0; i < expected.typeParameters.length; i++) {
        if (actualTypeParams[i] !== expected.typeParameters[i]) {
          errors.push(
            `${context} function '${symbolName}' type parameter ${i}: expected '${expected.typeParameters[i]}', got '${actualTypeParams[i]}'`
          );
        }
      }
    }
  }
  
  // Check overloads
  if (expected.overloads !== undefined) {
    const actualOverloads = actual.overloads || [];
    if (actualOverloads.length !== expected.overloads) {
      errors.push(
        `${context} function '${symbolName}' has ${actualOverloads.length} overloads, expected ${expected.overloads}`
      );
    } else if (expected.overloadDetails && actualOverloads.length > 0) {
      // Verify first overload details if provided
      const firstOverload = actualOverloads[0];
      const expectedFirst = expected.overloadDetails[0];
      
      if (expectedFirst.parameters) {
        if (firstOverload.parameters.length !== expectedFirst.parameters.length) {
          errors.push(
            `${context} function '${symbolName}' first overload has ${firstOverload.parameters.length} parameters, expected ${expectedFirst.parameters.length}`
          );
        } else {
          for (let i = 0; i < expectedFirst.parameters.length; i++) {
            const expParam = expectedFirst.parameters[i];
            const actParam = firstOverload.parameters[i];
            
            if (expParam.name && actParam.name !== expParam.name) {
              errors.push(
                `${context} function '${symbolName}' parameter ${i} name: expected '${expParam.name}', got '${actParam.name}'`
              );
            }
            if (expParam.type && !normalizeType(actParam.type).includes(normalizeType(expParam.type))) {
              errors.push(
                `${context} function '${symbolName}' parameter ${i} type: expected '${expParam.type}', got '${actParam.type}'`
              );
            }
            if (expParam.optional !== undefined && actParam.optional !== expParam.optional) {
              errors.push(
                `${context} function '${symbolName}' parameter ${i} optional: expected ${expParam.optional}, got ${actParam.optional}`
              );
            }
          }
        }
      }
      
      if (expectedFirst.returnType && firstOverload.returnType) {
        if (!normalizeType(firstOverload.returnType).includes(normalizeType(expectedFirst.returnType))) {
          errors.push(
            `${context} function '${symbolName}' return type: expected '${expectedFirst.returnType}', got '${firstOverload.returnType}'`
          );
        }
      }
    }
  }
  
  return errors;
}

/**
 * Verifies class shape details: members, constructor, type parameters
 */
function verifyClassShape(expected, actual, symbolName, context) {
  const errors = [];
  
  // Check type parameters
  if (expected.typeParameters) {
    const actualTypeParams = actual.typeParameters || [];
    if (actualTypeParams.length !== expected.typeParameters.length) {
      errors.push(
        `${context} class '${symbolName}' has ${actualTypeParams.length} type parameters, expected ${expected.typeParameters.length}`
      );
    }
  }
  
  // Check member count
  if (expected.memberCount !== undefined) {
    const actualMembers = actual.members || [];
    if (actualMembers.length !== expected.memberCount) {
      errors.push(
        `${context} class '${symbolName}' has ${actualMembers.length} members, expected ${expected.memberCount}`
      );
    }
  }
  
  // Check specific members if provided
  if (expected.members) {
    const actualMemberMap = new Map((actual.members || []).map(m => [m.name, m]));
    for (const expMember of expected.members) {
      const actMember = actualMemberMap.get(expMember.name);
      if (!actMember) {
        errors.push(
          `${context} class '${symbolName}' missing member '${expMember.name}'`
        );
      } else {
        if (expMember.kind && actMember.kind !== expMember.kind) {
          errors.push(
            `${context} class '${symbolName}' member '${expMember.name}' has wrong kind: expected ${expMember.kind}, got ${actMember.kind}`
          );
        }
        if (expMember.visibility && actMember.visibility !== expMember.visibility) {
          errors.push(
            `${context} class '${symbolName}' member '${expMember.name}' has wrong visibility: expected ${expMember.visibility}, got ${actMember.visibility}`
          );
        }
      }
    }
  }
  
  // Check constructor
  if (expected.hasConstructor !== undefined) {
    const hasConstructor = !!actual.constructor;
    if (hasConstructor !== expected.hasConstructor) {
      errors.push(
        `${context} class '${symbolName}' constructor: expected ${expected.hasConstructor}, got ${hasConstructor}`
      );
    }
  }
  
  return errors;
}

/**
 * Verifies type/interface shape details: properties, index signatures
 */
function verifyTypeShape(expected, actual, symbolName, context) {
  const errors = [];
  
  // Check type parameters
  if (expected.typeParameters) {
    const actualTypeParams = actual.typeParameters || [];
    if (actualTypeParams.length !== expected.typeParameters.length) {
      errors.push(
        `${context} ${actual.kind} '${symbolName}' has ${actualTypeParams.length} type parameters, expected ${expected.typeParameters.length}`
      );
    }
  }
  
  // Check property count
  if (expected.propertyCount !== undefined) {
    const actualProperties = actual.properties || [];
    if (actualProperties.length !== expected.propertyCount) {
      errors.push(
        `${context} ${actual.kind} '${symbolName}' has ${actualProperties.length} properties, expected ${expected.propertyCount}`
      );
    }
  }
  
  // Check specific properties if provided
  if (expected.properties) {
    const actualPropMap = new Map((actual.properties || []).map(p => [p.name, p]));
    for (const expProp of expected.properties) {
      const actProp = actualPropMap.get(expProp.name);
      if (!actProp) {
        errors.push(
          `${context} ${actual.kind} '${symbolName}' missing property '${expProp.name}'`
        );
      } else {
        if (expProp.type && !normalizeType(actProp.type).includes(normalizeType(expProp.type))) {
          errors.push(
            `${context} ${actual.kind} '${symbolName}' property '${expProp.name}' type: expected '${expProp.type}', got '${actProp.type}'`
          );
        }
        if (expProp.optional !== undefined && actProp.optional !== expProp.optional) {
          errors.push(
            `${context} ${actual.kind} '${symbolName}' property '${expProp.name}' optional: expected ${expProp.optional}, got ${actProp.optional}`
          );
        }
      }
    }
  }
  
  return errors;
}

/**
 * Verifies enum shape details: members
 */
function verifyEnumShape(expected, actual, symbolName, context) {
  const errors = [];
  
  // Check member count
  if (expected.memberCount !== undefined) {
    const actualMembers = actual.members || [];
    if (actualMembers.length !== expected.memberCount) {
      errors.push(
        `${context} enum '${symbolName}' has ${actualMembers.length} members, expected ${expected.memberCount}`
      );
    }
  }
  
  // Check specific members if provided
  if (expected.members) {
    const actualMemberMap = new Map((actual.members || []).map(m => [m.name, m]));
    for (const expMember of expected.members) {
      if (!actualMemberMap.has(expMember.name)) {
        errors.push(
          `${context} enum '${symbolName}' missing member '${expMember.name}'`
        );
      }
    }
  }
  
  return errors;
}

/**
 * Verifies variable shape details: type
 */
function verifyVariableShape(expected, actual, symbolName, context) {
  const errors = [];
  
  if (expected.type && actual.type) {
    if (!normalizeType(actual.type).includes(normalizeType(expected.type))) {
      errors.push(
        `${context} variable '${symbolName}' type: expected '${expected.type}', got '${actual.type}'`
      );
    }
  }
  
  return errors;
}

/**
 * Normalizes type strings for comparison (removes whitespace, normalizes generics)
 */
function normalizeType(typeStr) {
  if (!typeStr) return '';
  return typeStr.replace(/\s+/g, ' ').trim();
}

/**
 * Test runner for regression tests.
 * Compares actual output against expected.json and fails if assertions don't match.
 */
async function main() {
  const testName = process.argv[2] || "date-fns-v2-to-v3";
  const testDir = path.join(REGRESSIONS_DIR, testName);
  const expectedPath = path.join(testDir, "expected.json");
  const actualPath = path.join(OUT_DIR, `${testName}.actual.json`);

  console.log(`\n[test] Running regression test: ${testName}`);

  if (!fs.existsSync(expectedPath)) {
    console.error(`[test] ERROR: Expected file not found: ${expectedPath}`);
    console.error(`[test] Run the regression first to generate expected.json`);
    process.exit(1);
  }

  if (!fs.existsSync(actualPath)) {
    console.error(`[test] ERROR: Actual output not found: ${actualPath}`);
    console.error(`[test] Run the regression first: npm run regression:${testName}`);
    process.exit(1);
  }

  const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
  const actual = JSON.parse(fs.readFileSync(actualPath, "utf8"));

  const failures = [];

  // 1. Verify pinned refs match
  if (expected.metadata.beforeSha !== actual.beforeSha) {
    failures.push(
      `beforeSha mismatch: expected ${expected.metadata.beforeSha.substring(0, 7)}, got ${actual.beforeSha.substring(0, 7)}`
    );
  }
  if (expected.metadata.afterSha !== actual.afterSha) {
    failures.push(
      `afterSha mismatch: expected ${expected.metadata.afterSha.substring(0, 7)}, got ${actual.afterSha.substring(0, 7)}`
    );
  }

  // 2. Verify counts match
  const actualExportsDiff = {
    added: actual.exportsDiff?.added?.length || 0,
    removed: actual.exportsDiff?.removed?.length || 0,
    changed: actual.exportsDiff?.changed?.length || 0,
  };
  const expectedExportsDiff = expected.counts.exportsDiff;
  if (actualExportsDiff.added !== expectedExportsDiff.added) {
    failures.push(
      `exportsDiff.added: expected ${expectedExportsDiff.added}, got ${actualExportsDiff.added}`
    );
  }
  if (actualExportsDiff.removed !== expectedExportsDiff.removed) {
    failures.push(
      `exportsDiff.removed: expected ${expectedExportsDiff.removed}, got ${actualExportsDiff.removed}`
    );
  }
  if (actualExportsDiff.changed !== expectedExportsDiff.changed) {
    failures.push(
      `exportsDiff.changed: expected ${expectedExportsDiff.changed}, got ${actualExportsDiff.changed}`
    );
  }

  const actualApiDiff = {
    added: actual.apiDiff?.added?.length || 0,
    removed: actual.apiDiff?.removed?.length || 0,
    modified: actual.apiDiff?.modified?.length || 0,
    renamed: actual.apiDiff?.renamed?.length || 0,
  };
  const expectedApiDiff = expected.counts.apiDiff;
  if (actualApiDiff.added !== expectedApiDiff.added) {
    failures.push(
      `apiDiff.added: expected ${expectedApiDiff.added}, got ${actualApiDiff.added}`
    );
  }
  if (actualApiDiff.removed !== expectedApiDiff.removed) {
    failures.push(
      `apiDiff.removed: expected ${expectedApiDiff.removed}, got ${actualApiDiff.removed}`
    );
  }
  if (actualApiDiff.modified !== expectedApiDiff.modified) {
    failures.push(
      `apiDiff.modified: expected ${expectedApiDiff.modified}, got ${actualApiDiff.modified}`
    );
  }
  if (actualApiDiff.renamed !== expectedApiDiff.renamed) {
    failures.push(
      `apiDiff.renamed: expected ${expectedApiDiff.renamed}, got ${actualApiDiff.renamed}`
    );
  }

  // 3. Verify regression checks
  if (actual.regressionChecks) {
    const checks = expected.regressionChecks;
    for (const [key, expectedValue] of Object.entries(checks)) {
      const actualValue = actual.regressionChecks[key];
      if (actualValue !== expectedValue) {
        failures.push(
          `regressionChecks.${key}: expected ${expectedValue}, got ${actualValue}`
        );
      }
    }
  }

  // 4. Verify sample symbols exist and have correct shapes
  if (expected.sampleSymbols) {
    // Build maps for quick lookup
    const actualRemovedMap = new Map();
    for (const r of actual.apiDiff?.removed || []) {
      const name = r.identity.split("|")[0];
      actualRemovedMap.set(name, r);
    }
    
    const actualAddedMap = new Map();
    for (const a of actual.apiDiff?.added || []) {
      const name = a.identity.split("|")[0];
      actualAddedMap.set(name, a);
    }

    // Check removed symbols with detailed shape verification
    for (const sample of expected.sampleSymbols.removed || []) {
      const actualSymbol = actualRemovedMap.get(sample.name);
      if (!actualSymbol) {
        failures.push(
          `Sample removed symbol '${sample.name}' not found in actual removed exports`
        );
      } else {
        const shapeErrors = verifyDetailedShape(sample, actualSymbol.shape, sample.name, "removed");
        failures.push(...shapeErrors);
      }
    }

    // Check added symbols with detailed shape verification
    for (const sample of expected.sampleSymbols.added || []) {
      const actualSymbol = actualAddedMap.get(sample.name);
      if (!actualSymbol) {
        failures.push(
          `Sample added symbol '${sample.name}' not found in actual added exports`
        );
      } else {
        const shapeErrors = verifyDetailedShape(sample, actualSymbol.shape, sample.name, "added");
        failures.push(...shapeErrors);
      }
    }
  }

  // 5. Verify assertions
  if (expected.assertions) {
    const assertions = expected.assertions;
    
    // Count shapes built from API snapshots
    const shapesBuiltBefore = Object.keys(actual.apiSnapshotBefore?.exports || {}).length;
    const shapesBuiltAfter = Object.keys(actual.apiSnapshotAfter?.exports || {}).length;
    
    if (assertions.minShapesBuilt !== undefined) {
      if (shapesBuiltAfter < assertions.minShapesBuilt) {
        failures.push(
          `Shapes built (${shapesBuiltAfter}) below minimum (${assertions.minShapesBuilt})`
        );
      }
    }
    if (assertions.maxShapesBuilt !== undefined) {
      if (shapesBuiltAfter > assertions.maxShapesBuilt) {
        failures.push(
          `Shapes built (${shapesBuiltAfter}) above maximum (${assertions.maxShapesBuilt})`
        );
      }
    }
    if (assertions.mustHaveRemovedExports) {
      if (actualApiDiff.removed === 0) {
        failures.push(`Expected removed exports but found 0`);
      }
    }
    if (assertions.mustHaveAddedExports) {
      if (actualApiDiff.added === 0) {
        failures.push(`Expected added exports but found 0`);
      }
    }
  }

  // Report results
  if (failures.length === 0) {
    console.log(`[test] ✓ All assertions passed for ${testName}`);
    console.log(`[test]   Exports diff: +${actualExportsDiff.added} -${actualExportsDiff.removed} ~${actualExportsDiff.changed}`);
    console.log(`[test]   API diff: +${actualApiDiff.added} -${actualApiDiff.removed} ~${actualApiDiff.modified} renamed:${actualApiDiff.renamed}`);
    return 0;
  } else {
    console.error(`[test] ✗ ${failures.length} assertion(s) failed for ${testName}:`);
    for (const failure of failures) {
      console.error(`[test]   - ${failure}`);
    }
    console.error(`[test]`);
    console.error(`[test] To update expected.json, run:`);
    console.error(`[test]   npm run regression:${testName}`);
    console.error(`[test]   node scripts/promote-expected.mjs ${testName}`);
    return 1;
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("[test] Fatal error:", err);
  process.exit(1);
});

