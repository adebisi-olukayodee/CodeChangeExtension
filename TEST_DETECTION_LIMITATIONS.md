# Test Detection Limitations: Non-Standard Naming

This document explains what happens when test files don't follow standard naming conventions and potential solutions.

## Current Limitation

**The extension currently relies ONLY on naming patterns and directory locations to identify test files.**

If a test file doesn't match these patterns, it will be **misclassified as a regular source file** and appear in "Downstream Impact" instead of "Affected Tests".

## Current Detection Methods

### What IS Detected (Current Implementation)

The extension identifies test files using:

1. **File Name Patterns**:
   - `*.test.ts`, `*.test.tsx`, `*.test.js`, `*.test.jsx`
   - `*.spec.ts`, `*.spec.tsx`, `*.spec.js`, `*.spec.jsx`
   - `test_*.ts` (Python-style)
   - `*_test.ts` (Go-style)

2. **Directory Patterns**:
   - Files in `/test/` directory
   - Files in `/tests/` directory
   - Files in `/__tests__/` directory

### What is NOT Detected (Current Limitation)

The extension does **NOT** use content-based detection. These test files would be misclassified:

- `src/utils.ts` (contains `describe()`, `it()`, `test()` but no `.test.` in name)
- `src/button.specs.ts` (note: `.specs.` not `.spec.`)
- `src/component-check.ts` (custom naming, but is a test file)
- `src/validation.ts` (test file with non-standard name)

## Impact of Misclassification

### If a Test File is Misclassified as Source:

1. **Wrong UI Section**: Appears in "Downstream Impact" instead of "Affected Tests"
2. **Wrong Metrics**: Counted as downstream file, not test file
3. **Wrong Actions**: User might review it instead of running it
4. **Missing from Test Count**: Not included in "X affected tests" count

### Example Scenario

**Project Structure**:
```
src/
  utils.ts          (source file)
  utils-check.ts    (test file - custom naming, contains describe/it)
  button.tsx        (source file)
  button.test.tsx   (test file - standard naming)
```

**Changed File**: `src/utils.ts`

