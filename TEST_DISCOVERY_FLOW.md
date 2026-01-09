# Test Discovery Flow

This document explains step-by-step how impacted/affected tests are discovered when a file is changed.

## Overview

The extension uses a **multi-strategy approach** with **high-confidence filtering** to find tests that are affected by code changes. Only tests with **proven dependencies** (imports) are included to avoid false positives.

## Step-by-Step Flow

### 1. Entry Point: `PureImpactAnalyzer.analyzeImpactWithDiff()`

**Location**: `src/core/PureImpactAnalyzer.ts` (lines 429-483)

**What happens**:
- After finding downstream files, the analyzer looks for affected tests
- Uses three strategies in order of confidence
- Only includes tests with **proven dependencies** (no guessing)

### 2. Strategy 1: Tests Found by DependencyAnalyzer (Highest Confidence)

**Location**: `src/core/PureImpactAnalyzer.ts` (line 437)

**What happens**:
- When `findDownstreamComponentsWithLines()` is called, it returns ALL downstream files
- Test files are filtered out from source files but kept separately
- These test files have **proven dependencies** because they were found in the reverse import graph

**Key code**:
```typescript
// Filter out test files from downstream files
const sourceDownstreamFilesWithLines = downstreamFilesWithLines.filter(item => !isTestFile(item.file));
const testFilesFromDependencyAnalyzer = downstreamFilesWithLines.filter(item => isTestFile(item.file));

// Strategy 1: Tests found by DependencyAnalyzer (highest confidence)
const highConfidenceTests = new Set<string>(testFilesFromDependencyAnalyzer.map(item => item.file));
```

**Test file detection**:
- Files matching patterns: `*.test.ts`, `*.spec.ts`, `*.test.tsx`, `*.spec.tsx`
- Files in directories: `/test/`, `/tests/`, `/__tests__/`
- Files that import the changed file (found via reverse import graph)

**Confidence**: ⭐⭐⭐⭐⭐ (Highest - proven dependency via import graph)

### 3. Strategy 2: Direct Import Search

**Location**: `src/core/PureImpactAnalyzer.ts` (lines 439-447)

**Function**: `findTestsThatImportFile()`

**What happens**:
- Recursively walks the project directory
- Finds all test files matching patterns: `*.test.*`, `*.spec.*`
- For each test file, checks if it imports the source file using `fileImportsTarget()`
- Only includes tests that actually import the source file

**Key code**:
```typescript
const testsThatImportSource = await findTestsThatImportFile(fullFilePath, projectRoot);
for (const testFile of testsThatImportSource) {
    highConfidenceTests.add(testFile);
}
```

**Import detection** (`fileImportsTarget()`):
- Checks for various import patterns:
  - `import ... from './source'`
  - `import ... from '../source'`
  - `import ... from 'package-name/source'`
  - `require('./source')`
  - `import('./source')`
- Handles path normalization (forward/backward slashes)
- Handles package imports (e.g., `import ... from 'axios'`)
- Handles relative paths and path aliases

**Confidence**: ⭐⭐⭐⭐ (High - proven import statement)

### 4. Strategy 3: TestFinder (Type-Aware Discovery)

**Location**: `src/core/PureImpactAnalyzer.ts` (lines 449-471)

**Class**: `TestFinder` (`src/analyzers/TestFinder.ts`)

**What happens**:
- Uses `TestFinder.findAffectedTests()` which employs multiple strategies:

  **Strategy 3a: Same Directory Tests**
  - Finds test files in the same directory as the source file
  - Matches by naming convention (e.g., `button.tsx` → `button.test.tsx`)

  **Strategy 3b: Test Directory Search**
  - Searches common test directories: `test/`, `tests/`, `__tests__/`, `spec/`, `specs/`
  - Matches by naming convention

  **Strategy 3c: Content-Based Search**
  - Walks entire workspace
  - Checks if test file imports the source file
  - Checks if test file references changed functions/classes

  **Strategy 3d: Naming Convention**
  - Finds test files with matching names (e.g., `button.test.ts` for `button.ts`)

- **Filtering**: `filterRelevantTests()` only keeps tests that:
  - Import the source file, OR
  - Reference changed functions/classes, OR
  - Match by naming convention (lower confidence)

- **Verification**: Each test from TestFinder is double-checked with `testFileImportsSourceFile()`

**Key code**:
```typescript
const testFinderResults = await testFinder.findAffectedTests(fullFilePath, changedCodeAnalysis);
for (const testFile of testFinderResults) {
    // Verify it actually imports the source (double-check)
    if (await testFileImportsSourceFile(testFile, fullFilePath, projectRoot)) {
        highConfidenceTests.add(testFile);
    }
}
```

**Confidence**: ⭐⭐⭐ (Medium - may include naming-based matches)

### 5. Fallback: Manual Test File Scan

**Location**: `src/core/PureImpactAnalyzer.ts` (lines 463-470)

**Function**: `findTestFilesFallback()`

**What happens**:
- Only used if `TestFinder` fails (e.g., in test environments)
- Recursively walks project directory
- Finds test files matching patterns
- **ONLY includes tests that import the source file OR downstream files**
- **NO name matching fallback** - only proven imports

**Key code**:
```typescript
// ONLY include if test imports the source file (proven dependency)
if (fileImportsTarget(content, normalizedSource, projectRoot)) {
    testFiles.push(fullPath);
    continue;
}

// OR if test imports any downstream file (transitive dependency)
for (const downstream of normalizedDownstream) {
    if (fileImportsTarget(content, downstream, projectRoot)) {
        testFiles.push(fullPath);
        break;
    }
}
```

