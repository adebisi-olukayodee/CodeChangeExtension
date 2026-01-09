# Downstream File Detection Flow

This document explains step-by-step how downstream files are discovered and their line numbers are determined.

## Overview

When a file is changed, the extension needs to find:
1. **Which files import or depend on the changed file** (downstream files)
2. **Where in those files the dependency occurs** (line numbers for navigation)

## Step-by-Step Flow

### 1. Entry Point: `PureImpactAnalyzer.analyzeImpactWithDiff()`

**Location**: `src/core/PureImpactAnalyzer.ts`

**What happens**:
- Receives the changed file path (`afterFilePath`)
- Extracts impacted export names from `snapshotDiff.exportChanges`
- Calls `dependencyAnalyzer.findDownstreamComponentsWithLines()`

**Key code**:
```typescript
const impactedExportNames = new Set<string>();
// Collect from removed/modified exports
if (snapshotDiff.exportChanges.removed) { ... }
if (snapshotDiff.exportChanges.modified) { ... }

downstreamFilesWithLines = await dependencyAnalyzer.findDownstreamComponentsWithLines(
    afterFilePath,
    changedCodeAnalysis,
    Array.from(impactedExportNames), // or undefined if empty
    projectRoot
);
```

### 2. Find Downstream Files: `DependencyAnalyzer.findDownstreamComponents()`

**Location**: `src/analyzers/DependencyAnalyzer.ts`

**What happens**:
- **Step 2a**: Builds reverse import graph if not already built
  - Scans all TypeScript files in `projectRoot`
  - Parses imports using TypeScript AST (`parseImportsWithTS`)
  - Stores: `reverseDeps` (target file → Set of importers)
  - Stores: `importLineNumbers` (target file → Map of importer → line number, 0-based)

- **Step 2b**: Finds files that import the source file
  - Uses `reverseDeps.get(normalizedSource)` to get direct importers
  - Handles path normalization (forward/backward slashes, case sensitivity)
  - Finds transitive dependencies (files that import files that import the source)
  - Finds re-exporting files (barrel files that re-export changed symbols)

- **Step 2c**: Filters by symbol usage (if `impactedSymbols` provided)
  - Only includes files that actually use the changed symbols
  - Checks for named imports, default imports, namespace imports
  - Checks for actual usage in code (function calls, property access)

**Returns**: `Promise<string[]>` - Array of absolute file paths

### 3. Find Line Numbers: `DependencyAnalyzer.findDownstreamComponentsWithLines()`

**Location**: `src/analyzers/DependencyAnalyzer.ts`

**What happens**:
- Calls `findDownstreamComponents()` to get the list of downstream files
- For each file, tries to find the line number in this order:

  **Priority 1: Symbol Usage Line (AST-based)**
  - If `impactedSymbols` provided, tries `findFirstSymbolUsageLine()`
  - Parses file with TypeScript AST
  - Collects imported names and aliases (handles `import { cn as cx }`)
  - Finds first call expression: `cn(...)` or `cx(...)`
  - Finds property access: `utils.cn(...)`
  - Returns 0-based line number of first usage

  **Priority 2: Symbol Usage Line (Text-based fallback)**
  - If AST doesn't find it, uses `findFirstLineByText()`
  - Simple regex search for symbol name
  - Returns 0-based line number

  **Priority 3: Import Line**
  - Falls back to `getImportLineNumber()`
  - Looks up in `importLineNumbers` map (from graph building)
  - Returns 0-based line number of import statement

- **Always includes the file**, even if line number is unknown
  - Uses `-1` as sentinel for "unknown line"
  - Valid line numbers: `>= 0` (0-based)
  - Invalid/unknown: `-1`

**Returns**: `Promise<Array<{ file: string; lineNumber: number }>>`
- `lineNumber` is 0-based
- `-1` means "unknown line" (file can still be opened, just not navigated to a line)

### 4. Store Line Numbers: `PureImpactAnalyzer`

**Location**: `src/core/PureImpactAnalyzer.ts`

