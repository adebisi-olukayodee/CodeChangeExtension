# Fix Engine Architecture - Implementation Plan

## Current State Assessment

### ✅ Already in Place
- **Breaking change detection** with rule IDs (`BreakingChangeRule` enum)
- **Structured change data**: `BreakingChange`, `SymbolChange`, `SnapshotDiff`
- **Downstream file tracking**: `DependencyAnalyzer` with line numbers
- **Parameter metadata**: `ParameterInfo` (name, type, optional, defaultValue)
- **Before/after signatures**: Available in `SymbolInfo.signature` and `BreakingChange.before`/`after`

### ❌ Missing (Required for Fixes)
- **Call site detection**: Currently only tracks import sites, not function call sites
- **Reference index**: Need `symbolId → call sites[]` mapping
- **Fix provider system**: No pluggable fix generation
- **WorkspaceEdit generation**: No code transformation logic
- **Fix preview/apply UI**: No VS Code integration for fixes

---

## Recommended Implementation Phases

### Phase 1: Foundation (Week 1-2)
**Goal**: Build the infrastructure without implementing any fix providers yet.

1. **Reference Index** (`src/fixes/index/ReferenceIndex.ts`)
   - Extend `DependencyAnalyzer` to track call sites, not just imports
   - Build `symbolId → references[]` map where each reference has:
     - `uri`, `range`, `nodeKind` (call, property access, type ref)
     - `ts.Node` handle via node locator
   - Make it incremental (update on file save)

2. **Fix Types** (`src/fixes/FixTypes.ts`)
   - Define `FixCandidate`, `FixProvider`, `WorkspaceEditPlan`, `FixContext`
   - Map existing `BreakingChange` → enriched `Issue` format

3. **Fix Context** (`src/fixes/FixContext.ts`)
   - Wrap project root, TypeScript Program, file snapshots
   - Provide symbol resolver and reference index access

### Phase 2: First Provider (Week 3)
**Goal**: Implement one high-value fix to validate the architecture.

**Provider**: `OptionalToRequiredParamFix`
- **Rule**: `TSAPI-FN-001` (parameter changed from optional to required)
- **Strategy**:
  1. Find all call sites via `ReferenceIndex`
  2. For each call expression:
     - Check if missing argument
     - Infer value from type (or use placeholder)
     - Generate `TextEdit` to insert argument
  3. Return `WorkspaceEditPlan` with all edits

**Why this first?**
- High impact (common breaking change)
- Multi-file (demonstrates downstream awareness)
- Relatively safe (syntactic edits)

### Phase 3: UI Integration (Week 4)
**Goal**: Wire fixes into VS Code UI.

1. **Tree View Enhancement**
   - Add "Fixes" child node under breaking issues
   - Show fix candidates with confidence badges
   - Commands: `extension.previewFix`, `extension.applyFix`

2. **Preview**
   - Use `vscode.diff` or summary panel
   - Show file list + affected ranges count

3. **Apply**
   - Convert `WorkspaceEditPlan` → `WorkspaceEdit`
   - Validate preconditions
   - Apply atomically (one undo step)

### Phase 4: Additional Providers (Week 5-6)
**Goal**: Add 2-3 more providers to cover common cases.

1. **ExportRemovedFix** (`TSAPI-EXP-001`)
   - Update imports to remove or replace with alternative
   - If replacement exists, update all references

2. **RenamedExportFix** (new rule or `TSAPI-EXP-004`)
   - Update import specifiers
   - Update symbol references

---

## Architecture Decisions

### 1. Reference Index Strategy

**Option A**: Extend `DependencyAnalyzer`
- ✅ Already has import tracking
- ✅ Already uses TypeScript AST
- ❌ Mixes concerns (dependencies + references)

**Option B**: New `ReferenceIndex` class
- ✅ Single responsibility
- ✅ Can reuse `DependencyAnalyzer` for imports
- ❌ More code duplication

**Recommendation**: **Option B** - Create `ReferenceIndex` that uses `DependencyAnalyzer` internally but focuses on symbol references.

### 2. Fix Provider Registration

**Option A**: Explicit registration in `FixEngine`
```ts
const engine = new FixEngine();
engine.registerProvider(new OptionalToRequiredParamFix());
```

**Option B**: Auto-discovery via file naming convention
```ts
// providers/OptionalToRequiredParamFix.ts
export class OptionalToRequiredParamFix implements FixProvider { ... }
// FixEngine scans providers/ directory
```

