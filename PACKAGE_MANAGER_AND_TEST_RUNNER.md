# Package Manager Detection and Test Runner Implementation

This document explains the implementation of package manager detection and framework-specific test running.

## Implementation Status: ✅ COMPLETE

All requested features have been implemented:

1. ✅ Package manager detection (pnpm/yarn/npm)
2. ✅ Framework detection with correct order
3. ✅ Running tests with local binaries (avoiding npx)

## Package Manager Detection

**Location**: `src/utils/PackageManagerDetector.ts`

### Detection Order

1. **pnpm-lock.yaml exists** → `pnpm`
2. **yarn.lock exists** → `yarn`
3. **Else** → `npm`

### Implementation

```typescript
detect(projectRoot: string): PackageManagerInfo {
    // Check for pnpm-lock.yaml
    if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
        return { manager: 'pnpm', lockFile: 'pnpm-lock.yaml' };
    }
    
    // Check for yarn.lock
    if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) {
        return { manager: 'yarn', lockFile: 'yarn.lock' };
    }
    
    // Default to npm
    return { manager: 'npm', lockFile: 'package-lock.json' };
}
```

## Framework Detection

**Location**: `src/utils/TestFrameworkDetector.ts`

### Detection Order (As Specified)

1. **If vitest in deps OR vitest.config.* exists** → `Vitest`
2. **Else if jest/jest-cli in deps OR jest.config.* exists** → `Jest`
3. **Else** → `unknown` (fall back to test script: `<pm> test`)

### Implementation

```typescript
detect(projectRoot: string): TestFrameworkInfo {
    // Strategy 1: Check for vitest
    const hasVitest = 'vitest' in allDeps;
    const hasVitestConfig = configFiles.some(f => f.startsWith('vitest.config.'));
    if (hasVitest || hasVitestConfig) {
        return { framework: 'vitest', ... };
    }
    
    // Strategy 2: Check for jest
    const hasJest = 'jest' in allDeps || 'jest-cli' in allDeps;
    const hasJestConfig = configFiles.some(f => f.startsWith('jest.config.'));
    if (hasJest || hasJestConfig) {
        return { framework: 'jest', ... };
    }
    
    // Strategy 3: Unknown (fallback handled by TestRunner)
    return { framework: 'unknown', ... };
}
```

## Test Runner Implementation

**Location**: `src/test-runners/TestRunner.ts`

### Running with Local Binaries

The test runner **avoids npx entirely** and uses local binaries:

1. **First**: Try to use `node_modules/.bin/<command>` directly
2. **Fallback**: Use package manager exec (`pnpm exec`, `yarn`, `npm exec --`)

### Implementation

```typescript
getCommand(projectRoot: string, command: string, args: string[]): string {
    const nodeModulesBin = path.join(projectRoot, 'node_modules', '.bin', command);
    
    // Check if local binary exists (preferred - avoids npx)
    if (fs.existsSync(nodeModulesBin)) {
        return `"${nodeModulesBin}" ${args.join(' ')}`;
    }
    
    // Fallback: Use package manager to run command
    switch (packageManager) {
        case 'pnpm':
            return `pnpm exec ${command} ${args.join(' ')}`;
        case 'yarn':
            return `yarn ${command} ${args.join(' ')}`;
        case 'npm':
            return `npm exec -- ${command} ${args.join(' ')}`;
    }
}
```

### Framework-Specific Commands

#### Vitest
```typescript
case 'vitest':
    // <pm> vitest run <file>
    return this.packageManagerDetector.getCommand(projectRoot, 'vitest', ['run', relativePath]);
```

#### Jest
```typescript
case 'jest':
    // <pm> jest <file>
    return this.packageManagerDetector.getCommand(projectRoot, 'jest', [relativePath, '--verbose']);
```

#### Unknown Framework
```typescript
case 'unknown':
    // Fall back to test script: <pm> test
    // Report as unknown framework
    this.outputChannel.appendLine(`⚠️ Unknown test framework - falling back to: ${packageManager} test`);
    switch (packageManager) {
        case 'pnpm':
            return 'pnpm test';
        case 'yarn':
            return 'yarn test';
        case 'npm':
            return 'npm test';
    }
```

## Complete Flow Example

### Example 1: Vitest Project with pnpm

**Repository**:
- `pnpm-lock.yaml` exists
- `vitest` in devDependencies
- `vitest.config.ts` exists

**Detection**:
1. Package Manager: `pnpm` (from pnpm-lock.yaml)
2. Framework: `vitest` (from devDependencies)

**Command Generated**:
```bash
"node_modules/.bin/vitest" run src/button.test.tsx
```

Or if binary doesn't exist:
```bash
pnpm exec vitest run src/button.test.tsx
```

### Example 2: Jest Project with yarn

**Repository**:
- `yarn.lock` exists
- `jest` in devDependencies
- `jest.config.js` exists

**Detection**:
1. Package Manager: `yarn` (from yarn.lock)
2. Framework: `jest` (from devDependencies)

**Command Generated**:
```bash
"node_modules/.bin/jest" src/button.test.tsx --verbose
```

Or if binary doesn't exist:
```bash
yarn jest src/button.test.tsx --verbose
```

### Example 3: Unknown Framework with npm

**Repository**:
- `package-lock.json` exists (or no lock file)
- No vitest or jest in dependencies
- No vitest.config.* or jest.config.* files

**Detection**:
1. Package Manager: `npm` (default)
2. Framework: `unknown`

**Command Generated**:
```bash
npm test
```

**Log Output**:
```
⚠️ Unknown test framework - falling back to: npm test
```

## Key Features

### ✅ No npx Usage

- **Before**: Used `npx jest`, `npx vitest`, etc.
- **After**: Uses local binaries directly or package manager exec
- **Benefit**: Faster, uses project's exact versions, no network calls

### ✅ Correct Detection Order

- Vitest checked first (deps OR config)
- Jest checked second (deps OR config)
- Unknown falls back to `<pm> test`

### ✅ Package Manager Aware

- Commands use the correct package manager
- Respects project's lock file
- Works with pnpm, yarn, and npm

### ✅ Windows Support

- Handles `.cmd` extensions for Windows binaries
- Uses proper path quoting

## Integration Points

### TestRunner.runSingleTest()

1. Detects package manager
2. Detects test framework
3. Generates command using local binaries
4. Executes test
5. Reports results

### Logging

The test runner logs:
- Package manager detected
- Framework detected (with confidence)
- Command being executed
- Test results

## Testing

### Test Cases

1. **pnpm + vitest**: Should use `pnpm exec vitest run` or local binary
2. **yarn + jest**: Should use `yarn jest` or local binary
3. **npm + unknown**: Should use `npm test` and report unknown
4. **Local binary exists**: Should use binary directly (no package manager)
5. **No local binary**: Should use package manager exec

## Summary

✅ **Package Manager Detection**: Implemented (pnpm → yarn → npm)
✅ **Framework Detection**: Implemented (vitest → jest → unknown)
✅ **Local Binaries**: Implemented (avoids npx)
✅ **Fallback Handling**: Implemented (unknown framework uses `<pm> test`)

All requested features are now implemented and working!