**Current Behavior**:
- ✅ `button.test.tsx` → Correctly identified as test (matches `*.test.tsx`)
- ❌ `utils-check.ts` → **Misclassified as source** (doesn't match patterns)

**Result**:
- `utils-check.ts` appears in "Downstream Impact" section
- User might not realize it's a test file
- Test time estimation doesn't include it

## Potential Solutions

### Solution 1: Content-Based Detection (Recommended)

Add content analysis to detect test files by looking for test framework patterns:

```typescript
function isTestFileByContent(filePath: string, content: string): boolean {
    // Check for common test framework patterns
    const testPatterns = [
        /\bdescribe\s*\(/,           // Jest, Mocha, Vitest
        /\bit\s*\(/,                 // Jest, Mocha, Vitest
        /\btest\s*\(/,               // Jest, Vitest
        /\bexpect\s*\(/,             // Jest, Vitest
        /\bassert\s*\(/,            // Node.js assert, Chai
        /\bshould\s*\./,            // Chai
        /\bbeforeEach\s*\(/,        // Jest, Mocha
        /\bafterEach\s*\(/,         // Jest, Mocha
        /\bbeforeAll\s*\(/,         // Jest, Vitest
        /\bafterAll\s*\(/,          // Jest, Vitest
        /@Test\s*/,                 // Java JUnit
        /@org\.junit\.Test/,        // Java JUnit
        /def test_/,                // Python pytest
        /def test/,                  // Python unittest
        /\[Test\]/,                 // C# NUnit
        /\[Fact\]/,                 // C# xUnit
    ];
    
    return testPatterns.some(pattern => pattern.test(content));
}
```

**Implementation**:
```typescript
const isTestFile = (filePath: string): boolean => {
    const normalized = filePath.replace(/\\/g, '/');
    
    // First check naming patterns (fast)
    const nameMatch = (
        normalized.includes('/test/') ||
        normalized.includes('/tests/') ||
        normalized.includes('/__tests__/') ||
        /\.test\.(ts|tsx|js|jsx)$/i.test(normalized) ||
        /\.spec\.(ts|tsx|js|jsx)$/i.test(normalized)
    );
    
    if (nameMatch) return true;
    
    // Fallback: content-based detection (slower, but more accurate)
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return isTestFileByContent(filePath, content);
    } catch {
        return false;
    }
};
```

**Pros**:
- ✅ Catches test files with non-standard names
- ✅ Works with any test framework
- ✅ More accurate

**Cons**:
- ⚠️ Requires reading file content (slower)
- ⚠️ May have false positives (source files that use test-like patterns)

### Solution 2: Configuration-Based Patterns

Allow users to configure custom test file patterns:

```json
{
  "realtimeImpactAnalyzer.testFilePatterns": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/*-check.ts",      // Custom pattern
    "**/*-validation.ts", // Custom pattern
    "**/checks/**/*.ts"   // Custom directory
  ]
}
```

**Implementation**:
```typescript
private getTestPatterns(): RegExp[] {
    const config = vscode.workspace.getConfiguration('realtimeImpactAnalyzer');
    const customPatterns = config.get<string[]>('testFilePatterns', []);
    
    const defaultPatterns = [
        /\.test\.(ts|tsx|js|jsx)$/i,
        /\.spec\.(ts|tsx|js|jsx)$/i,
        // ... existing patterns
    ];
    
    // Convert glob patterns to regex
    const customRegex = customPatterns.map(pattern => {
        const regex = pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\./g, '\\.');
        return new RegExp(regex, 'i');
    });
    
    return [...defaultPatterns, ...customRegex];
}
```

**Pros**:
- ✅ Flexible for different project conventions
- ✅ No performance impact (still pattern-based)
- ✅ User-configurable

**Cons**:
- ⚠️ Requires user configuration
- ⚠️ Still misses files that don't match any pattern

### Solution 3: Hybrid Approach (Best)

Combine all three methods:

1. **Fast path**: Check naming patterns first (most common case)
2. **Medium path**: Check content patterns (for non-standard names)
3. **Config path**: Check user-configured patterns

```typescript
const isTestFile = (filePath: string): boolean => {
    const normalized = filePath.replace(/\\/g, '/');
    
    // 1. Fast: Check naming patterns
    if (this.matchesTestNamePattern(normalized)) {
        return true;
    }
    
    // 2. Medium: Check user-configured patterns
    if (this.matchesCustomPatterns(normalized)) {
        return true;
    }
    
    // 3. Slow: Check content (only if first two fail)
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (this.matchesTestContentPatterns(content)) {
            return true;
        }
    } catch {
        // Can't read file, skip content check
    }
    
    return false;
};
```

## Recommended Implementation

### Step 1: Add Content-Based Detection

**File**: `src/core/PureImpactAnalyzer.ts`

```typescript
// Add helper function
function isTestFileByContent(content: string): boolean {
    const testPatterns = [
        /\bdescribe\s*\(/i,           // Jest, Mocha, Vitest
        /\bit\s*\(/i,                 // Jest, Mocha, Vitest
        /\btest\s*\(/i,               // Jest, Vitest
        /\bexpect\s*\(/i,             // Jest, Vitest
        /\bassert\s*\(/i,             // Node.js assert, Chai
        /\bbeforeEach\s*\(/i,        // Jest, Mocha
        /\bafterEach\s*\(/i,         // Jest, Mocha
        /\bbeforeAll\s*\(/i,         // Jest, Vitest
        /\bafterAll\s*\(/i,          // Jest, Vitest
    ];
    
    // Need at least 2 test patterns to avoid false positives
    const matches = testPatterns.filter(p => p.test(content)).length;
    return matches >= 2;
}

// Update isTestFile function
const isTestFile = (filePath: string): boolean => {
    const normalized = filePath.replace(/\\/g, '/');
    
    // Fast path: Check naming patterns
    const nameMatch = (
        normalized.includes('/test/') ||
        normalized.includes('/tests/') ||
        normalized.includes('/__tests__/') ||
        /\.test\.(ts|tsx|js|jsx)$/i.test(normalized) ||
        /\.spec\.(ts|tsx|js|jsx)$/i.test(normalized)
    );
    
    if (nameMatch) return true;
    
    // Slow path: Check content (only if naming doesn't match)
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return isTestFileByContent(content);
    } catch {
        return false;
    }
};
```

### Step 2: Add Configuration (Optional)

**File**: `package.json`

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "realtimeImpactAnalyzer.testFilePatterns": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "default": [],
          "description": "Additional glob patterns for test files (e.g., ['**/*-check.ts', '**/checks/**/*.ts'])"
        },
        "realtimeImpactAnalyzer.enableContentBasedTestDetection": {
          "type": "boolean",
          "default": true,
          "description": "Enable content-based test file detection (slower but more accurate)"
        }
      }
    }
  }
}
```

## Performance Considerations

### Current Implementation (Naming Only)
- **Speed**: ⚡ Very fast (just regex on file path)
- **Accuracy**: ⚠️ Misses non-standard names

### With Content Detection
- **Speed**: 🐢 Slower (reads file content)
- **Accuracy**: ✅ Catches non-standard names

### Optimization Strategy

1. **Cache results**: Don't re-read files if already classified
2. **Lazy evaluation**: Only check content if naming doesn't match
3. **Early exit**: Return as soon as test pattern found
4. **Limit file size**: Skip content check for very large files (>100KB)

```typescript
const testFileCache = new Map<string, boolean>();

