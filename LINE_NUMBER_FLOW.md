# Line Number Flow: How Import Line Numbers Are Fetched and Displayed

This document explains the complete flow of how line numbers for downstream file imports are captured, stored, and displayed in the UI.

---

## Overview

When a file is changed, the analyzer needs to:
1. **Find downstream files** that import the changed file
2. **Capture the line number** where each import statement occurs
3. **Store these line numbers** in a way that survives serialization
4. **Display them in the UI** so users can navigate directly to the import line

---

## Step-by-Step Flow

### Step 1: Building the Import Graph (`DependencyAnalyzer.buildReverseImportGraph`)

**Location**: `src/analyzers/DependencyAnalyzer.ts`

**What happens**:
1. Scans all TypeScript files in the project
2. For each file, parses import statements using `parseImportsWithTS()`
3. **Captures line numbers** when parsing imports:

```typescript
// In parseImportsWithTS()
const lines = content.split('\n');
// ... find import match ...
// Calculate line number from match index
let lineNumber = 1;
let charCount = 0;
for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= matchIndex) {
        lineNumber = i + 1; // 1-based line number
        break;
    }
    charCount += lines[i].length + 1;
}
```

4. Stores import info with line number:
```typescript
imports.push({
    from: filePath,        // File that imports
    to: resolvedPath,      // File being imported
    specifier: specifier,  // Original import specifier
    lineNumber: lineNumber // ← LINE NUMBER CAPTURED HERE
});
```

5. Builds reverse dependency graph and **stores line numbers**:
```typescript
// In buildReverseImportGraph()
for (const imp of imports) {
    // Store in reverseDeps (file -> Set<importers>)
    // AND store line number in importLineNumbers
    this.importLineNumbers.get(key)!.set(fromKey, imp.lineNumber);
}
```

**Data structure**: `importLineNumbers: Map<string, Map<string, number>>`
- Outer key: Target file path (file being imported)
- Inner key: Importer file path (file that imports)
- Value: Line number where import occurs

---

### Step 2: Finding Downstream Files with Line Numbers (`DependencyAnalyzer.findDownstreamComponentsWithLines`)

**Location**: `src/analyzers/DependencyAnalyzer.ts`

**What happens**:
1. Calls `findDownstreamComponents()` to get list of downstream files
2. For each downstream file, **retrieves the line number** from `importLineNumbers`:

```typescript
async findDownstreamComponentsWithLines(...): Promise<Array<{ file: string; lineNumber: number }>> {
    const files = await this.findDownstreamComponents(...);
    const normalizedSource = path.resolve(sourceFilePath).replace(/\\/g, '/');
    
    return files.map(file => {
        const lineNumber = this.getImportLineNumber(normalizedSource, file);
        return { file, lineNumber };
    });
}
```

3. `getImportLineNumber()` looks up the line number:
```typescript
getImportLineNumber(targetFile: string, importerFile: string): number {
    // Try multiple path variations (handle Windows/Unix path differences)
    const targetVariations = [normalized paths...];
    const importerVariations = [normalized paths...];
    
    for (const targetVar of targetVariations) {
        const lineMap = this.importLineNumbers.get(targetVar);
        if (lineMap) {
            for (const importerVar of importerVariations) {
                const lineNumber = lineMap.get(importerVar);
                if (lineNumber) return lineNumber;
            }
        }
    }
    return 0; // Not found
}
```

**Output**: `Array<{ file: string; lineNumber: number }>`
- Example: `[{ file: 'packages/app/src/components/Button.tsx', lineNumber: 5 }, ...]`

---

### Step 3: Storing Line Numbers in Report (`PureImpactAnalyzer.analyzeImpactWithDiff`)

**Location**: `src/core/PureImpactAnalyzer.ts`

