# Regression Test Changelog

## Enhanced Shape Verification

The test runner now performs detailed shape verification for sample symbols:

### Function Verification
- ✅ Type parameters count and names
- ✅ Overload count
- ✅ First overload details:
  - Parameter names, types, optionality
  - Return type

### Class Verification
- ✅ Type parameters
- ✅ Member count
- ✅ Constructor presence
- ✅ Key members (name, kind, visibility)

### Type/Interface Verification
- ✅ Type parameters
- ✅ Property count
- ✅ Key properties (name, type, optionality)

### Enum Verification
- ✅ Member count
- ✅ Key member names

### Variable Verification
- ✅ Type information

## New Regression Tests Added

1. **zod-v3-to-v4**: Type-heavy library with classes and type exports
2. **axios-0.27-to-1.0**: Default export + named exports, class-based
3. **lodash-es-4.17-to-4.18**: Function-heavy with many re-exports (marked skip)
4. **express-4.17-to-4.18**: Class-based with middleware (marked skip)
5. **typescript-4.9-to-5.0**: Type-heavy, complex API surface (marked skip)

Tests marked with `"skip": true` can be enabled after running and promoting their expected.json.

## Setup Script

New helper script for setting up regression tests:

```bash
npm run setup:regression <test-id>
```

This automates:
1. Running the regression
2. Promoting to expected.json
3. Verifying the test passes