const isTestFile = (filePath: string): boolean => {
    // Check cache first
    if (testFileCache.has(filePath)) {
        return testFileCache.get(filePath)!;
    }
    
    const normalized = filePath.replace(/\\/g, '/');
    
    // Fast path: Check naming patterns
    const nameMatch = /* ... existing patterns ... */;
    if (nameMatch) {
        testFileCache.set(filePath, true);
        return true;
    }
    
    // Slow path: Check content (only if enabled and naming doesn't match)
    const config = vscode.workspace.getConfiguration('realtimeImpactAnalyzer');
    if (config.get('enableContentBasedTestDetection', true)) {
        try {
            const stat = fs.statSync(filePath);
            // Skip very large files
            if (stat.size > 100 * 1024) {
                testFileCache.set(filePath, false);
                return false;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            const isTest = isTestFileByContent(content);
            testFileCache.set(filePath, isTest);
            return isTest;
        } catch {
            testFileCache.set(filePath, false);
            return false;
        }
    }
    
    testFileCache.set(filePath, false);
    return false;
};
```

## Testing the Fix

### Test Cases

1. **Standard naming** (should work):
   - `button.test.tsx` → ✅ Test
   - `utils.spec.ts` → ✅ Test

2. **Non-standard naming** (currently fails, should work with fix):
   - `utils-check.ts` (contains `describe()`, `it()`) → ❌ Currently source, ✅ Should be test
   - `validation.ts` (contains `test()`, `expect()`) → ❌ Currently source, ✅ Should be test

3. **False positive prevention**:
   - `utils.ts` (contains `describe` in comment) → ✅ Should remain source
   - `test-helper.ts` (helper for tests, not a test) → ✅ Should remain source

## Summary

**Current State**: 
- ❌ Only detects test files by naming patterns
- ❌ Misses test files with non-standard names
- ❌ Misclassifies them as source files

**Recommended Fix**:
- ✅ Add content-based detection as fallback
- ✅ Check for test framework patterns (`describe`, `it`, `test`, `expect`)
- ✅ Use caching and lazy evaluation for performance
- ✅ Make it configurable

**Impact**:
- More accurate test detection
- Better user experience (tests in correct section)
- Accurate test metrics and counts

