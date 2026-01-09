# Test Files vs Downstream Files: How They're Differentiated

This document explains how the extension distinguishes between test files and regular downstream source files.

## Overview

When the extension finds files that import or depend on a changed file, it needs to separate them into two categories:
1. **Downstream Files** (source code) - shown in "Downstream Impact" section
2. **Test Files** (tests) - shown in "Affected Tests" section

## The Differentiation Process

### Step 1: Find All Dependent Files

**Location**: `src/core/PureImpactAnalyzer.ts` (line 350-372)

First, `findDownstreamComponentsWithLines()` finds ALL files that import the changed file, regardless of whether they're tests or source files:

```typescript
const downstreamFilesWithLines = await dependencyAnalyzer.findDownstreamComponentsWithLines(
    afterFilePath,
    changedCodeAnalysis,
    Array.from(impactedExportNames),
    projectRoot
);
```

This returns files like:
- `src/button.tsx` (source file)
- `src/button.test.tsx` (test file)
- `src/card.tsx` (source file)
- `tests/card.spec.tsx` (test file)

### Step 2: Classify Files Using `isTestFile()`

**Location**: `src/core/PureImpactAnalyzer.ts` (lines 375-388)

A file is classified as a **test file** if it matches ANY of these criteria:

#### File Name Patterns:
- `*.test.ts`, `*.test.tsx`, `*.test.js`, `*.test.jsx`
- `*.spec.ts`, `*.spec.tsx`, `*.spec.js`, `*.spec.jsx`

#### Directory Patterns:
- Files in `/test/` directory
- Files in `/tests/` directory
- Files in `/__tests__/` directory

**Key code**:
```typescript
const isTestFile = (filePath: string): boolean => {
    const normalized = filePath.replace(/\\/g, '/');
    const isTest = (
        normalized.includes('/test/') ||
        normalized.includes('/tests/') ||
        normalized.includes('/__tests__/') ||
        /\.test\.(ts|tsx|js|jsx)$/i.test(normalized) ||
        /\.spec\.(ts|tsx|js|jsx)$/i.test(normalized)
    );
    return isTest;
};
```

### Step 3: Separate Into Two Groups

**Location**: `src/core/PureImpactAnalyzer.ts` (lines 390-392)

After classification, files are split into two groups:

```typescript
// Separate downstream files from test files (with line numbers)
const sourceDownstreamFilesWithLines = downstreamFilesWithLines.filter(item => !isTestFile(item.file));
const testFilesFromDependencyAnalyzer = downstreamFilesWithLines.filter(item => isTestFile(item.file));
```

**Result**:
- `sourceDownstreamFilesWithLines`: Only source files (NOT tests)
- `testFilesFromDependencyAnalyzer`: Only test files

### Step 4: Use Each Group Appropriately

#### Downstream Files (Source Code)
- Stored in `report.downstreamFiles`
- Shown in UI as "Downstream Impact" issues
- Used for calculating risk level
- Used for dependency analysis

#### Test Files
- Added to `highConfidenceTests` Set (Strategy 1)
- Combined with other test discovery strategies
- Stored in `report.tests`
- Shown in UI as "Affected Tests"
- Used for test time estimation

## Examples

### Example 1: Mixed Results

**Changed file**: `packages/ui/src/index.ts`

**All dependent files found**:
```
packages/ui/src/button.tsx          (source)
packages/ui/src/button.test.tsx    (test - matches *.test.tsx)
packages/ui/src/card.tsx           (source)
tests/ui/card.spec.tsx             (test - matches *.spec.tsx AND /tests/)
```

**After separation**:

**Downstream Files**:
```
packages/ui/src/button.tsx
packages/ui/src/card.tsx
```

**Test Files**:
```
packages/ui/src/button.test.tsx
tests/ui/card.spec.tsx
```

### Example 2: Edge Cases

| File Path | Classification | Reason |
|-----------|---------------|--------|
| `src/utils.ts` | Source | No test patterns |
| `src/utils.test.ts` | Test | Matches `*.test.ts` |
| `src/utils.spec.ts` | Test | Matches `*.spec.ts` |
| `test/utils.ts` | Test | In `/test/` directory |
| `tests/utils.ts` | Test | In `/tests/` directory |
| `__tests__/utils.ts` | Test | In `/__tests__/` directory |
| `src/test-utils.ts` | Source | Contains "test" but not a test file pattern |
| `src/utils.testing.ts` | Source | Doesn't match `*.test.*` pattern |

