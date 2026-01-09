# Improvement Roadmap - Real-Time Impact Analyzer

Based on architectural review and user feedback, this document outlines prioritized improvements.

---

## Priority 1: Critical Scalability & Correctness

### 1.1 Downstream Analysis Scalability + Evidence Spans

**Problem**: Current downstream analysis may not scale and lacks evidence for trust.

**Current State**:
- Direct dependents only
- No reverse import index
- No usage span tracking

**Solution**:
```typescript
// Reverse import index (file → dependents)
class ReverseImportIndex {
    private index: Map<string, Set<string>>; // filePath → Set<dependentPaths>
    
    // Incrementally updated on file change
    updateOnFileChange(changedFile: string): void {
        // Re-scan only affected dependents
        // Update index incrementally
    }
    
    getDirectDependents(filePath: string): string[] {
        return Array.from(this.index.get(filePath) || []);
    }
    
    getTransitiveDependents(filePath: string, maxDepth: number): string[] {
        // Optional: with depth limit and time budget
    }
}

// Evidence-based downstream detection
interface DownstreamEvidence {
    filePath: string;
    importSpan: { start: number; end: number }; // Line numbers
    usageSpan: { start: number; end: number };  // Where symbol is used
    symbolsUsed: string[]; // Which changed symbols are actually used
}
```

**Implementation Steps**:
1. Build reverse import index on workspace scan
2. Incrementally update on file changes
3. Track import spans (line numbers) for evidence
4. Track usage spans (where symbols are used)
5. Add optional transitive analysis with depth/time limits
6. Display evidence spans in UI

**UI Changes**:
- Show import line numbers in downstream components
- Show usage locations (file:line)
- Add "View Usage" link to jump to code
- Display "Evidence: Import at line 5, used at lines 12, 45"

---

### 1.2 TypeScript Version Resolution Strategy + Explicit Mode Labeling

**Problem**: Hard version matching causes friction; users need to know which TS version is being used.

**Current State**:
- Hard match check (throws error on mismatch)
- No fallback strategy
- No mode labeling

**Solution - Tiered Strategy**:

```typescript
enum TypeScriptMode {
    PROJECT_LOCAL = 'project-local',      // Best compatibility
    BUNDLED = 'bundled',                  // Fallback
    SYNTAX_ONLY = 'syntax-only'           // Last resort
}

interface TypeScriptEngineInfo {
    mode: TypeScriptMode;
    projectVersion?: string;
    bundledVersion?: string;
    compatibility: 'exact' | 'compatible' | 'incompatible';
    warnings?: string[];
}

class TypeScriptVersionResolver {
    resolveVersion(): TypeScriptEngineInfo {
        // 1. Try project-local typescript (best compatibility)
        const projectTs = this.findProjectTypeScript();
        if (projectTs) {
            const compatibility = this.checkCompatibility(projectTs);
            if (compatibility === 'exact' || compatibility === 'compatible') {
                return {
                    mode: TypeScriptMode.PROJECT_LOCAL,
                    projectVersion: projectTs.version,
                    bundledVersion: this.getBundledVersion(),
                    compatibility
                };
            }
        }
        
        // 2. Fall back to bundled TS
        const bundledTs = this.getBundledTypeScript();
        return {
            mode: TypeScriptMode.BUNDLED,
            bundledVersion: bundledTs.version,
            compatibility: 'exact'
        };
    }
    
    // Compatibility: same major/minor, any patch
    private checkCompatibility(projectTs: any): 'exact' | 'compatible' | 'incompatible' {
        const bundled = this.getBundledTypeScript();
        const [projectMajor, projectMinor] = projectTs.version.split('.');
        const [bundledMajor, bundledMinor] = bundled.version.split('.');
        
        if (projectMajor === bundledMajor && projectMinor === bundledMinor) {
            return projectTs.version === bundled.version ? 'exact' : 'compatible';
        }
        return 'incompatible';
    }
    
    // If parsing/checker fails → syntax-only mode
    handleParseFailure(): TypeScriptEngineInfo {
        return {
            mode: TypeScriptMode.SYNTAX_ONLY,
            compatibility: 'incompatible',
            warnings: ['AST parsing failed, using syntax-only analysis']
        };
    }
}
```

