# How Breaking Change Types Are Determined

This document explains how the analyzer determines **what type** of breaking change occurred based on **what really changed** in the code.

---

## Change Type Categories

The `changeType` field in `SymbolChange` can be one of:
- `'added'` - Symbol was added
- `'removed'` - Symbol was completely removed
- `'modified'` - Symbol exists but was modified (further categorized as signature-changed or type-changed)
- `'signature-changed'` - Function/interface signature changed (parameters, call signatures)
- `'type-changed'` - Type information changed (return type, property type, parameter type)

---

## Detection Hierarchy

### Level 1: Symbol Addition/Removal (`compareSymbols`)

**Location**: `TypeScriptAnalyzer.compareSymbols()`

**Determines**: If a symbol was added or removed entirely.

**Logic**:
```typescript
// Added symbol
if (symbol in afterMap but not in beforeMap) {
    changeType = 'added'
    isBreaking = symbol.isExported  // Only breaking if exported
}

// Removed symbol  
if (symbol in beforeMap but not in afterMap) {
    changeType = 'removed'
    isBreaking = symbol.isExported  // Only breaking if exported
}
```

**Examples**:
- `export function newFunc() {}` added → `changeType: 'added'`
- `export function oldFunc() {}` removed → `changeType: 'removed'`

---

### Level 2: Symbol Modification Detection

If a symbol exists in both before and after, the analyzer calls specific detection methods in **priority order**:

#### 2.1 Parameter-Level Breaking Changes (`detectParameterBreakingChange`)

**Location**: `TypeScriptAnalyzer.detectParameterBreakingChange()`

**Checks for**:
1. **Parameter optionality change** (optional → required)
2. **Parameter removal**
3. **Parameter type change**
4. **Return type change**
5. **Rest parameter changes**
6. **Parameter count changes**

**Determines `changeType`**:

| What Changed | changeType | ruleId | Example |
|--------------|------------|--------|---------|
| Parameter optional → required | `'signature-changed'` | `TSAPI-FN-001` | `(x?: string)` → `(x: string)` |
| Parameter removed | `'signature-changed'` | `TSAPI-FN-002` | `(x, y)` → `(x)` |
| Parameter type changed | `'type-changed'` | `TSAPI-FN-003` | `(x: string)` → `(x: number)` |
| Return type changed | `'type-changed'` | `TSAPI-FN-004` | `(): string` → `(): number` |
| Rest parameter removed | `'signature-changed'` | `TSAPI-FN-005` | `(...args)` → `(x, y)` |
| All parameters removed | `'signature-changed'` | `TSAPI-FN-002` | `(x, y)` → `()` |

**Code Flow**:
```typescript
// Priority 1: Parameter count/rest changes
if (beforeParamCount !== afterParamCount) {
    return { changeType: 'signature-changed', ... };
}

// Priority 2: Parameter removal
if (param in beforeParams but not in afterParams) {
    return { changeType: 'signature-changed', ruleId: 'TSAPI-FN-002', ... };
}

// Priority 3: Optionality change
if (beforeParam.optional && !afterParam.optional) {
    return { changeType: 'signature-changed', ruleId: 'TSAPI-FN-001', ... };
}

// Priority 4: Parameter type change
if (beforeParam.type !== afterParam.type) {
    return { changeType: 'type-changed', ruleId: 'TSAPI-FN-003', ... };
}

// Priority 5: Return type change
if (before.returnType !== after.returnType) {
    return { changeType: 'type-changed', ruleId: 'TSAPI-FN-004', ... };
}
```

---

#### 2.2 Property-Level Breaking Changes (`detectPropertyBreakingChange`)

**Location**: `TypeScriptAnalyzer.detectPropertyBreakingChange()`

**Checks for** (in priority order):

1. **Interface call signature changes** (highest priority)
2. **Index signature changes**
3. **Property removal**
4. **Property optionality change** (optional → required)
5. **Property type change**
6. **Method signature changes** (for interface methods)

**Determines `changeType`**:

| What Changed | changeType | ruleId | Example |
|--------------|------------|--------|---------|
| Call signature parameter optional → required | `'signature-changed'` | `TSAPI-FN-001` | `(x?: string)` → `(x: string)` in callable interface |
| Call signature removed | `'signature-changed'` | `TSAPI-IF-003` | Interface no longer callable |
| Call signature return type changed | `'type-changed'` | `TSAPI-FN-004` | Return type changed in callable interface |
| Index signature changed | `'type-changed'` | `TSAPI-IF-003` | `[key: string]: T` → `[key: number]: T` |
| Index signature removed | `'signature-changed'` | `TSAPI-IF-001` | Index signature removed |
| Property removed | `'signature-changed'` | `TSAPI-IF-001` | `prop?: string` removed |
| Property optional → required | `'signature-changed'` | `TSAPI-IF-002` | `prop?: string` → `prop: string` |
| Property type changed | `'type-changed'` | `TSAPI-IF-003` | `prop: string` → `prop: number` |
| Method parameter optional → required | `'signature-changed'` | `TSAPI-FN-001` | Method signature changed |
| Method return type changed | `'type-changed'` | `TSAPI-FN-004` | Method return type changed |

