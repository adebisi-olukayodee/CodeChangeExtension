# Regression Testing Guide

## Quick Start

```bash
# Run all regressions
npm run regression

# Run a specific regression
npm run regression:date-fns

# Test against expected results
npm run test:regression:date-fns

# Promote actual to expected (after verifying output is correct)
npm run promote:expected date-fns-v2-to-v3
```

## Test Structure

Each regression test has:
- **config.json entry**: Defines repo, refs, paths, mode
- **expected.json**: Expected counts, sample symbols, assertions
- **actual.json**: Generated output (in `regressions/out/`)

## What Gets Tested

1. **Pinned refs**: Ensures same commits are tested
2. **Counts**: Exports diff and API diff counts
3. **Regression checks**: Breaking change detection flags
4. **Sample symbols**: Verifies specific symbols exist with correct shapes
5. **Shape bounds**: Ensures reasonable number of shapes built
6. **Breaking changes**: Verifies removed/modified exports are detected

## Adding New Tests

See `regressions/README.md` for detailed instructions.

## CI Integration

The GitHub Actions workflow (`.github/workflows/regression-tests.yml`) runs:
1. Compile regression runner
2. Run all regressions
3. Run test assertions
4. Upload artifacts

## Troubleshooting

### Test fails with path mismatches
- Paths are normalized to `<WORKSPACE>` in output
- Test runner extracts symbol names from identity strings
- If paths cause issues, regenerate expected.json

### Test fails with count mismatches
- This indicates a real change in the analyzer
- Verify the change is intentional
- If correct, promote: `npm run promote:expected <test-name>`

### Shapes built count is wrong
- Check `assertions.minShapesBuilt` and `maxShapesBuilt` in expected.json
- Adjust bounds if analyzer improvements change shape counts
- Promote after verification










