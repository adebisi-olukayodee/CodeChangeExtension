# How Breaking Changes Are Generated

## Overview
The breaking change list is generated through a multi-step process that extracts breaking issues from analysis results and displays them in the UI.

## Flow Diagram

```
1. ProfessionalImpactAnalyzer.analyzeFile()
   └─> analyzeImpactWithDiff()
       └─> TypeScriptAnalyzer.diffSnapshots()
           └─> Creates snapshotDiff with:
               - changedSymbols[] (functions, classes, interfaces, types)
               - exportChanges.removed[] (removed exports)
               - exportChanges.modified[] (modified exports)
               └─> Returns to ProfessionalImpactAnalyzer
                   └─> Attaches snapshotDiff to ImpactAnalysisResult
                       └─> Returns result to UI

2. SimpleImpactViewProvider.getRootItems()
   └─> Calls extractBreakingIssues(result)
       └─> Checks snapshotDiff.exportChanges.removed
       └─> Checks snapshotDiff.exportChanges.modified
       └─> Checks result.changedFunctions
       └─> Checks result.changedClasses
       └─> Checks result.downstreamComponents
       └─> Checks result.affectedTests
       └─> Returns breakingIssues[]

3. SimpleImpactViewProvider.getRootItems() (continued)
   └─> Creates "🚨 What Will Break" tree item
       └─> Sets analysisResult = { breakingIssues, result }
       └─> User expands this item

4. SimpleImpactViewProvider.getDetailItems()
   └─> Called when user expands "What Will Break"
   └─> detailElement.type === 'breaking-issues'
   └─> Reads context.breakingIssues from analysisResult
   └─> Groups by category
   └─> Creates category items (e.g., "Export Removal (1)")

5. SimpleImpactViewProvider.getDetailItems() (continued)
   └─> User expands category (e.g., "Export Removal")
   └─> detailElement.type === 'breaking-category'
   └─> Reads context.issues from analysisResult
   └─> Creates individual issue items

6. SimpleImpactViewProvider.getDetailItems() (continued)
   └─> User clicks on individual issue
   └─> detailElement.type === 'breaking-issue'
   └─> Shows recommended fixes
```

## Key Files

### 1. `src/core/ProfessionalImpactAnalyzer.ts`
- **Line 791-802**: Gets `snapshotDiff` from `analyzeImpactWithDiff()`
- **Line 888**: Attaches `snapshotDiff` to `ImpactAnalysisResult`
- **Line 891-900**: Debug logging for `snapshotDiff` attachment

### 2. `src/ui/SimpleImpactViewProvider.ts`
- **Line 201**: Calls `extractBreakingIssues(result)` in `getRootItems()`
- **Line 362-404**: `extractBreakingIssues()` method:
  - **Line 366**: Gets `snapshotDiff` from result
  - **Line 367-385**: Checks `snapshotDiff.exportChanges.removed` (NEW - for export removals)
  - **Line 388-404**: Checks `snapshotDiff.exportChanges.modified` (NEW - for export modifications)
  - **Line 407-434**: Checks `confidenceResult.metrics` (legacy)
  - **Line 435-500**: Checks `downstreamComponents` (downstream impact)
  - **Line 502-520**: Checks `affectedTests` (test impact)
  - **Line 530-580**: Checks `changedFunctions` and `changedClasses` (API breaking changes)
- **Line 709-755**: Handles `breaking-issues` type in `getDetailItems()`
- **Line 756-878**: Handles `breaking-category` type (shows issues grouped by category)
- **Line 984-1146**: Handles `breaking-issue` type (shows recommended fixes)

### 3. `src/analyzers/language/TypeScriptAnalyzer.ts`
- **Line 1567**: Calls `compareExports()` to detect export changes
- **Line 2392-2518**: `compareExports()` method creates `exportChanges.removed[]` and `exportChanges.modified[]`

## Current Issue

The export removal is detected (logs show "1 removed exports"), but it's not appearing in the UI because:

1. ✅ `snapshotDiff` is created with `exportChanges.removed`
2. ✅ `snapshotDiff` is attached to `ImpactAnalysisResult`
3. ❓ `extractBreakingIssues()` may not be receiving `snapshotDiff` in the result
4. ❓ Or `extractBreakingIssues()` is not being called
5. ❓ Or the breaking issues are created but not displayed

## Debug Steps

1. Check if `snapshotDiff` is attached:
   - Look for: `[ProfessionalImpactAnalyzer] ✅ snapshotDiff attached to result`
   - Look for: `[ProfessionalImpactAnalyzer]    exportChanges.removed: 1`

2. Check if `extractBreakingIssues` is called:
   - Look for: `[SimpleImpactViewProvider] extractBreakingIssues: snapshotDiff exists: true/false`
   - Look for: `[SimpleImpactViewProvider] extractBreakingIssues: exportChanges.removed length: 1`

3. Check if breaking issues are created:
   - Look for: `[SimpleImpactViewProvider] extractBreakingIssues: Processing 1 removed exports`
   - Look for: `[SimpleImpactViewProvider] extractBreakingIssues: Adding breaking issue for removed export: AxiosRequestTransformer`

4. Check if breaking issues are displayed:
   - The "🚨 What Will Break" item should show count > 0
   - Expanding it should show "Export Removal (1)" category

## Expected Behavior

When an export is removed:
1. `TypeScriptAnalyzer.compareExports()` detects it → adds to `exportChanges.removed[]`
2. `snapshotDiff` is attached to `ImpactAnalysisResult`
3. `extractBreakingIssues()` reads `snapshotDiff.exportChanges.removed`
4. Creates breaking issue with:
   - `severity: '🚨 Breaking Change'`
   - `message: "Export 'AxiosRequestTransformer' was removed"`
   - `category: 'Export Removal'`
   - `line: <export line number>`
5. UI displays it under "🚨 What Will Break" → "Export Removal (1)"

## Fix Applied

Added code to `extractBreakingIssues()` to check `snapshotDiff.exportChanges.removed` FIRST (before other checks), ensuring export removals are always included in breaking issues, even when there are no changed functions/classes/types.