**Code Flow**:
```typescript
// Priority 1: Call signature (for callable interfaces)
if (beforeCallSig && afterCallSig) {
    // Check parameter optionality
    if (beforeParam.optional && !afterParam.optional) {
        return { changeType: 'signature-changed', ruleId: 'TSAPI-FN-001', ... };
    }
    // Check return type
    if (beforeCallSig.returnType !== afterCallSig.returnType) {
        return { changeType: 'type-changed', ruleId: 'TSAPI-FN-004', ... };
    }
}

// Priority 2: Index signatures
if (indexSignature changed) {
    return { changeType: 'type-changed', ... };
}

// Priority 3: Property removal
if (property in beforeProps but not in afterProps) {
    return { changeType: 'signature-changed', ruleId: 'TSAPI-IF-001', ... };
}

// Priority 4: Property optionality
if (beforeProp.isOptional && !afterProp.isOptional) {
    return { changeType: 'signature-changed', ruleId: 'TSAPI-IF-002', ... };
}

// Priority 5: Property type
if (beforeProp.type !== afterProp.type) {
    return { changeType: 'type-changed', ruleId: 'TSAPI-IF-003', ... };
}
```

---

#### 2.3 Class Method Changes (`detectClassMethodChange`)

**Location**: `TypeScriptAnalyzer.detectClassMethodChange()`

**Checks for**:
1. **Method removal**
2. **Method signature changes** (parameter optionality, removal, type)
3. **Return type changes**

**Determines `changeType`**:

| What Changed | changeType | ruleId | Example |
|--------------|------------|--------|---------|
| Method removed | `'signature-changed'` | `TSAPI-CLS-001` | `method()` removed from class |
| Method parameter optional → required | `'signature-changed'` | `TSAPI-FN-001` | `method(x?: string)` → `method(x: string)` |
| Method parameter removed | `'signature-changed'` | `TSAPI-FN-002` | `method(x, y)` → `method(x)` |
| Method return type changed | `'type-changed'` | `TSAPI-FN-004` | Return type changed |

---

### Level 3: Export-Level Changes (`compareExports`)

**Location**: `TypeScriptAnalyzer.compareExports()`

**Not stored in `changeType`** - instead tracked separately in `SnapshotDiff.exportChanges`:

| What Changed | Storage Location | Example |
|--------------|------------------|---------|
| Export removed | `exportChanges.removed[]` | `export interface X` → `interface X` |
| Export added | `exportChanges.added[]` | `interface X` → `export interface X` |
| Export signature changed | `exportChanges.modified[]` | `export { x } from './a'` → `export { y } from './a'` |
| Re-export source changed | `exportChanges.modified[]` | `export { x } from './a'` → `export { x } from './b'` |

**Note**: Export removals are **always** breaking changes, but they're not represented as `SymbolChange` with a `changeType`. Instead, they're in `exportChanges.removed[]` and flagged in the UI as "Export Removal" category.

---

## Change Type Determination Priority

When a symbol is modified, the analyzer checks in this order:

```
1. detectParameterBreakingChange() - Parameter-level changes
   ├─ Parameter optionality → 'signature-changed'
   ├─ Parameter removal → 'signature-changed'
   ├─ Parameter type → 'type-changed'
   └─ Return type → 'type-changed'

2. detectPropertyBreakingChange() - Property/interface changes
   ├─ Call signature changes → 'signature-changed' or 'type-changed'
   ├─ Index signature changes → 'type-changed'
   ├─ Property removal → 'signature-changed'
   ├─ Property optionality → 'signature-changed'
   └─ Property type → 'type-changed'

3. detectClassMethodChange() - Class method changes
   ├─ Method removal → 'signature-changed'
   ├─ Method parameter changes → 'signature-changed'
   └─ Method return type → 'type-changed'

4. Fallback: Signature comparison
   ├─ Signature text changed → 'signature-changed'
   └─ Return type changed → 'type-changed'
```

---

## Examples of Change Type Determination

### Example 1: Parameter Optionality Change
```typescript
// Before
export function transform(data: any, headers?: AxiosRequestHeaders): any;

// After  
export function transform(data: any, headers: AxiosRequestHeaders): any;
```

**Detection**:
1. `detectParameterBreakingChange()` finds `headers` parameter
2. Compares: `beforeParam.optional = true`, `afterParam.optional = false`
3. Returns: `{ changeType: 'signature-changed', ruleId: 'TSAPI-FN-001', message: "Parameter 'headers' changed from optional to required" }`