**UI Requirements**:
- **Always show**: `Engine: project TS 5.9.2 vs bundled TS 5.9.2`
- Show mode badge: `[Project TS]`, `[Bundled TS]`, `[Syntax Only]`
- Show compatibility status with icon
- Warning banner if incompatible (but don't block)

**Implementation Steps**:
1. Implement tiered resolution strategy
2. Add compatibility checking (major.minor match)
3. Add syntax-only fallback mode
4. Update UI to show engine info
5. Add configuration for strictness level

---

## Priority 2: User Trust & Transparency

### 2.1 Confidence Engine Transparency

**Problem**: Confidence scores without explanation are ignored.

**Current State**:
- Confidence score (0-100) shown
- Limited explanation of factors

**Solution**:

```typescript
interface ConfidenceBreakdown {
    total: number;
    factors: Array<{
        name: string;
        value: number;
        weight: number;
        contribution: number; // value * weight
        explanation: string;
        deduction?: number; // If negative
    }>;
    deductions: Array<{
        reason: string;
        amount: number;
        explanation: string;
    }>;
}

// In UI: Tooltip or detail node
class ConfidenceDetailView {
    render(breakdown: ConfidenceBreakdown): TreeItem {
        // Show each factor with explanation
        // Show deductions with reasons
        // Show why score is what it is
    }
}
```

**UI Changes**:
- Expandable "Confidence Breakdown" node
- Show each factor: `AST Parse Success: +30 (parsed successfully)`
- Show deductions: `-10: Type checker unavailable`
- Tooltip on confidence score showing summary
- Configurable thresholds:
  - `notifyOnBreakingChangesAboveConfidence: 70`
  - `showSuspectedSectionBelowConfidence: 50`

**Implementation Steps**:
1. Enhance ConfidenceEngine to return breakdown
2. Add factor explanations
3. Add deduction tracking
4. Update UI to show breakdown
5. Add configuration for thresholds

---

### 2.2 Test Discovery: Import Resolution & Symbol Usage

**Problem**: False positives/negatives due to incomplete import resolution.

**Current State**:
- Basic import matching
- May miss TypeScript path aliases
- May miss `import { x as y }` patterns
- Namespace imports partially handled

**Solution**:

```typescript
class EnhancedTestFinder {
    // Use TypeScript module resolution
    private resolveImport(
        testFile: string,
        importSpecifier: string
    ): string | null {
        // Use TypeScript's module resolution
        // Handles:
        // - Path aliases (tsconfig.json paths)
        // - BaseUrl
        // - Node module resolution
        const resolved = this.tsModuleResolver.resolve(
            importSpecifier,
            testFile,
            this.tsConfig
        );
        return resolved;
    }
    
    // Handle import aliases
    private extractImportedSymbols(importDecl: ts.ImportDeclaration): Map<string, string> {
        // import { x as y } from './file'
        // Returns: Map { 'y' => 'x' }
        const map = new Map();
        for (const spec of importDecl.importClause?.namedBindings) {
            if (ts.isImportSpecifier(spec)) {
                const alias = spec.name.text;
                const original = spec.propertyName?.text || spec.name.text;
                map.set(alias, original);
            }
        }
        return map;
    }
    
    // Track namespace imports
    private findNamespaceUsage(
        testFile: string,
        namespaceName: string,
        symbolName: string
    ): boolean {
        // Check for: namespaceName.symbolName
        // Use AST to find PropertyAccessExpression
        const sourceFile = this.getSourceFile(testFile);
        return this.visitAST(sourceFile, (node) => {
            if (ts.isPropertyAccessExpression(node)) {
                if (node.expression.getText() === namespaceName &&
                    node.name.text === symbolName) {
                    return true;
                }
            }
        });
    }
}
```

**Implementation Steps**:
1. Integrate TypeScript module resolver for path aliases
2. Enhance import alias tracking (`import { x as y }`)
3. Improve namespace import detection
4. Add test for each pattern
5. Update UI to show resolution path

---

## Priority 3: Performance & Resource Management

### 3.1 Cache Configurability + Metrics

**Problem**: Fixed cache size (300 ASTs) may not fit all scenarios.

**Current State**:
- Fixed LRU cache size: 300
- No metrics or visibility

**Solution**:

```typescript
interface CacheMetrics {
    size: number;
    maxSize: number;
    hitRate: number; // hits / (hits + misses)
    evictions: number;
    averageParseTime: number; // ms
    memoryUsage?: number; // MB (if available)
}

class ConfigurableASTCache {
    private maxSize: number;
    private metrics: CacheMetrics;
    
    constructor(config: ConfigurationManager) {
        this.maxSize = config.get('astCache.maxSize', 300);
        // Adaptive: adjust based on available memory
        if (config.get('astCache.adaptive', false)) {
            this.maxSize = this.calculateAdaptiveSize();
        }
    }
    
    getMetrics(): CacheMetrics {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: this.hits / (this.hits + this.misses),
            evictions: this.evictionCount,
            averageParseTime: this.totalParseTime / this.parseCount
        };
    }
}
```

**Configuration**:
```json
{
  "impactAnalyzer.astCache.maxSize": 300,
  "impactAnalyzer.astCache.adaptive": false,
  "impactAnalyzer.astCache.showMetrics": true
}
```

**UI Changes**:
- Debug panel: Show cache metrics
- Cache hit rate indicator
- Memory usage (if available)
- "Clear Cache" button with confirmation

**Implementation Steps**:
1. Make cache size configurable
2. Add metrics collection
3. Add adaptive sizing option
4. Display metrics in debug panel
5. Add cache management UI

---

## Priority 4: JavaScript Analysis Enhancements

### 4.1 Explicit Mode Labeling + Type-Aware JS

**Problem**: JavaScript analysis limitations not clearly communicated.

**Current State**:
- Structural analysis only
- No distinction between modes

**Solution**:

```typescript
enum JavaScriptAnalysisMode {
    STRUCTURAL = 'structural',      // Regex-based, no types
    TYPE_AWARE = 'type-aware'      // Using TypeScript with checkJs
}

class JavaScriptAnalyzer {
    detectMode(filePath: string): JavaScriptAnalysisMode {
        // Check if project has checkJs enabled
        const tsConfig = this.findTsConfig(filePath);
        if (tsConfig?.compilerOptions?.checkJs) {
            // Try to use TypeScript program for type-checking
            if (this.canTypeCheckJS(filePath)) {
                return JavaScriptAnalysisMode.TYPE_AWARE;
            }
        }
        return JavaScriptAnalysisMode.STRUCTURAL;
    }
    
    // Upgrade analysis if type-aware mode available
    analyzeWithTypes(filePath: string): AnalysisResult {
        // Use TypeScript program with allowJs + checkJs
        // Get type information
        // More accurate than structural only
    }
}
```

**UI Changes**:
- Mode badge: `[Structural JS]` or `[Type-Aware JS]`
- Warning if structural: "Limited analysis - enable checkJs for better results"
- Show JSDoc inference status (if used)

**Implementation Steps**:
1. Detect checkJs configuration
2. Implement type-aware JS analysis
3. Add mode labeling
4. Update UI to show mode
5. Document limitations clearly

**Important**: Do not oversell JSDoc inference - it's partial and inconsistent.

---

## Priority 5: Developer Experience

### 5.1 CLI Mode for CI Usage

**Problem**: Extension-only limits CI/CD integration.

**Solution**:

```typescript
// CLI entry point
class ImpactAnalyzerCLI {
    async analyze(args: CLIArgs): Promise<CLIResult> {
        // Analyze files
        // Output JSON or formatted text
        // Exit codes: 0 = no breaking changes, 1 = breaking changes found
    }
    
    async runTests(args: CLIArgs): Promise<TestResult> {
        // Run affected tests
        // Output test results
    }
}

// Usage:
// impact-analyzer analyze --file src/index.ts --baseline HEAD
// impact-analyzer analyze --git-diff --format json
// impact-analyzer run-tests --affected
```

**Output Formats**:
- JSON (for CI integration)
- Markdown (for PR comments)
- Plain text (for logs)

**Implementation Steps**:
1. Create CLI entry point
2. Support file and git-diff analysis
3. Add output format options
4. Add exit codes for CI
5. Package as standalone binary

---

### 5.2 "Run Affected Tests" CTA in Tree View

**Problem**: Test execution not easily discoverable.

**Solution**:
- Add prominent "▶️ Run Affected Tests" button at top of tree view
- Show test count: "Run 5 Affected Tests"
- Quick action in breaking issues section

---

### 5.3 Structured Error Codes for Parse Failures

**Problem**: Parse failures are opaque.

**Solution**:

```typescript
enum ParseErrorCode {
    SYNTAX_ERROR = 'PARSE_001',
    TYPE_CHECKER_FAILED = 'PARSE_002',
    MEMORY_LIMIT_EXCEEDED = 'PARSE_003',
    TIMEOUT = 'PARSE_004',
    UNSUPPORTED_SYNTAX = 'PARSE_005'
}

interface ParseError {
    code: ParseErrorCode;
    message: string;
    file: string;
    line?: number;
    suggestion?: string;
}
```

**UI**: Show error code with explanation and suggestion.

---

## Priority 6: Nice to Have

### 6.1 "Mark Irrelevant Test" Feedback Loop

**Simple implementation**:
- Local ignore list (workspace setting)
- Key: `testFilePath + sourceFilePath`
- UI: "Mark as irrelevant" context menu item
- Avoid ML-style language unless actually implementing learning

**Configuration**:
```json
{
  "impactAnalyzer.ignoredTestMatches": [
    {
      "testFile": "**/test.ts",
      "sourceFile": "**/source.ts",
      "reason": "user-marked-irrelevant"
    }
  ]
}
```

---

### 6.2 Sequence Diagrams

**For contributors and maintenance**:
- Document key flows with sequence diagrams
- Update on major changes
- Include in ARCHITECTURE.md

---

## Implementation Timeline

### Phase 1 (Immediate - 2 weeks)
1. ✅ TypeScript version resolution strategy
2. ✅ Downstream evidence spans (import/usage locations)
3. ✅ Confidence breakdown UI

### Phase 2 (Short-term - 1 month)
4. ✅ Reverse import index
5. ✅ Test discovery import resolution (path aliases)
6. ✅ Cache configurability + metrics

### Phase 3 (Medium-term - 2 months)
7. ✅ CLI mode
8. ✅ Type-aware JavaScript analysis
9. ✅ Transitive downstream analysis (optional)

### Phase 4 (Long-term - 3+ months)
10. ✅ Adaptive caching
11. ✅ Test feedback loop
12. ✅ Advanced confidence features

---

## Success Metrics

### User Trust
- Confidence score usage increases
- Fewer "why is this test flagged?" questions
- More users enabling breaking change notifications

### Performance
- Cache hit rate > 70%
- Analysis time < 2s for single file
- Memory usage < 500MB for typical workspace

### Adoption
- CLI usage in CI pipelines
- Positive feedback on downstream accuracy
- Reduced false positives in test discovery

---

## Notes

### Avoid Over-Engineering
- Keep "Mark irrelevant test" simple (ignore list, not ML)
- Don't oversell JSDoc inference
- Configurable > Adaptive (unless adaptive is simple)

### User Communication
- Always show which TS version is being used
- Always show analysis mode (Project TS / Bundled TS / Syntax Only)
- Always explain confidence deductions
- Always show evidence for downstream components

### Technical Debt
- Document TypeScript version strategy clearly
- Add tests for import resolution edge cases
- Monitor cache performance in production
- Collect metrics on false positives/negatives