**What happens**:
1. Calls `findDownstreamComponentsWithLines()` to get files with line numbers
2. Converts absolute paths to relative paths (for portability):
```typescript
const relativeDownstreamFiles = sourceDownstreamFilesWithLines.map(item => ({
    file: path.relative(projectRoot, item.file),
    lineNumber: item.lineNumber
}));
```

3. **Stores line numbers in a plain object** (not Map, for serialization compatibility):
```typescript
// Use plain object instead of Map for better serialization
const downstreamFilesMap: Record<string, number> = {};
for (const item of relativeDownstreamFiles) {
    downstreamFilesMap[item.file] = item.lineNumber;
    log(`Stored line number for ${item.file}: ${item.lineNumber}`);
}
```

4. Attaches to report:
```typescript
(report as any).downstreamFilesLineNumbers = downstreamFilesMap;
```

**Why plain object?**: Maps don't serialize to JSON properly. When data passes through VS Code extension APIs, it may be serialized/deserialized, which would lose Map structure.

**Data structure**: `downstreamFilesLineNumbers: Record<string, number>`
- Key: Relative file path (e.g., `"packages/app/src/components/Button.tsx"`)
- Value: Line number (e.g., `5`)

---

### Step 4: Passing Through to Result (`ProfessionalImpactAnalyzer.analyzeFile`)

**Location**: `src/core/ProfessionalImpactAnalyzer.ts`

**What happens**:
1. Receives report from `PureImpactAnalyzer`
2. Extracts `downstreamFilesLineNumbers` from report
3. Attaches to `ImpactAnalysisResult`:

```typescript
const result: ImpactAnalysisResult = {
    // ... other fields ...
    downstreamComponents: report.downstreamFiles, // Array of file paths
    downstreamFilesLineNumbers: (report as any).downstreamFilesLineNumbers // ← LINE NUMBERS PASSED HERE
};
```

**Interface definition**:
```typescript
export interface ImpactAnalysisResult {
    // ... other fields ...
    downstreamFilesLineNumbers?: Record<string, number>; // Map of file paths to line numbers
}
```

---

### Step 5: Retrieving Line Numbers in UI (`SimpleImpactViewProvider.extractBreakingIssues`)

**Location**: `src/ui/SimpleImpactViewProvider.ts`

**What happens**:
1. Gets downstream files from result:
```typescript
const uniqueDownstream: string[] = Array.from(
    new Set(result.downstreamComponents)
);
```

2. **Retrieves line numbers map** from result:
```typescript
const downstreamFilesLineNumbers = (result as any).downstreamFilesLineNumbers 
    as Record<string, number> | undefined;
```

3. For each downstream file, **looks up line number**:
```typescript
for (const component of uniqueDownstream) {
    let importLine = 0;
    
    if (downstreamFilesLineNumbers) {
        // Try exact match first
        importLine = downstreamFilesLineNumbers[component] || 0;
        
        // If not found, try normalized path matching (handle path separator differences)
        if (importLine === 0) {
            const normalizedComponent = component.replace(/\\/g, '/');
            for (const [key, lineNum] of Object.entries(downstreamFilesLineNumbers)) {
                const normalizedKey = key.replace(/\\/g, '/');
                if (normalizedKey === normalizedComponent) {
                    importLine = lineNum;
                    break;
                }
            }
        }
    }
    
    // Fallback to regex search if not found
    if (importLine === 0) {
        importLine = this.findImportLine(component, changedFilePath);
    }
    
    // Create breaking issue with line number
    breakingIssues.push({
        severity: '⚠️ Risk',
        message: `Depends on changed code: ${path.basename(component)}`,
        line: importLine, // ← LINE NUMBER USED HERE
        category: 'Downstream Impact',
        file: component,
        // ...
    });
}
```