**Result**: `changeType: 'signature-changed'` (not `type-changed` because the type itself didn't change, just the optionality)

---

### Example 2: Return Type Change
```typescript
// Before
export function getData(): string;

// After
export function getData(): number;
```

**Detection**:
1. `detectParameterBreakingChange()` checks parameters (none in this case)
2. Checks return type: `before.returnType = 'string'`, `after.returnType = 'number'`
3. Returns: `{ changeType: 'type-changed', ruleId: 'TSAPI-FN-004', message: "Return type changed from 'string' to 'number'" }`

**Result**: `changeType: 'type-changed'` (the return type changed, not the signature structure)

---

### Example 3: Export Removal
```typescript
// Before
export interface AxiosRequestTransformer {
    (data: any, headers?: AxiosRequestHeaders): any;
}

// After
interface AxiosRequestTransformer {
    (data: any, headers?: AxiosRequestHeaders): any;
}
```

**Detection**:
1. `buildSnapshot()` captures exports separately from symbols
2. `compareExports()` finds `AxiosRequestTransformer` in before exports but not after
3. Adds to `exportChanges.removed[]` (not `changeType`)

**Result**: 
- `changeType`: Not set (export removal is tracked separately)
- `exportChanges.removed`: `[{ name: 'AxiosRequestTransformer', kind: 'interface', line: 8 }]`
- Category in UI: `'Export Removal'`

---

### Example 4: Interface Call Signature Parameter Change
```typescript
// Before
export interface Transformer {
    (data: any, headers?: AxiosRequestHeaders): any;
}

// After
export interface Transformer {
    (data: any, headers: AxiosRequestHeaders): any;
}
```

**Detection**:
1. `buildSnapshot()` extracts call signature: `{ parameters: [{ name: 'headers', optional: true }], returnType: 'any' }`
2. `detectPropertyBreakingChange()` finds call signature in both
3. Compares parameters: `beforeParam.optional = true`, `afterParam.optional = false`
4. Returns: `{ changeType: 'signature-changed', ruleId: 'TSAPI-FN-001', message: "Interface call signature parameter 'headers' changed from optional to required" }`

**Result**: `changeType: 'signature-changed'`

---

### Example 5: Property Removal
```typescript
// Before
export interface Config {
    baseURL?: string;
    timeout?: number;
}

// After
export interface Config {
    baseURL?: string;
}
```

**Detection**:
1. `detectPropertyBreakingChange()` compares properties
2. Finds `timeout` in `beforeProps` but not in `afterProps`
3. Returns: `{ changeType: 'signature-changed', ruleId: 'TSAPI-IF-001', message: "Property 'timeout' was removed" }`

**Result**: `changeType: 'signature-changed'` (signature changed because property count changed)

---

## Key Decision Points

### Signature-Changed vs Type-Changed

The distinction is:
- **`signature-changed`**: The **structure** or **contract** changed (parameters added/removed, optionality, callability)
- **`type-changed`**: The **type information** changed but structure is same (return type, property type, parameter type)

**Examples**:
- `(x?: string)` → `(x: string)` → **`signature-changed`** (contract changed - now required)
- `(x: string)` → `(x: number)` → **`type-changed`** (type changed but structure same)
- `(): string` → `(): number` → **`type-changed`** (return type changed)
- `method(x)` → `method()` → **`signature-changed`** (parameter removed - structure changed)

### Why Export Removals Aren't `changeType`

Export removals are tracked separately because:
- The **symbol itself** may still exist (just not exported)
- Export removal is **always** a breaking change (regardless of symbol existence)
- Export changes need special handling in UI (separate category)
- Export removals can suppress symbol-level changes (to avoid double-reporting)

---

## Rule IDs Mapping

Each breaking change gets a `ruleId` that maps to the change type:

| ruleId | changeType | What It Means |
|--------|------------|---------------|
| `TSAPI-FN-001` | `signature-changed` | Parameter optional → required |
| `TSAPI-FN-002` | `signature-changed` | Parameter removed |
| `TSAPI-FN-003` | `type-changed` | Parameter type changed |
| `TSAPI-FN-004` | `type-changed` | Return type changed |
| `TSAPI-FN-005` | `signature-changed` | Rest parameter changed |
| `TSAPI-IF-001` | `signature-changed` | Interface property removed |
| `TSAPI-IF-002` | `signature-changed` | Interface property optional → required |
| `TSAPI-IF-003` | `type-changed` / `signature-changed` | Interface property type changed / call signature removed |
| `TSAPI-CLS-001` | `signature-changed` | Class method removed |
| `TSAPI-TYPE-001` | `signature-changed` | Type alias property removed |
| `TSAPI-TYPE-002` | `type-changed` | Type alias definition changed |
| `TSAPI-TYPE-003` | `signature-changed` | Type alias property optional → required |
| `TSAPI-TYPE-004` | `type-changed` | Type alias property type changed |
| `TSAPI-EXP-001` | N/A (export level) | Export removed |

---

## Summary

**What determines the change type?**

1. **What changed structurally** → Determines if it's `signature-changed` (structure/contract)
2. **What changed in types** → Determines if it's `type-changed` (type information only)
3. **Whether symbol exists** → Determines if it's `added`, `removed`, or `modified`

**Priority order**:
1. Parameter-level changes (most specific)
2. Property/method-level changes (interface/class)
3. Signature-level comparison (fallback)
4. Export-level changes (tracked separately)

The analyzer uses **AST-based comparison** to determine exactly what changed, then categorizes it into the appropriate `changeType` based on the **semantic nature** of the change (structure vs. type).