**Confidence**: ⭐⭐⭐⭐ (High - only proven imports)

### 6. Final Filtering: High-Confidence Gate

**Location**: `src/core/PureImpactAnalyzer.ts` (lines 473-483)

**What happens**:
- All strategies add tests to `highConfidenceTests` Set (deduplicates)
- **Gate**: Only includes tests with proven dependencies
- If no proven dependencies exist, returns empty array (no guessing)

**Key code**:
```typescript
// Gate: Only include high-confidence tests with proven dependencies
affectedTests = Array.from(highConfidenceTests);

// Log summary
const hasProvenDependencies = sourceDownstreamFilesWithLines.length > 0 || 
                              testFilesFromDependencyAnalyzer.length > 0 || 
                              affectedTests.length > 0;
if (!hasProvenDependencies) {
    log(`⚠️ No proven test dependencies found. Not including any tests (to avoid false positives).`);
}
```

## Test File Patterns

The extension recognizes test files by:

### File Name Patterns:
- `*.test.js`, `*.test.jsx`, `*.test.ts`, `*.test.tsx`
- `*.spec.js`, `*.spec.jsx`, `*.spec.ts`, `*.spec.tsx`
- `test_*.js`, `test_*.ts` (Python-style)
- `*_test.js`, `*_test.ts` (Go-style)

### Directory Patterns:
- `/test/`, `/tests/`, `/__tests__/`
- `/spec/`, `/specs/`
- `/test-src/`, `/src/test/`, `/src/tests/`

## Import Detection Details

### `fileImportsTarget()` Function

**Location**: `src/core/PureImpactAnalyzer.ts` (lines 756-839)

**What it checks**:
1. **Relative imports**: `import ... from './source'`, `import ... from '../source'`
2. **Package imports**: `import ... from 'package-name'` (resolves via package.json)
3. **Path aliases**: Handles TypeScript path mappings from `tsconfig.json`
4. **Require statements**: `require('./source')`, `require('package-name')`
5. **Dynamic imports**: `import('./source')`
6. **File extensions**: Handles `.ts`, `.tsx`, `.js`, `.jsx` (with and without extension)
7. **Directory imports**: Resolves `./dir` to `./dir/index.ts`

**Path normalization**:
- Handles forward/backward slashes (Windows vs Unix)
- Resolves relative paths to absolute
- Handles case sensitivity

## Confidence Levels

| Strategy | Confidence | Why |
|----------|-----------|-----|
| DependencyAnalyzer (reverse graph) | ⭐⭐⭐⭐⭐ | Proven dependency via import graph analysis |
| Direct import search | ⭐⭐⭐⭐ | Proven import statement in test file |
| TestFinder (content-based) | ⭐⭐⭐ | May include naming-based matches |
| Fallback scan | ⭐⭐⭐⭐ | Only proven imports, no name matching |

## Example Flow

**Scenario**: Changed `packages/ui/src/index.ts` which exports `cn` function

1. **DependencyAnalyzer** finds:
   - `packages/ui/src/button.test.tsx` imports `packages/ui/src/index.ts` → ✅ Added

2. **Direct import search** finds:
   - `packages/ui/src/card.test.tsx` has `import { cn } from './index'` → ✅ Added

3. **TestFinder** finds:
   - `packages/ui/src/separator.test.tsx` matches naming → ⚠️ Checked
   - Verifies it imports source → ✅ Added (if import found)

4. **Final result**:
   - All three tests added to `affectedTests`
   - Only tests with proven imports are included

## Troubleshooting

### No tests found?

1. **Check test file patterns**: Ensure test files match patterns (`*.test.ts`, `*.spec.ts`)
2. **Check imports**: Test files must actually import the changed file (not just name match)
3. **Check project root**: Ensure `projectRoot` is correct (Git root or workspace folder)
4. **Check path resolution**: Import paths must resolve correctly (check `tsconfig.json` paths)

### Too many tests found?

- The extension uses **high-confidence filtering** - only tests with proven imports are included
- If you see false positives, check if tests are importing the source file indirectly (via barrel exports)

### Tests not found that should be?

1. **Check import paths**: Test must import the source file (directly or via barrel)
2. **Check naming**: Test file must match patterns (`*.test.ts`, `*.spec.ts`)
3. **Check directory**: Test must be in a discoverable location (not in `node_modules`, etc.)
4. **Check TypeScript paths**: If using path aliases, ensure `tsconfig.json` is found and parsed

## Debug Logging

Key log messages to look for:

- `[PureImpactAnalyzer] Found X high-confidence affected tests (Y from DependencyAnalyzer, Z from import analysis)`
- `[PureImpactAnalyzer] ⚠️ No proven test dependencies found. Not including any tests (to avoid false positives).`
- `[TestFinder] Found test file: path/to/test.ts`
- `[DependencyAnalyzer] Found importing file: path/to/test.ts`

## Key Design Principles

1. **Proven Dependencies Only**: Only tests with actual import statements are included
2. **No Guessing**: If no proven dependencies exist, return empty array (no false positives)
3. **Multi-Strategy**: Uses multiple strategies to maximize coverage
4. **High Confidence**: Prioritizes strategies with highest confidence (import graph > direct import > content search)
5. **Deduplication**: Uses `Set` to avoid duplicate test files