## Different Implementations

### PureImpactAnalyzer.isTestFile()

**Location**: `src/core/PureImpactAnalyzer.ts` (lines 375-388)

**Patterns**:
- Directory: `/test/`, `/tests/`, `/__tests__/`
- File name: `*.test.ts`, `*.test.tsx`, `*.test.js`, `*.test.jsx`
- File name: `*.spec.ts`, `*.spec.tsx`, `*.spec.js`, `*.spec.jsx`

**Case sensitivity**: Case-insensitive (`/i` flag)

### TestFinder.isTestFile()

**Location**: `src/analyzers/TestFinder.ts` (lines 152-155)

**Patterns**:
- `*.test.*` (any extension)
- `*.spec.*` (any extension)
- `test_*.*` (Python-style)
- `*_test.*` (Go-style)

**Case sensitivity**: Case-insensitive

### ProfessionalImpactAnalyzer.isTestFile()

**Location**: `src/analyzers/ProfessionalImpactAnalyzer.ts` (lines 1271-1281)

**Patterns**:
- `*.test.*`
- `*.spec.*`
- `/__tests__/`
- `/test/`
- `/tests/`

**Case sensitivity**: Case-sensitive (no `/i` flag)

## Why This Separation Matters

### 1. Different UI Sections
- **Downstream Files**: Shown as "⚠️ Risk: Depends on changed code"
- **Test Files**: Shown as "🧪 Affected Tests"

### 2. Different Metrics
- **Downstream Files**: Used for risk calculation, dependency analysis
- **Test Files**: Used for test time estimation, test coverage impact

### 3. Different Actions
- **Downstream Files**: User should review for compatibility
- **Test Files**: User should run tests to verify changes

### 4. Avoid Double-Counting
- Without separation, test files would appear in both sections
- Tests are special - they're both downstream (they import the code) AND tests (they test the code)

## Debug Logging

The extension logs the classification:

```typescript
log(`Filtered ${downstreamFiles.length} files: ${sourceDownstreamFilesWithLines.length} source files, ${testFilesFromDependencyAnalyzer.length} test files`);

// Detailed logging
downstreamFilesWithLines.forEach(item => {
    const normalized = item.file.replace(/\\/g, '/');
    const isTest = isTestFile(item.file);
    log(`  - ${normalized} (line ${item.lineNumber}) - ${isTest ? 'TEST' : 'SOURCE'}`);
});
```

**Example log output**:
```
[PureImpactAnalyzer] Filtered 4 files: 2 source files, 2 test files
[PureImpactAnalyzer] Downstream files found:
  - packages/ui/src/button.tsx (line 5) - SOURCE
  - packages/ui/src/button.test.tsx (line 1) - TEST
  - packages/ui/src/card.tsx (line 12) - SOURCE
  - tests/ui/card.spec.tsx (line 3) - TEST
```

## Key Design Decision

**Why filter tests from downstream files?**

1. **Semantic clarity**: Tests and source code serve different purposes
2. **UI organization**: Users expect tests in a separate section
3. **Metrics accuracy**: Test-specific metrics (time, coverage) shouldn't include source files
4. **Action clarity**: Different actions for tests (run) vs source (review)

## Potential Issues

### False Positives (Source File Classified as Test)

**Example**: `src/test-utils.ts` - contains "test" but is source code

**Current behavior**: ✅ Correctly classified as source (doesn't match `*.test.*` pattern)

**If it were misclassified**: Would appear in "Affected Tests" instead of "Downstream Impact"

### False Negatives (Test File Not Classified as Test)

**Example**: `src/utils.spec.tsx` - if pattern matching fails

**Current behavior**: ✅ Should match `*.spec.tsx` pattern

**If it were misclassified**: Would appear in "Downstream Impact" instead of "Affected Tests"

## Summary

The extension differentiates tests from downstream files using:

1. **File name patterns**: `*.test.*`, `*.spec.*`
2. **Directory patterns**: `/test/`, `/tests/`, `/__tests__/`
3. **Case-insensitive matching** (in most implementations)
4. **Post-processing filter**: After finding all dependent files, split them into two groups

This ensures:
- Tests appear in "Affected Tests" section
- Source files appear in "Downstream Impact" section
- No double-counting
- Accurate metrics and actions