**Recommendation**: **Option A** for v1 (explicit), consider Option B later for extensibility.

### 3. Precondition Validation

**Strategy**: Lightweight text matching + AST position checks
- Before apply: verify target ranges still contain expected text
- Use hash of range text for fast validation
- If validation fails: downgrade to "guided" with message

**Implementation**:
```ts
interface Precondition {
  kind: 'textMatch' | 'symbolMatch';
  uri: string;
  range: vscode.Range;
  expected: string | { symbolId: string };
}
```

### 4. Confidence Scoring

**Simple rule-based approach** (as proposed):
- **High (0.8-1.0)**: Exact symbol resolution, minimal edits, no overloads
- **Medium (0.5-0.8)**: Some ambiguity, spread args, complex types
- **Low (0.0-0.5)**: `any` types, regex-based detection, conditional compilation

**Expose in UI**: Confidence badge + threshold setting

---

## Integration with Existing Code

### Mapping Current Types → Fix Types

```ts
// Current
interface BreakingChange {
  ruleId: string;           // ✅ Maps to FixCandidate
  symbol: string;           // ✅ Maps to Issue.source.symbolId
  before: string;           // ✅ Maps to Issue.before
  after: string;            // ✅ Maps to Issue.after
  line?: number;           // ✅ Maps to Issue.source.range
  context?: Record<string, any>; // ✅ Can store fix-relevant data
}

// Proposed
interface Issue {
  ruleId: string;
  changeKind: string;      // Extract from ruleId or context
  source: { file, range, symbolId };
  before/after: SignatureSnapshot;
  downstreamRefs: Array<{ file, range }>; // Need to build this
}
```

**Enrichment step**: Convert `BreakingChange[]` → `Issue[]` by:
1. Extracting `changeKind` from `ruleId` or `context`
2. Building `source.range` from `line`
3. Looking up `downstreamRefs` from `ReferenceIndex`

### Where to Hook In

**Current flow**:
```
ProfessionalImpactAnalyzer.analyze()
  → PureImpactAnalyzer.analyzeImpactWithDiff()
    → TypeScriptAnalyzer.buildSnapshot()
    → DependencyAnalyzer.findDownstreamComponents()
  → Returns ImpactAnalysisResult
```

**New flow**:
```
ProfessionalImpactAnalyzer.analyze()
  → [existing analysis]
  → FixEngine.enrichIssues(result.breakingChanges)
  → FixEngine.getFixes(enrichedIssues)
  → Returns ImpactAnalysisResult + FixCandidates[]
```

**Hook point**: In `ProfessionalImpactAnalyzer.analyze()`, after getting `ImpactAnalysisResult`, call `FixEngine` to generate fixes.

---

## File Structure

```
src/
  fixes/
    FixEngine.ts              # Main orchestrator
    FixContext.ts             # Context wrapper
    FixProvider.ts            # Interface
    FixTypes.ts               # All type definitions
    providers/
      OptionalToRequiredParamFix.ts
      ExportRemovedFix.ts
      RenamedExportFix.ts
    preview/
      FixPreview.ts           # Preview UI logic
    apply/
      FixApplier.ts           # WorkspaceEdit generation + validation
    index/
      ReferenceIndex.ts       # Symbol → references mapping
      NodeLocator.ts          # AST node position utilities
```

---

## Safety Considerations

### Precondition Checks (Critical)

Before applying any fix:
1. **Text match**: Target range still contains expected text
2. **Symbol match**: AST node still resolves to same symbol
3. **File existence**: All target files still exist
4. **No conflicts**: Edits don't overlap (within same file)

### Rollback Strategy

- Use VS Code's built-in undo (atomic `WorkspaceEdit`)
- Don't implement custom rollback (too complex, error-prone)

### User Control

- **Preview required** for all fixes (no auto-apply)
- **Confidence threshold** setting (default: 0.7)
- **Max files** setting (default: 10, warn if exceeded)

---

## Next Steps

1. **Decide on priority**: Is this a v1 feature or future enhancement?
2. **Start with Phase 1**: Build `ReferenceIndex` and `FixTypes`
3. **Validate with one provider**: `OptionalToRequiredParamFix`
4. **Iterate based on feedback**

---

## Questions to Resolve

1. **Timeline**: Is this a near-term priority or future work?
2. **Scope**: Should we start with just one provider, or build the full infrastructure first?
3. **Reference Index**: Should we extend `DependencyAnalyzer` or create new class?
4. **UI**: Tree view only, or also CodeLens/Quick Fix?

