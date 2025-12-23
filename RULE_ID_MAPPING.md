# Rule ID Mapping Flow

The rule ID mapping happens in **two stages**:

## Stage 1: Detection (TypeScriptAnalyzer)

When a breaking change is detected, `TypeScriptAnalyzer.detectParameterBreakingChange()` can set specific rule IDs in the `metadata` field:

```typescript
// In TypeScriptAnalyzer.ts (lines 988-1047)
detectParameterBreakingChange(before, after) {
    // Parameter removed → TSAPI-FN-002
    if (parameter was removed) {
        return { ruleId: 'TSAPI-FN-002', ... }
    }
    
    // Optional → Required → TSAPI-FN-001
    if (beforeParam.optional && !afterParam.optional) {
        return { ruleId: 'TSAPI-FN-001', ... }
    }
    
    // Parameter type changed → TSAPI-FN-003
    if (beforeParam.type !== afterParam.type) {
        return { ruleId: 'TSAPI-FN-003', ... }
    }
    
    // Return type changed → TSAPI-FN-004
    if (returnType changed) {
        return { ruleId: 'TSAPI-FN-004', ... }
    }
}
```

These rule IDs are stored in `change.metadata.ruleId`.

## Stage 2: Inference (EnhancedReportFormatter)

If no rule ID was set in metadata, `EnhancedReportFormatter.getRuleId()` infers it based on:

1. **Symbol Kind** (function, method, class, interface, type, enum)
2. **Change Type** (removed, signature-changed, type-changed)

### Mapping Table

| Symbol Kind | Change Type | Rule ID |
|------------|-------------|---------|
| `function` | `removed` | `TSAPI-FN-005` |
| `function` | `signature-changed` | `TSAPI-FN-006` |
| `function` | `type-changed` | `TSAPI-FN-004` |
| `method` | `removed` | `TSAPI-CLS-001` |
| `method` | `signature-changed` | `TSAPI-CLS-003` |
| `class` | `removed` | `TSAPI-CLS-004` |
| `interface` | `removed` | `TSAPI-IF-004` |
| `type` | `removed` | `TSAPI-TYPE-001` |
| `type` | `type-changed` | `TSAPI-TYPE-002` |
| `enum` | `removed` | `TSAPI-ENUM-002` |
| *default* | *any* | `TSAPI-FN-006` (fallback) |

### Code Flow

```
TypeScriptAnalyzer.diffSnapshots()
  └─> compareSymbols()
      └─> detectParameterBreakingChange()  [Stage 1: Sets metadata.ruleId]
          └─> Returns: { ruleId: 'TSAPI-FN-001', message: '...', ... }

EnhancedReportFormatter.format()
  └─> extractBreakingChanges()
      └─> getRuleId(change)  [Stage 2: Uses metadata or infers]
          ├─> if (change.metadata?.ruleId) return metadata.ruleId  ✅
          └─> else infer from kind + changeType  ⚠️
```

## Priority

1. **First Priority**: Rule ID from `TypeScriptAnalyzer` metadata (most specific)
2. **Second Priority**: Inferred rule ID from symbol kind + change type (generic)

## Example

```typescript
// Before: function add(a: number, b?: number): number
// After:  function add(a: number, b: number): number

// Stage 1: TypeScriptAnalyzer detects parameter optional → required
{
    ruleId: 'TSAPI-FN-001',  // Set in metadata
    message: "Parameter 'b' changed from optional to required"
}

// Stage 2: EnhancedReportFormatter uses metadata.ruleId
// Result: ruleId = 'TSAPI-FN-001' ✅
```

If metadata wasn't set (e.g., for a removed function):
```typescript
// Stage 1: No specific detection, just marked as 'removed'
{
    changeType: 'removed',
    symbol: { kind: 'function' }
    // No metadata.ruleId
}

// Stage 2: EnhancedReportFormatter infers
// kind='function' + changeType='removed' → 'TSAPI-FN-005' ✅
```