**Path normalization**: Handles Windows vs Unix path separators (`\` vs `/`) by normalizing both the lookup key and map keys.

---

### Step 6: Displaying in UI (Tree View)

**Location**: `src/ui/SimpleImpactViewProvider.ts` (TreeDataProvider)

**What happens**:
1. `extractBreakingIssues()` returns array of issues with `line` property
2. Tree view displays these issues
3. When user clicks on an issue, VS Code opens the file at the specified line:

```typescript
// VS Code automatically handles navigation when issue has:
{
    file: 'packages/app/src/components/Button.tsx',
    line: 5  // ← Cursor navigates to this line
}
```

**How it works**: VS Code's TreeView API uses the `line` property to navigate when opening files from tree items.

---

## Debug Logging

Debug logs are added at each step to trace the flow:

1. **In `PureImpactAnalyzer`**:
   ```
   [PureImpactAnalyzer] Stored line number for packages/app/src/components/Button.tsx: 5
   [PureImpactAnalyzer] Stored 3 downstream files with line numbers
   ```

2. **In `SimpleImpactViewProvider`**:
   ```
   [SimpleImpactViewProvider] extractBreakingIssues: downstreamFilesLineNumbers exists: true
   [SimpleImpactViewProvider] extractBreakingIssues: Line numbers map has 3 entries
   [SimpleImpactViewProvider] extractBreakingIssues: Sample keys: packages/app/src/components/Button.tsx, ...
   [SimpleImpactViewProvider] extractBreakingIssues: ✅ Found line number for 'packages/app/src/components/Button.tsx': 5
   ```

---

## Troubleshooting

### Issue: Line numbers are always 0

**Possible causes**:
1. **Path mismatch**: Keys in `downstreamFilesLineNumbers` don't match `uniqueDownstream` paths
   - **Solution**: Check debug logs to see actual keys vs lookup keys
   - **Fix**: Path normalization handles most cases, but ensure paths are relative to project root

2. **Map not passed through**: `downstreamFilesLineNumbers` is undefined
   - **Solution**: Check if report has the property before attaching to result
   - **Fix**: Ensure `(report as any).downstreamFilesLineNumbers` is set in `PureImpactAnalyzer`

3. **Serialization loss**: Map was converted to object incorrectly
   - **Solution**: Use plain object (`Record<string, number>`) instead of Map
   - **Fix**: Already implemented - using plain object for serialization compatibility

### Issue: Line numbers are wrong

**Possible causes**:
1. **Multiple imports**: If a file imports the same module multiple times, only the first occurrence is stored
   - **Current behavior**: Stores the first (earliest) import line
   - **Future improvement**: Could store all import lines or the most relevant one

2. **Import statement spans multiple lines**: Line number points to start of import
   - **Current behavior**: Points to line where import statement starts
   - **This is correct**: VS Code will highlight the entire import statement

---

## Summary

**Flow Diagram**:
```
1. DependencyAnalyzer.buildReverseImportGraph()
   └─> Parses imports, captures line numbers
   └─> Stores in importLineNumbers Map

2. DependencyAnalyzer.findDownstreamComponentsWithLines()
   └─> Gets downstream files
   └─> Looks up line numbers from importLineNumbers
   └─> Returns Array<{ file, lineNumber }>

3. PureImpactAnalyzer.analyzeImpactWithDiff()
   └─> Converts to relative paths
   └─> Stores in plain object: Record<string, number>
   └─> Attaches to report.downstreamFilesLineNumbers

4. ProfessionalImpactAnalyzer.analyzeFile()
   └─> Extracts from report
   └─> Attaches to result.downstreamFilesLineNumbers

5. SimpleImpactViewProvider.extractBreakingIssues()
   └─> Retrieves from result
   └─> Looks up line number for each downstream file
   └─> Creates breaking issue with line property

6. VS Code Tree View
   └─> Displays issues
   └─> User clicks → Opens file at specified line
```

**Key Points**:
- Line numbers are captured during import graph building
- Stored as plain object (not Map) for serialization compatibility
- Path normalization handles Windows/Unix differences
- Fallback to regex search if line number not found
- Debug logging helps trace the flow