**What happens**:
- Receives `downstreamFilesWithLines` from step 3
- Filters out test files (separate handling)
- Converts to relative paths
- Stores in `downstreamFilesMap` (only valid line numbers `>= 0`)
  - Files with `-1` are NOT stored in the map
  - UI will handle `-1` separately

**Key code**:
```typescript
const downstreamFilesMap: Record<string, number> = {};
for (const item of relativeDownstreamFiles) {
    if (item.lineNumber >= 0) {
        downstreamFilesMap[item.file] = item.lineNumber; // Only store valid lines
    }
}
(report as any).downstreamFilesLineNumbers = downstreamFilesMap;
```

### 5. Display in UI: `SimpleImpactViewProvider.extractBreakingIssues()`

**Location**: `src/ui/SimpleImpactViewProvider.ts`

**What happens**:
- Reads `result.downstreamFilesLineNumbers` (from step 4)
- For each downstream file:
  - Tries to find line number in map (exact match, normalized paths)
  - Falls back to `findImportLine()` if not in map
  - Uses `-1` if still not found

- Creates breaking issue with:
  - `line: importLine !== undefined ? importLine : -1`
  - `file: absoluteComponentPath`

- **UI Display**:
  - If `line >= 0`: Shows `"Line X: Depends on changed code"`
  - If `line < 0`: Shows `"Depends on changed code (filename.tsx)"`

- **File Opening**:
  - If `line >= 0`: Opens file and navigates to line
  - If `line < 0`: Opens file but doesn't navigate (no line navigation)

## Key Data Structures

### `reverseDeps: Map<string, Set<string>>`
- Key: Target file path (normalized)
- Value: Set of files that import the target
- Example: `"C:/project/src/index.ts" → Set(["C:/project/src/button.tsx", "C:/project/src/card.tsx"])`

### `importLineNumbers: Map<string, Map<string, number>>`
- Key: Target file path (normalized)
- Value: Map of importer file → line number (0-based)
- Example: `"C:/project/src/index.ts" → Map(["C:/project/src/button.tsx" → 5])`

### `downstreamFilesLineNumbers: Record<string, number>`
- Key: Relative file path (from project root)
- Value: Line number (0-based, `>= 0` only)
- Example: `{ "src/button.tsx": 5, "src/card.tsx": 12 }`
- Note: Files with unknown lines (`-1`) are NOT stored here

## Line Number Conventions

- **Storage**: 0-based (line 0 = first line)
- **Display**: 1-based (add 1 for user: "Line 1", "Line 2", etc.)
- **Unknown**: `-1` (sentinel value)
- **Valid range**: `>= 0`

## Troubleshooting

### No downstream files found?

1. **Check project root**: Ensure `projectRoot` is correct (should be Git root or workspace folder)
2. **Check reverse graph**: Look for `[DependencyAnalyzer] Reverse graph built: X files have importers`
3. **Check path matching**: Paths must match exactly (normalization handles slashes, but case matters on some systems)
4. **Check symbol filtering**: If `impactedSymbols` provided, files must actually use those symbols

### Line numbers are -1 (unknown)?

1. **Check import parsing**: Look for `[DependencyAnalyzer] STORED line number` logs
2. **Check symbol usage detection**: AST-based detection requires valid TypeScript syntax
3. **Check file content**: File must be readable and parseable
4. **Check compiler options**: `tsconfig.json` must be found and parsed correctly

### Line numbers are 0?

- **Line 0 is valid!** It means the import/usage is on the first line
- Check if it's actually line 0 or if it's a lookup failure (should be `-1` if not found)

## Debug Logging

Key log messages to look for:

- `[DependencyAnalyzer] ========== findDownstreamComponents CALLED ==========`
- `[DependencyAnalyzer] Reverse graph built: X files have importers`
- `[DependencyAnalyzer] findDownstreamComponentsWithLines: Found X downstream files`
- `[DownstreamLine] path/to/file.tsx: computed=X stored=true/false`
- `[PureImpactAnalyzer] Stored X/Y downstream files with valid line numbers`

