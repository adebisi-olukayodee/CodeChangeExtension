# Test Framework Detection Implementation

This document explains how the extension detects test frameworks from the repository and uses that information to improve test file detection.

## Overview

The extension now automatically detects which test framework is used in the repository and uses framework-specific patterns for content-based test file detection. This improves accuracy for test files with non-standard naming conventions.

## Detection Order (Priority)

The detection follows this order of truth:

1. **package.json scripts** (highest confidence)
   - Checks: `test`, `test:unit`, `test:ci`, `test:watch`, `test:coverage`
   - Looks for framework names in script commands

2. **devDependencies** (medium confidence)
   - Checks: `vitest`, `jest`, `@jest/core`, `jest-cli`, `mocha`, `ava`, `playwright`, `cypress`
   - Also checks `dependencies` as fallback

3. **Config files** (low confidence, but confirms)
   - Checks: `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `cypress.config.*`, `mocha.opts`, `.mocharc.*`, `ava.config.*`

## Implementation

### TestFrameworkDetector Class

**Location**: `src/utils/TestFrameworkDetector.ts`

**Key Methods**:
- `detect(projectRoot: string): TestFrameworkInfo` - Main detection method
- `getTestPatterns(framework: TestFramework): RegExp[]` - Get framework-specific patterns
- `clearCache(projectRoot?: string): void` - Clear detection cache

**Supported Frameworks**:
- `vitest`
- `jest`
- `mocha`
- `ava`
- `playwright`
- `cypress`
- `unknown` (fallback)

### Framework-Specific Patterns

Each framework has specific test patterns:

#### Vitest/Jest
```typescript
/\bdescribe\s*\(/i
/\bit\s*\(/i
/\btest\s*\(/i
/\bexpect\s*\(/i
/\bbeforeEach\s*\(/i
/\bafterEach\s*\(/i
/\bbeforeAll\s*\(/i
/\bafterAll\s*\(/i
```

#### Mocha
```typescript
/\bdescribe\s*\(/i
/\bit\s*\(/i
/\bbeforeEach\s*\(/i
/\bafterEach\s*\(/i
/\bbefore\s*\(/i
/\bafter\s*\(/i
```

#### Ava
```typescript
/\btest\s*\(/i
/\btest\.(serial|skip|only|todo)\s*\(/i
```

#### Playwright
```typescript
/\btest\s*\(/i
/\bexpect\s*\(/i
/\btest\.(describe|only|skip)\s*\(/i
```

#### Cypress
```typescript
/\bdescribe\s*\(/i
/\bit\s*\(/i
/\bcy\.(visit|get|click|type)\s*\(/i
```

## Integration Points

### 1. PureImpactAnalyzer

**Location**: `src/core/PureImpactAnalyzer.ts`

**What it does**:
- Detects test framework at the start of analysis
- Uses framework-specific patterns for content-based test file detection
- Logs detection results for debugging

**Code**:
```typescript
// Detect test framework from repository
const { TestFrameworkDetector } = require('../utils/TestFrameworkDetector');
const testFrameworkDetector = new TestFrameworkDetector();
const testFrameworkInfo = testFrameworkDetector.detect(projectRoot);

// Use in isTestFile function
if (testFrameworkInfo.framework !== 'unknown') {
    const testPatterns = testFrameworkDetector.getTestPatterns(testFrameworkInfo.framework);
    const matches = testPatterns.filter((p: RegExp) => p.test(content)).length;
    if (matches >= 2) {
        return true; // Classified as test file
    }
}
```

### 2. TestFinder

**Location**: `src/analyzers/TestFinder.ts`

**What it does**:
- Detects test framework when finding affected tests
- Uses framework-specific patterns for better test file identification
- Improves accuracy for non-standard test file names

**Code**:
```typescript
// Detect test framework for better content-based detection
const testFrameworkInfo = this.testFrameworkDetector.detect(workspacePath);

// Use in isTestFile method
if (testFrameworkInfo.framework !== 'unknown') {
    const testPatterns = this.testFrameworkDetector.getTestPatterns(testFrameworkInfo.framework);
    const matches = testPatterns.filter((p: RegExp) => p.test(content)).length;
    if (matches >= 2) {
        return true;
    }
}
```

## Example Detection

### Example 1: Vitest Project

**package.json**:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^1.0.0"
  }
}
```

**Detection Result**:
```typescript
{
  framework: 'vitest',
  confidence: 'high',
  evidence: [
    'package.json script "test": vitest run',
    'package.json dependencies: vitest'
  ]
}
```

**Test Patterns Used**: Vitest/Jest patterns (describe, it, test, expect, etc.)

### Example 2: Jest Project

**package.json**:
```json
{
  "scripts": {
    "test": "jest"
  },
  "devDependencies": {
    "@jest/core": "^29.0.0",
    "jest": "^29.0.0"
  }
}
```

**Files**:
- `jest.config.js` exists

**Detection Result**:
```typescript
{
  framework: 'jest',
  confidence: 'high',
  evidence: [
    'package.json script "test": jest',
    'package.json dependencies: @jest/core, jest',
    'Config files: jest.config.js'
  ]
}
```

### Example 3: Unknown Framework

**package.json**:
```json
{
  "scripts": {
    "test": "node test-runner.js"
  }
}
```

**Detection Result**:
```typescript
{
  framework: 'unknown',
  confidence: 'low',
  evidence: []
}
```

**Fallback**: Uses generic test patterns (describe, it, test, expect)

## Benefits

### 1. Improved Accuracy

- **Before**: Only detected test files by naming patterns
- **After**: Also detects test files by content using framework-specific patterns

### 2. Framework-Aware Detection

- Uses patterns specific to the detected framework
- Reduces false positives (e.g., won't look for `cy.visit()` in a Jest project)

### 3. Better Non-Standard Naming Support

- Catches test files like `utils-check.ts` (contains `describe()`, `it()`)
- Works even if file doesn't match `*.test.*` or `*.spec.*` patterns

### 4. Performance

- Caches detection results (only detects once per project root)
- Fast path: Checks naming patterns first (most common case)
- Slow path: Only checks content if naming doesn't match

## Debug Logging

The extension logs detection results:

```
[PureImpactAnalyzer] Detected test framework: vitest (confidence: high)
[PureImpactAnalyzer] Test framework evidence: package.json script "test": vitest run; package.json dependencies: vitest
[PureImpactAnalyzer] File classified as test (content, vitest): src/utils-check.ts
```

## Configuration

Currently, framework detection is automatic and not configurable. Future enhancements could include:

- User override for framework detection
- Custom test patterns per framework
- Support for additional frameworks

## Testing

### Test Cases

1. **Vitest project**: Should detect `vitest` from scripts and dependencies
2. **Jest project**: Should detect `jest` from scripts, dependencies, and config
3. **Mocha project**: Should detect `mocha` from dependencies
4. **Unknown framework**: Should fall back to generic patterns
5. **Multiple frameworks**: Should prioritize based on detection order

### Manual Testing

1. Create a test file with non-standard name: `src/utils-check.ts`
2. Add test framework code: `describe('utils', () => { it('works', () => { expect(true).toBe(true); }); });`
3. Run analysis on a changed file
4. Verify `utils-check.ts` is classified as test (not source)

## Summary

The test framework detection feature:

- ✅ Automatically detects test framework from repository
- ✅ Uses framework-specific patterns for content-based detection
- ✅ Improves accuracy for non-standard test file names
- ✅ Caches results for performance
- ✅ Falls back gracefully if framework unknown
- ✅ Integrates with both `PureImpactAnalyzer` and `TestFinder`

This makes test file detection more robust and accurate, especially for projects with non-standard naming conventions.

