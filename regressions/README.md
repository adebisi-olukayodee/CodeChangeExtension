# Regression Tests

This directory contains regression tests that verify the TypeScript API analyzer correctly detects breaking changes in real-world libraries.

## Structure

```
regressions/
├── config.json                    # Configuration for all regression tests
├── date-fns-v2-to-v3/            # Individual test directory
│   └── expected.json             # Expected results (counts, sample symbols, assertions)
├── out/                          # Actual test outputs (git-ignored)
│   └── date-fns-v2-to-v3.actual.json
└── test-runner.mjs               # Test runner that compares actual vs expected
```

## Running Tests

### Run all regressions
```bash
npm run regression
```

### Run a specific regression
```bash
npm run regression:date-fns
```

### Test against expected results
```bash
npm run test:regression:date-fns
# or
npm run test:regression  # runs all tests
```

## Promoting Actual to Expected

When you've verified that the actual output is correct (e.g., after fixing a bug or improving the analyzer), promote it:

```bash
npm run promote:expected date-fns-v2-to-v3
```

This will:
1. Read `regressions/out/date-fns-v2-to-v3.actual.json`
2. Extract counts, sample symbols, and assertions
3. Write to `regressions/date-fns-v2-to-v3/expected.json`

## Adding a New Regression Test

### Quick Setup (Recommended)

Use the automated setup script:

```bash
# 1. Add entry to regressions/config.json (see below)
# 2. Run automated setup
npm run setup:regression my-test
```

This will:
- Run the regression
- Promote to expected.json
- Verify the test passes

### Manual Setup

1. Add entry to `regressions/config.json`:
   ```json
   {
     "id": "my-test",
     "url": "https://github.com/user/repo.git",
     "beforeRef": "v1.0.0",
     "afterRef": "v2.0.0",
     "mode": "api-snapshot",
     "paths": ["src/index.ts"],
     "tsconfig": "tsconfig.json",
     "description": "Description of what this test covers"
   }
   ```

2. Run the regression:
   ```bash
   npm run regression:my-test
   ```

3. Verify the output in `regressions/out/my-test.actual.json`

4. Promote to expected:
   ```bash
   npm run promote:expected my-test
   ```

5. Verify the test passes:
   ```bash
   npm run test:regression:my-test
   ```

### Skipping Tests

Add `"skip": true` to a test config to exclude it from runs:
```json
{
  "id": "my-test",
  "skip": true,
  ...
}
```

## Expected JSON Schema

```json
{
  "metadata": {
    "beforeSha": "full commit SHA",
    "afterSha": "full commit SHA",
    "testName": "test-id",
    "description": "Description of the test",
    "pinnedRefs": {
      "before": "short SHA or tag",
      "after": "short SHA or tag"
    }
  },
  "counts": {
    "exportsDiff": {
      "added": 74,
      "removed": 18,
      "changed": 0
    },
    "apiDiff": {
      "added": 242,
      "removed": 239,
      "modified": 0,
      "renamed": 0
    }
  },
  "regressionChecks": {
    "removedExportsDetected": true,
    "removedExportsCount": 239,
    "modifiedExportsCount": 0,
    "addedExportsCount": 242,
    "renamedExportsCount": 0,
    "hasBreakingChanges": true
  },
  "sampleSymbols": {
    "removed": [
      { 
        "name": "symbolName", 
        "kind": "function", 
        "shapeName": "...",
        "detailedShape": {
          "typeParameters": ["T"],
          "overloads": 2,
          "overloadDetails": [{
            "parameters": [
              { "name": "arg", "type": "string", "optional": false }
            ],
            "returnType": "Promise<T>"
          }]
        }
      }
    ],
    "added": [
      { 
        "name": "symbolName", 
        "kind": "function", 
        "shapeName": "...",
        "detailedShape": { ... }
      }
    ]
  },
  "assertions": {
    "minShapesBuilt": 200,
    "maxShapesBuilt": 300,
    "mustHaveRemovedExports": true,
    "mustHaveAddedExports": true
  }
}
```

## Test Assertions

The test runner verifies:

1. **Pinned refs match**: Ensures we're testing the same commits
2. **Counts match**: Exports diff and API diff counts must match expected
3. **Regression checks**: All regression check flags must match
4. **Sample symbols exist**: Verifies specific symbols are present in the diff
5. **Detailed shape verification**: For each sample symbol, verifies:
   - **Functions**: Type parameters, overload count, parameter types/names/optionality, return types
   - **Classes**: Type parameters, member count, constructor presence, member kinds/visibility
   - **Types/Interfaces**: Type parameters, property count, property types/optionality
   - **Enums**: Member count, specific member names
   - **Variables**: Type information
6. **Shape count bounds**: Ensures reasonable number of shapes were built
7. **Breaking changes detected**: Verifies removed/modified exports are detected

## Workspace Paths

By default, regression tests use `.regression-workspace/` in the repo root (not temp directories) for deterministic test runs. Set `REGRESSION_WORKSPACE` environment variable to override.

## CI Integration

Add to your CI workflow:

```yaml
- name: Run regression tests
  run: |
    npm install
    npm run compile:regression
    npm run regression
    npm run test:regression
```

