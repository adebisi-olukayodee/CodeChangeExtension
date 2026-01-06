import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const CFG_PATH = path.join(ROOT, "regressions", "config.json");
const OUT_DIR = path.join(ROOT, "regressions", "out");

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: "pipe" }).toString("utf8").trim();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * Normalizes paths in the result to make them deterministic.
 * Replaces absolute workspace paths with placeholders.
 */
function normalizePaths(obj, workspaceRoot) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => normalizePaths(item, workspaceRoot));
  }
  
  const normalized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.includes(workspaceRoot)) {
      // Replace workspace root with placeholder
      normalized[key] = value.replace(workspaceRoot, '<WORKSPACE>');
    } else if (typeof value === 'object' && value !== null) {
      normalized[key] = normalizePaths(value, workspaceRoot);
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

function detectEntrypointsFromPackageJson(repoDir) {
  const candidates = new Set();
  const addCandidate = (value, basePath = "") => {
    if (typeof value !== "string") return;
    let normalized = value.startsWith("./") ? value.slice(2) : value;
    if (basePath) {
      normalized = path.join(basePath, normalized);
    }
    normalized = path.normalize(normalized);
    candidates.add(normalized);
  };
  const addFromExports = (exportsValue, basePath = "") => {
    if (!exportsValue) return;
    if (typeof exportsValue === "string") {
      addCandidate(exportsValue, basePath);
      return;
    }
    if (typeof exportsValue !== "object") return;
    const rootExport = exportsValue["."];
    if (typeof rootExport === "string") {
      addCandidate(rootExport, basePath);
      return;
    }
    if (rootExport && typeof rootExport === "object") {
      // Check for @zod/source or similar source fields first (prefer source over compiled)
      const sourceKeys = ["@zod/source", "source", "src"];
      for (const key of sourceKeys) {
        const val = rootExport[key];
        if (typeof val === "string" && (val.endsWith(".ts") || val.endsWith(".tsx"))) {
          addCandidate(val, basePath);
          return;
        }
      }
      // Fallback to other keys
      const keys = ["types", "import", "default", "require", "module", "main"];
      for (const key of keys) {
        const val = rootExport[key];
        if (typeof val === "string") {
          // Prefer .ts files over .d.ts or .js
          if (val.endsWith(".ts") || val.endsWith(".tsx")) {
            addCandidate(val, basePath);
            return;
          } else if (val.endsWith(".d.ts") || val.endsWith(".d.cts")) {
            // Try to find corresponding .ts source file
            const tsPath = val.replace(/\.d\.(cts|ts)$/, ".ts");
            const fullTsPath = basePath ? path.join(repoDir, basePath, tsPath) : path.join(repoDir, tsPath);
            if (fs.existsSync(fullTsPath)) {
              addCandidate(tsPath, basePath);
              return;
            }
          }
          addCandidate(val, basePath);
          return;
        }
      }
    }
  };
  const addFromPackageJson = (packageJsonPath, basePath = "") => {
    if (!fs.existsSync(packageJsonPath)) return;
    try {
      const json = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const pkgDir = path.dirname(packageJsonPath);
      // Check legacy fields
      if (json.types) {
        const typesPath = json.types;
        if (typesPath.endsWith(".d.ts") || typesPath.endsWith(".d.cts")) {
          const tsPath = typesPath.replace(/\.d\.(cts|ts)$/, ".ts");
          const fullTsPath = path.join(pkgDir, tsPath);
          if (fs.existsSync(fullTsPath)) {
            // Convert to relative path from repo root
            const relPath = path.relative(repoDir, fullTsPath);
            addCandidate(relPath, "");
          } else {
            addCandidate(typesPath, basePath);
          }
        } else {
          addCandidate(typesPath, basePath);
        }
      }
      if (json.typings) addCandidate(json.typings, basePath);
      if (json.module) {
        const modulePath = json.module;
        if (modulePath.endsWith(".js")) {
          const tsPath = modulePath.replace(/\.js$/, ".ts");
          const fullTsPath = path.join(pkgDir, tsPath);
          if (fs.existsSync(fullTsPath)) {
            const relPath = path.relative(repoDir, fullTsPath);
            addCandidate(relPath, "");
          }
        }
        addCandidate(modulePath, basePath);
      }
      if (json.main) {
        const mainPath = json.main;
        if (mainPath.endsWith(".js")) {
          const tsPath = mainPath.replace(/\.js$/, ".ts");
          const fullTsPath = path.join(pkgDir, tsPath);
          if (fs.existsSync(fullTsPath)) {
            const relPath = path.relative(repoDir, fullTsPath);
            addCandidate(relPath, "");
          }
        }
        addCandidate(mainPath, basePath);
      }
      if (json.source) addCandidate(json.source, basePath);
      addFromExports(json.exports, basePath);
    } catch {
      // Ignore invalid package.json
    }
  };

  // Check root package.json
  addFromPackageJson(path.join(repoDir, "package.json"));
  
  // Check packages directory (monorepo)
  const packagesDir = path.join(repoDir, "packages");
  if (fs.existsSync(packagesDir) && fs.statSync(packagesDir).isDirectory()) {
    for (const entry of fs.readdirSync(packagesDir)) {
      const entryPath = path.join(packagesDir, entry);
      if (fs.statSync(entryPath).isDirectory()) {
        const pkgJsonPath = path.join(entryPath, "package.json");
        const basePath = path.join("packages", entry);
        addFromPackageJson(pkgJsonPath, basePath);
      }
    }
  }

  // Filter to only existing files and prefer .ts over .d.ts
  const existing = Array.from(candidates).filter((p) => {
    const fullPath = path.join(repoDir, p);
    return fs.existsSync(fullPath);
  });
  
  // If we have .ts files, prefer them over .d.ts
  const tsFiles = existing.filter(p => p.endsWith(".ts") || p.endsWith(".tsx"));
  if (tsFiles.length > 0) {
    return tsFiles;
  }
  
  return existing;
}

async function main() {
  ensureDir(OUT_DIR);
  const cfg = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));

  // Use stable workspace path instead of temp (for deterministic tests)
  // Use environment variable if set, otherwise use a workspace subdirectory
  const WORKSPACE_ROOT = process.env.REGRESSION_WORKSPACE || path.join(ROOT, ".regression-workspace");
  ensureDir(WORKSPACE_ROOT);

  // Convert path to file:// URL for ESM import (required on Windows)
  const runnerPath = path.join(ROOT, "dist", "regression-runner.js");
  const runnerUrl = pathToFileURL(runnerPath).href;
  const { runAnalyzer } = await import(runnerUrl);

  // Filter to specific test if provided
  const testFilter = process.argv[2];
  const reposToRun = testFilter 
    ? cfg.repos.filter(r => r.id === testFilter)
    : cfg.repos;

  if (testFilter && reposToRun.length === 0) {
    console.error(`[regression] ERROR: Test '${testFilter}' not found in config.json`);
    process.exit(1);
  }

  for (const r of reposToRun) {
    // Skip tests marked with skip flag
    if (r.skip) {
      console.log(`\n[regression] SKIP ${r.id} (marked as skip)`);
      continue;
    }
    
    console.log(`\n[regression] START ${r.id}`);
    try {
      // Use stable workspace path for deterministic tests
      const repoDir = path.join(WORKSPACE_ROOT, r.id);
      ensureDir(path.dirname(repoDir));

      if (!fs.existsSync(repoDir)) {
        console.log(`[regression] Cloning ${r.id}...`);
        sh(`git clone --no-single-branch ${r.url} ${repoDir}`, ROOT);
      } else {
        console.log(`[regression] Fetching ${r.id}...`);
        sh(`git fetch --all --tags --prune`, repoDir);
      }

      console.log(`[regression] Resolving refs for ${r.id}...`);
      const beforeSha = sh(`git rev-parse ${r.beforeRef}`, repoDir);
      const afterSha  = sh(`git rev-parse ${r.afterRef}`, repoDir);
      console.log(`[regression] ${r.id} before: ${beforeSha.substring(0, 7)} (${r.beforeRef})`);
      console.log(`[regression] ${r.id} after:  ${afterSha.substring(0, 7)} (${r.afterRef})`);

      const mode = r.mode || 'exports-only';
      
      // Validate entrypoints exist
      console.log(`[regression] Validating entrypoints for ${r.id}...`);
      sh(`git checkout -f ${beforeSha}`, repoDir);
      const beforeEntrypoints = r.paths || [];
      const beforeMissing = beforeEntrypoints.filter(p => {
        const fullPath = path.join(repoDir, p);
        return !fs.existsSync(fullPath);
      });
      let beforeExisting = beforeEntrypoints.filter(p => !beforeMissing.includes(p));
      // Always try detection if configured paths are missing
      if (beforeMissing.length > 0) {
        const detected = detectEntrypointsFromPackageJson(repoDir);
        if (detected.length > 0) {
          console.log(`[regression] Detected before entrypoints from package.json: ${detected.join(", ")}`);
          // Use detected if configured paths are all missing, otherwise merge
          if (beforeExisting.length === 0) {
            beforeExisting = detected;
          } else {
            // Merge: use existing + detected (deduplicated)
            const all = new Set([...beforeExisting, ...detected]);
            beforeExisting = Array.from(all);
          }
        }
      }
      
      sh(`git checkout -f ${afterSha}`, repoDir);
      const afterEntrypoints = r.paths || [];
      const afterMissing = afterEntrypoints.filter(p => {
        const fullPath = path.join(repoDir, p);
        return !fs.existsSync(fullPath);
      });
      let afterExisting = afterEntrypoints.filter(p => !afterMissing.includes(p));
      // Always try detection if configured paths are missing
      if (afterMissing.length > 0) {
        const detected = detectEntrypointsFromPackageJson(repoDir);
        if (detected.length > 0) {
          console.log(`[regression] Detected after entrypoints from package.json: ${detected.join(", ")}`);
          // Use detected if configured paths are all missing, otherwise merge
          if (afterExisting.length === 0) {
            afterExisting = detected;
          } else {
            // Merge: use existing + detected (deduplicated)
            const all = new Set([...afterExisting, ...detected]);
            afterExisting = Array.from(all);
          }
        }
      }
      
      if (beforeMissing.length > 0 || afterMissing.length > 0) {
        console.warn(`[regression] WARNING: Entrypoint files missing for ${r.id}`);
        if (beforeMissing.length > 0) {
          console.warn(`[regression]   Before (${r.beforeRef}) missing: ${beforeMissing.join(', ')}`);
        }
        if (afterMissing.length > 0) {
          console.warn(`[regression]   After (${r.afterRef}) missing: ${afterMissing.join(', ')}`);
        }
        if (beforeExisting.length === 0 || afterExisting.length === 0) {
          console.error(`[regression] ERROR: No entrypoints exist for ${r.id} in one or both refs`);
          console.error(`[regression] Fix: Update paths in config.json or add repo-specific entrypoint detection`);
          throw new Error(`Entrypoint files missing: before=${beforeMissing.join(',')} after=${afterMissing.join(',')}`);
        }
        console.warn(`[regression] Using existing entrypoints: before=${beforeExisting.join(', ')} after=${afterExisting.join(', ')}`);
      }

      console.log(`[regression] Analyzing ${r.id} before state...`);
      sh(`git checkout -f ${beforeSha}`, repoDir);
      const before = await runAnalyzer({ repoRoot: repoDir, paths: beforeExisting.length > 0 ? beforeExisting : r.paths, tsconfig: r.tsconfig, mode });

      console.log(`[regression] Analyzing ${r.id} after state...`);
      sh(`git checkout -f ${afterSha}`, repoDir);
      const after = await runAnalyzer({ repoRoot: repoDir, paths: afterExisting.length > 0 ? afterExisting : r.paths, tsconfig: r.tsconfig, mode });
      
      // Validate analysis results
      const beforeStats = before.before?.exportStats || before.exportStats;
      const afterStats = after.before?.exportStats || after.exportStats;
      
      if (beforeStats) {
        const beforePathsForChecks = beforeExisting.length > 0 ? beforeExisting : beforeEntrypoints;
        if (beforePathsForChecks.length > 0) {
          const beforeFile = path.join(repoDir, beforePathsForChecks[0]);
          sh(`git checkout -f ${beforeSha}`, repoDir);
          if (fs.existsSync(beforeFile)) {
            const content = fs.readFileSync(beforeFile, 'utf8');
            const hasExports = /export\s+/.test(content) || /export\s+\*/.test(content);
            const hasReExports = /export\s+\*/.test(content) || /export\s+\*\s+as/.test(content);
            
            // Guardrail: Fail if entrypoint contains export * from AND unresolved re-exports AND exports_total === 0
            if (hasReExports && beforeStats.reexportGroupsUnresolved > 0 && beforeStats.exportsTotal === 0) {
              console.error(`[regression] ERROR: ${r.id} before state has 'export * from' statements but 0 exports and ${beforeStats.reexportGroupsUnresolved} unresolved re-exports`);
              console.error(`[regression]   File: ${beforePathsForChecks[0]}`);
              console.error(`[regression]   This indicates re-export resolution is failing. Fix re-export resolution before proceeding.`);
              throw new Error(`Invalid before state: unresolved re-exports not resolved`);
            }
            
            // Guardrail: Fail if exports_total === 0 but file has export statements
            if (beforeStats.exportsTotal === 0 && hasExports) {
              console.error(`[regression] ERROR: ${r.id} before state has export statements but 0 exports detected`);
              console.error(`[regression]   File: ${beforePathsForChecks[0]}`);
              console.error(`[regression]   This indicates the analyzer is not working correctly.`);
              throw new Error(`Invalid before state: exports present but 0 detected`);
            }
          }
        }
      }
      
      if (afterStats) {
        const afterPathsForChecks = afterExisting.length > 0 ? afterExisting : afterEntrypoints;
        if (afterPathsForChecks.length > 0) {
          const afterFile = path.join(repoDir, afterPathsForChecks[0]);
          sh(`git checkout -f ${afterSha}`, repoDir);
          if (fs.existsSync(afterFile)) {
            const content = fs.readFileSync(afterFile, 'utf8');
            const hasExports = /export\s+/.test(content) || /export\s+\*/.test(content);
            const hasReExports = /export\s+\*/.test(content) || /export\s+\*\s+as/.test(content);
            
            // Guardrail: Fail if entrypoint contains export * from AND unresolved re-exports AND exports_total === 0
            if (hasReExports && afterStats.reexportGroupsUnresolved > 0 && afterStats.exportsTotal === 0) {
              console.error(`[regression] ERROR: ${r.id} after state has 'export * from' statements but 0 exports and ${afterStats.reexportGroupsUnresolved} unresolved re-exports`);
              console.error(`[regression]   File: ${afterPathsForChecks[0]}`);
              console.error(`[regression]   This indicates re-export resolution is failing. Fix re-export resolution before proceeding.`);
              throw new Error(`Invalid after state: unresolved re-exports not resolved`);
            }
            
            // Guardrail: Fail if exports_total === 0 but file has export statements
            if (afterStats.exportsTotal === 0 && hasExports) {
              console.error(`[regression] ERROR: ${r.id} after state has export statements but 0 exports detected`);
              console.error(`[regression]   File: ${afterPathsForChecks[0]}`);
              console.error(`[regression]   This indicates the analyzer is not working correctly.`);
              throw new Error(`Invalid after state: exports present but 0 detected`);
            }
          }
        }
        
        // Also check for API snapshot mode
        if (mode === 'api-snapshot') {
          sh(`git checkout -f ${afterSha}`, repoDir);
          const apiSnapshotAfter = await buildApiSnapshot({ repoRoot: repoDir, paths: afterExisting.length > 0 ? afterExisting : r.paths, tsconfig: r.tsconfig });
          if (apiSnapshotAfter) {
            const shapesBuilt = Object.keys(apiSnapshotAfter.exports || {}).length;
            const afterPathsForChecks2 = afterExisting.length > 0 ? afterExisting : afterEntrypoints;
            if (shapesBuilt === 0 && afterStats.exportsTotal === 0 && afterPathsForChecks2.length > 0) {
              const afterFile2 = path.join(repoDir, afterPathsForChecks2[0]);
              if (fs.existsSync(afterFile2)) {
                const content = fs.readFileSync(afterFile2, 'utf8');
                const hasExports = /export\s+/.test(content) || /export\s+\*/.test(content);
                if (hasExports) {
                  console.error(`[regression] ERROR: ${r.id} after state has export statements but 0 API shapes built`);
                  console.error(`[regression]   This indicates API snapshot building is failing.`);
                  throw new Error(`Invalid after state: exports present but 0 API shapes built`);
                }
              }
            }
          }
        }
      }

      // Compute exports diff (key signal for breaking changes)
      const { computeExportsDiff, buildApiSnapshot, computeApiDiff, apiDiffToFindings } = await import(runnerUrl);
      const exportsDiff = computeExportsDiff(before, after);
      
      console.log(`[regression] ${r.id} exports diff: +${exportsDiff.added.length} -${exportsDiff.removed.length} ~${exportsDiff.changed.length}`);

      let result = { beforeSha, afterSha, before, after, exportsDiff };
      
      // If api-snapshot mode, also build API snapshots and compute API diff
      if (mode === 'api-snapshot') {
        console.log(`[regression] Building API snapshots for ${r.id}...`);
        sh(`git checkout -f ${beforeSha}`, repoDir);
        const apiSnapshotBefore = await buildApiSnapshot({ repoRoot: repoDir, paths: beforeExisting.length > 0 ? beforeExisting : r.paths, tsconfig: r.tsconfig });
        
        sh(`git checkout -f ${afterSha}`, repoDir);
        const apiSnapshotAfter = await buildApiSnapshot({ repoRoot: repoDir, paths: afterExisting.length > 0 ? afterExisting : r.paths, tsconfig: r.tsconfig });
        
        if (apiSnapshotBefore && apiSnapshotAfter) {
          // Track failed shapes for graceful degradation
          const failedBefore = apiSnapshotBefore.failedShapes || 0;
          const failedAfter = apiSnapshotAfter.failedShapes || 0;
          const failedNamesBefore = new Set(apiSnapshotBefore.failedShapeNames || []);
          const failedNamesAfter = new Set(apiSnapshotAfter.failedShapeNames || []);
          const totalFailed = failedBefore + failedAfter;
          const isPartial = totalFailed > 0;
          
          if (isPartial) {
            console.warn(`\n[regression] ⚠️  ${r.id}: ${totalFailed} API shapes failed to build (Before: ${failedBefore}, After: ${failedAfter})`);
            console.warn(`[regression]    Failed symbols will be excluded from API diff`);
            if (failedBefore > 0) {
              console.warn(`[regression]    Before failed: ${(apiSnapshotBefore.failedShapeNames || []).slice(0, 5).join(', ')}${failedBefore > 5 ? '...' : ''}`);
            }
            if (failedAfter > 0) {
              console.warn(`[regression]    After failed: ${(apiSnapshotAfter.failedShapeNames || []).slice(0, 5).join(', ')}${failedAfter > 5 ? '...' : ''}`);
            }
          }
          
          // Filter out failed symbols from API snapshots before computing diff
          const beforeExportsFiltered = new Map();
          const afterExportsFiltered = new Map();
          
          for (const [identity, shape] of apiSnapshotBefore.exports) {
            // Extract export name from identity (format: "name|type|path|pos")
            const exportName = identity.split('|')[0];
            if (!failedNamesBefore.has(exportName)) {
              beforeExportsFiltered.set(identity, shape);
            }
          }
          
          for (const [identity, shape] of apiSnapshotAfter.exports) {
            const exportName = identity.split('|')[0];
            if (!failedNamesAfter.has(exportName)) {
              afterExportsFiltered.set(identity, shape);
            }
          }
          
          // Create filtered snapshots for diff computation
          const beforeFiltered = {
            ...apiSnapshotBefore,
            exports: beforeExportsFiltered
          };
          const afterFiltered = {
            ...apiSnapshotAfter,
            exports: afterExportsFiltered
          };
          
          const apiDiff = computeApiDiff(beforeFiltered, afterFiltered);
          console.log(`[regression] ${r.id} API diff: +${apiDiff.added.length} -${apiDiff.removed.length} ~${apiDiff.modified.length} renamed:${apiDiff.renamed.length}`);
          
          // Regression checks for API snapshot mode
          const regressionChecks = {
            removedExportsDetected: apiDiff.removed.length > 0,
            removedExportsCount: apiDiff.removed.length,
            modifiedExportsCount: apiDiff.modified.length,
            addedExportsCount: apiDiff.added.length,
            renamedExportsCount: apiDiff.renamed.length,
            // Breaking changes: removed exports are always breaking
            hasBreakingChanges: apiDiff.removed.length > 0 || apiDiff.modified.length > 0
          };
          
          // Log regression check results
          const failedChecks = Object.entries(regressionChecks)
            .filter(([name, value]) => {
              // removedExportsDetected should be true if there are removed exports
              if (name === 'removedExportsDetected') {
                return apiDiff.removed.length > 0 && !value;
              }
              return false;
            })
            .map(([name, _]) => name);
          
          if (failedChecks.length > 0) {
            console.error(`[regression] ${r.id} API regression checks FAILED: ${failedChecks.join(', ')}`);
          } else {
            console.log(`[regression] ${r.id} API regression checks passed`);
          }
          
          // Convert API diff to breaking change findings
          const apiFindings = apiDiffToFindings(apiDiff, r.paths[0] || 'unknown');
          
          // Calculate confidence (lower if partial)
          const totalShapes = (apiSnapshotBefore.failedShapes || 0) + (apiSnapshotAfter.failedShapes || 0) + 
                             beforeExportsFiltered.size + afterExportsFiltered.size;
          const successShapes = beforeExportsFiltered.size + afterExportsFiltered.size;
          const confidence = totalShapes > 0 ? (successShapes / totalShapes) : 1.0;
          
          // Convert Maps to objects for JSON serialization
          const apiSnapshotBeforeSerialized = apiSnapshotBefore ? {
            ...apiSnapshotBefore,
            exports: Object.fromEntries(beforeExportsFiltered),
            failedShapes: apiSnapshotBefore.failedShapes || 0,
            failedShapeNames: apiSnapshotBefore.failedShapeNames || [],
            partial: apiSnapshotBefore.partial || false
          } : null;
          
          const apiSnapshotAfterSerialized = apiSnapshotAfter ? {
            ...apiSnapshotAfter,
            exports: Object.fromEntries(afterExportsFiltered),
            failedShapes: apiSnapshotAfter.failedShapes || 0,
            failedShapeNames: apiSnapshotAfter.failedShapeNames || [],
            partial: apiSnapshotAfter.partial || false
          } : null;
          
          result = { 
            ...result, 
            apiDiff, 
            apiSnapshotBefore: apiSnapshotBeforeSerialized, 
            apiSnapshotAfter: apiSnapshotAfterSerialized,
            regressionChecks,
            apiFindings,
            partial: isPartial,
            confidence: isPartial ? confidence : 1.0,
            failedShapes: {
              before: failedBefore,
              after: failedAfter,
              total: totalFailed,
              beforeNames: apiSnapshotBefore.failedShapeNames || [],
              afterNames: apiSnapshotAfter.failedShapeNames || []
            }
          };
        }
      }

      // Normalize paths for deterministic output
      const normalizedResult = normalizePaths(result, WORKSPACE_ROOT);
      
      fs.writeFileSync(
        path.join(OUT_DIR, `${r.id}.actual.json`),
        JSON.stringify(normalizedResult, null, 2)
      );
      // Log summary with failed shapes prominently if present
      if (result.failedShapes && result.failedShapes.total > 0) {
        const conf = result.confidence ? ` (confidence: ${(result.confidence * 100).toFixed(1)}%)` : '';
        console.log(`[regression] DONE  ${r.id} ⚠️  ${result.failedShapes.total} failed shapes${conf}`);
      } else {
      console.log(`[regression] DONE  ${r.id}`);
      }
    } catch (e) {
      console.error(`[regression] FAIL  ${r.id}`);
      console.error(e?.stack || e);
      // Write a failure marker so the test output is explicit
      fs.writeFileSync(
        path.join(OUT_DIR, `${r.id}.actual.json`),
        JSON.stringify({ 
          repo: r.id, 
          error: String(e?.message || e),
          stack: e?.stack 
        }, null, 2)
      );
      continue;
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
