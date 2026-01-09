# Real-Time Impact Analyzer - Architecture & End-to-End Flow

## Overview

The Real-Time Impact Analyzer is a VS Code extension that analyzes code changes in real-time, detects breaking changes, identifies affected tests, and provides risk assessment. It uses AST-based analysis for TypeScript/JavaScript and supports multiple languages through language-specific analyzers.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code Extension                         │
│                         (extension.ts)                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                        │
        ┌───────▼────────┐      ┌────────▼────────┐
        │   UI Layer     │      │  Core Analysis  │
        │                │      │     Layer      │
        │ - Tree View    │      │                │
        │ - Commands     │◄─────┤ - Analyzer     │
        │ - Decorations  │      │ - Git Analyzer │
        │ - Welcome      │      │ - Confidence   │
        └───────────────┘      └────────┬───────┘
                                        │
                        ┌───────────────┴───────────────┐
                        │                                │
                ┌──────▼──────┐              ┌─────────▼─────────┐
                │  Language    │              │   Test Discovery   │
                │  Analyzers   │              │   & Execution     │
                │              │              │                    │
                │ - TypeScript │              │ - Test Finder     │
                │ - JavaScript │              │ - Test Runner     │
                │ - Python     │              │ - CI Integration  │
                │ - Java       │              └────────────────────┘
                └──────────────┘
```

---

## Core Components

### 1. Extension Entry Point (`extension.ts`)

**Responsibilities:**
- Extension activation and lifecycle management
- Command registration
- Event listener setup (file save, open, configuration changes)
- Service initialization

**Key Initialization:**
```typescript
1. TypeScript version alignment check (prevents AST parsing issues)
2. Initialize ConfigurationManager
3. Initialize ProfessionalImpactAnalyzer (core engine)
4. Initialize SimpleImpactViewProvider (UI)
5. Register commands and event listeners
6. Setup auto-analysis on save (if enabled)
```

### 2. Core Analysis Layer

#### 2.1 ProfessionalImpactAnalyzer (`core/ProfessionalImpactAnalyzer.ts`)

**Purpose:** Orchestrates the entire analysis workflow

**Key Responsibilities:**
- Baseline resolution (Git HEAD, merge base, or last save)
- Current version resolution (buffer vs disk)
- Coordinates between analyzers
- Confidence scoring
- Result aggregation
- Caching (baseline cache, AST cache)

**Key Methods:**
- `analyzeFile(filePath, document?)` - Main entry point for file analysis
- `initializeBaselineIfNeeded(filePath)` - Sets up baseline for comparison
- `getBaselineContent(filePath)` - Retrieves baseline content
- `getCurrentContent(filePath, document?)` - Gets current file content

#### 2.2 PureImpactAnalyzer (`core/PureImpactAnalyzer.ts`)

**Purpose:** Performs the actual AST-based diff analysis

**Key Methods:**
- `analyzeImpactWithDiff(before, after, filePath)` - Core diff analysis
- Returns `SnapshotDiff` containing:
  - `changedSymbols[]` - Functions, classes, interfaces, types that changed
  - `exportChanges.removed[]` - Removed exports
  - `exportChanges.modified[]` - Modified exports
  - `exportChanges.added[]` - Added exports

#### 2.3 Language Analyzers (`analyzers/language/`)

**TypeScriptAnalyzer** - Most sophisticated analyzer
- Uses `ts-morph` for AST parsing
- Uses TypeScript compiler API for type checking
- Detects:
  - Function signature changes (parameter optionality, return types)
  - Class method changes
  - Interface property changes
  - Type alias changes
  - Export removals/modifications
  - Callable interface signatures

**JavaScriptAnalyzer** - Structural analysis
- Uses TypeScript compiler for AST (without type checking)
- Regex-based test matching
- Less accurate than TypeScript (no type information)

**Other Analyzers** - Python, Java (basic support)

### 3. UI Layer

#### 3.1 SimpleImpactViewProvider (`ui/SimpleImpactViewProvider.ts`)

**Purpose:** Tree view data provider for Impact Analyzer panel

**Key Methods:**
- `getRootItems()` - Top-level tree items
- `getChildren(element)` - Child items (recursive)
- `getDetailItems(element)` - Detailed view for expanded items
- `extractBreakingIssues(result)` - Extracts breaking changes from analysis result
- `updateAnalysisResult(result)` - Updates UI with new analysis

**Tree Structure:**
```
Impact Analyzer View
├── 🚨 What Will Break (N)
│   ├── Export Removal (X)
│   │   └── Export 'X' was removed
│   ├── Export Modification (Y)
│   ├── Function Impact (Z)
│   └── Test Impact (W)
├── Changed Functions (N)
├── Changed Classes (N)
├── Affected Tests (N)
└── Downstream Components (N)
```

#### 3.2 InlineDecorationsManager (`ui/InlineDecorationsManager.ts`)

**Purpose:** Shows inline annotations in the editor
- Highlights changed functions/classes
- Shows risk indicators
- Displays confidence scores

#### 3.3 WelcomeViewProvider (`ui/WelcomeViewProvider.ts`)

**Purpose:** Welcome panel with quick start guide

### 4. Test Discovery & Execution

#### 4.1 TestFinder (`analyzers/TestFinder.ts`)

**Strategies:**
1. **File Name Matching** - `source.ts` → `source.test.ts`
2. **Import Analysis** - Tests that import the source file
3. **Symbol Matching** - Tests that use changed functions/classes
4. **Content Analysis** - Semantic matching (heuristic)

**Two-Stage Filtering:**
- Stage 1: Fast import check (regex/string matching)
- Stage 2: AST/regex analysis (only on Stage 1 matches)

#### 4.2 TestRunner (`test-runners/TestRunner.ts`)

**Purpose:** Executes tests using framework-specific commands
- Supports: Jest, Mocha, Pytest, JUnit, etc.
- Captures output and results
- Shows results in output channel

### 5. Supporting Services

#### 5.1 GitAnalyzer (`analyzers/GitAnalyzer.ts`)
- Resolves Git baselines (HEAD, merge base, specific commit)
- Tracks file changes
- Provides commit history

#### 5.2 ConfidenceEngine (`core/ConfidenceEngine.ts`)
- Calculates confidence scores (0-100)
- Considers multiple factors:
  - AST parse success
  - Test discovery accuracy
  - Symbol matching precision
  - Downstream detection reliability

#### 5.3 ConfigurationManager (`core/ConfigurationManager.ts`)
- Manages extension settings
- Baseline mode selection (HEAD, PR, last save)
- Auto-analysis/auto-refresh toggles

#### 5.4 CiResultsManager (`services/CiResultsManager.ts`)
- Integrates with CI/CD systems
- Polls for test results
- Displays CI test status in UI

---

## End-to-End Flow

### Scenario: User Saves a TypeScript File

```
1. FILE SAVE EVENT
   └─> extension.ts: onDidSaveTextDocument
       └─> impactAnalyzer.analyzeFile(filePath, document)

2. BASELINE RESOLUTION
   └─> ProfessionalImpactAnalyzer.analyzeFile()
       └─> getBaselineContent(filePath)
           ├─> Check baselineCache (in-memory)
           ├─> If not cached:
           │   ├─> Resolve baseline mode (HEAD/PR/lastSave)
           │   ├─> GitAnalyzer.getFileContentAtRef() OR
           │   └─> Read from disk (last save)
           └─> Cache baseline content

3. CURRENT VERSION RESOLUTION
   └─> getCurrentContent(filePath, document)
       ├─> If document provided: Read from buffer (unsaved changes)
       └─> Else: Read from disk

4. AST PARSING & DIFF ANALYSIS
   └─> PureImpactAnalyzer.analyzeImpactWithDiff(before, after, filePath)
       └─> LanguageAnalyzerFactory.createAnalyzer(filePath)
           └─> TypeScriptAnalyzer.diffSnapshots(beforeSnapshot, afterSnapshot)
               ├─> compareExports() → exportChanges
               ├─> compareSymbols() → changedSymbols
               └─> Returns SnapshotDiff

5. BREAKING CHANGE DETECTION
   └─> TypeScriptAnalyzer.diffSnapshots()
       ├─> detectPropertyBreakingChange() - Parameter optionality, type changes
       ├─> detectClassMethodChange() - Method removals, signature changes
       └─> compareExports() - Export removals/modifications
           └─> Returns exportChanges.removed[], exportChanges.modified[]

6. TEST DISCOVERY
   └─> TestFinder.findAffectedTests(filePath, changedSymbols)
       ├─> Stage 1: Find tests that import source file (fast)
       └─> Stage 2: Filter by symbol usage (AST/regex)

7. DOWNSTREAM DETECTION
   └─> DependencyAnalyzer.findDownstreamComponents(filePath)
       └─> Find files that import the changed file

8. CONFIDENCE SCORING
   └─> ConfidenceEngine.calculateConfidence(result)
       └─> Returns confidence score (0-100) with metrics

9. RESULT AGGREGATION
   └─> ProfessionalImpactAnalyzer.analyzeFile()
       └─> Returns ImpactAnalysisResult:
           ├─> changedFunctions[]
           ├─> changedClasses[]
           ├─> affectedTests[]
           ├─> downstreamComponents[]
           ├─> confidenceResult
           └─> snapshotDiff (contains exportChanges)

10. UI UPDATE
    └─> SimpleImpactViewProvider.updateAnalysisResult(result)
        └─> extractBreakingIssues(result)
            ├─> Check snapshotDiff.exportChanges.removed
            ├─> Check snapshotDiff.exportChanges.modified
            ├─> Check changedFunctions/changedClasses
            └─> Returns breakingIssues[]
        └─> _onDidChangeTreeData.fire() (refresh tree view)

11. USER NOTIFICATION
    └─> extension.ts
        └─> Show notification with breaking issues count
        └─> Update inline decorations
```

---

## Breaking Change Detection Flow

### Detailed Flow for Export Removal Detection

```
1. SNAPSHOT CREATION (Before)
   └─> TypeScriptAnalyzer.createSnapshot(beforeContent)
       └─> Extract exports using AST
           └─> Returns SymbolSnapshot with exports: ExportInfo[]

2. SNAPSHOT CREATION (After)
   └─> TypeScriptAnalyzer.createSnapshot(afterContent)
       └─> Extract exports using AST
           └─> Returns SymbolSnapshot with exports: ExportInfo[]

3. EXPORT COMPARISON
   └─> TypeScriptAnalyzer.compareExports(beforeExports, afterExports)
       ├─> Build maps: beforeMap[name] = ExportInfo[], afterMap[name] = ExportInfo[]
       ├─> Find removed: for each name in beforeMap, if not in afterMap → removed[]
       ├─> Find added: for each name in afterMap, if not in beforeMap → added[]
       └─> Find modified: compare signatures for exports in both maps
           └─> Returns { added, removed, modified }

4. SNAPSHOT DIFF CREATION
   └─> TypeScriptAnalyzer.diffSnapshots()
       └─> Returns SnapshotDiff:
           └─> exportChanges: { added, removed, modified }

5. RESULT ATTACHMENT
   └─> ProfessionalImpactAnalyzer.analyzeFile()
       └─> Attaches snapshotDiff to ImpactAnalysisResult
           └─> result.snapshotDiff = snapshotDiff

6. BREAKING ISSUE EXTRACTION
   └─> SimpleImpactViewProvider.extractBreakingIssues(result)
       └─> if (snapshotDiff?.exportChanges?.removed?.length > 0)
           └─> for each removed export:
               └─> breakingIssues.push({
                   severity: '🚨 Breaking Change',
                   message: `Export '${name}' was removed`,
                   category: 'Export Removal',
                   ...
               })

7. UI DISPLAY
   └─> SimpleImpactViewProvider.getRootItems()
       └─> if (breakingIssues.length > 0)
           └─> Create "🚨 What Will Break (N)" tree item
               └─> User expands → getDetailItems()
                   └─> Group by category → "Export Removal (X)"
                       └─> User expands → Show individual issues
```

---

## Data Structures

### ImpactAnalysisResult
```typescript
{
  filePath: string;
  changedFunctions: string[];
  changedClasses: string[];
  affectedTests: string[];
  downstreamComponents: string[];
  confidence: number;
  confidenceResult?: ConfidenceResult;
  snapshotDiff?: SnapshotDiff;  // Contains exportChanges
  baseline?: BaselineResolution;
  currentVersion?: CurrentVersion;
  parseStatus?: { old, new, fallback? };
}
```

### SnapshotDiff
```typescript
{
  changedSymbols: SymbolChange[];
  exportChanges: {
    added: ExportInfo[];
    removed: ExportInfo[];
    modified: Array<ExportInfo | { before: ExportInfo; after: ExportInfo }>;
  };
}
```

### ExportInfo
```typescript
{
  name: string;              // Public API name
  type: 'named' | 'default' | 'namespace';
  kind: 'function' | 'class' | 'interface' | 'type' | 're-export' | ...;
  line: number;
  sourceModule?: string;    // For re-exports
  sourceName?: string;       // Original name before 'as'
  isTypeOnly?: boolean;
}
```

### SymbolSnapshot
```typescript
{
  filePath: string;
  timestamp: Date;
  functions: SymbolInfo[];
  classes: SymbolInfo[];
  interfaces: SymbolInfo[];
  typeAliases: SymbolInfo[];
  exports: ExportInfo[];     // Key for export removal detection
  imports: ImportInfo[];
}
```

---

## AST Implementation Details

### AST Libraries Used

The extension uses **two complementary AST approaches**:

#### 1. **ts-morph** (Primary Wrapper)
- **What it is**: A wrapper library around TypeScript Compiler API
- **Purpose**: Provides a more ergonomic, object-oriented API for AST manipulation
- **Version**: `^27.0.0` (bundles TypeScript `5.9.2`)
- **Usage**: Primary interface for AST traversal and manipulation
- **Example**:
  ```typescript
  import { Project, SourceFile, InterfaceDeclaration } from 'ts-morph';
  const sourceFile = project.getSourceFile('file.ts');
  const interfaces = sourceFile.getInterfaces();
  ```

#### 2. **TypeScript Compiler API** (Direct Access)
- **What it is**: The official TypeScript Compiler API (`typescript` package)
- **Purpose**: Direct access to low-level AST nodes and type checker
- **Version**: `5.9.2` (must match ts-morph's bundled version)
- **Usage**: 
  - Type checking (`ts.TypeChecker`)
  - Direct AST node access via `compilerNode` property
  - Advanced type analysis
- **Example**:
  ```typescript
  import * as ts from 'typescript';
  const compilerNode = interfaceDeclaration.compilerNode; // Direct TS AST node
  const checker = program.getTypeChecker();
  const type = checker.getTypeAtLocation(compilerNode);
  ```

### AST Node Access Pattern

The extension uses a **hybrid approach**:

```typescript
// 1. Use ts-morph for high-level operations
const intf = sourceFile.getInterface('MyInterface');
const members = intf.getProperties();

// 2. Access underlying TypeScript AST when needed
const compilerNode = intf.compilerNode; // ts.InterfaceDeclaration
const tsMembers = compilerNode.members; // ts.TypeElement[]

// 3. Use TypeScript Compiler API directly for type checking
const checker = program.getTypeChecker();
const symbol = checker.getSymbolAtLocation(compilerNode);
```

### Why Both?

1. **ts-morph Benefits**:
   - Cleaner, more intuitive API
   - Easier file manipulation (add/remove nodes)
   - Better project management
   - Handles file system operations

2. **Direct TypeScript API Benefits**:
   - Access to full type information
   - Type checker integration
   - Lower-level AST node access
   - Performance for type queries

### AST Node Types

The extension works with **TypeScript's native AST node types**:

- `ts.SourceFile` - Root node
- `ts.InterfaceDeclaration` - Interface nodes
- `ts.ClassDeclaration` - Class nodes
- `ts.FunctionDeclaration` - Function nodes
- `ts.CallSignatureDeclaration` - Callable interface signatures
- `ts.PropertySignature` - Interface properties
- `ts.MethodSignature` - Interface methods
- `ts.TypeAliasDeclaration` - Type aliases
- `ts.ExportDeclaration` - Export statements
- `ts.ImportDeclaration` - Import statements

### TypeScript Version Alignment

**Critical**: The extension enforces TypeScript version alignment:

```typescript
// Runtime check in extension.ts
const tsVersion = require('typescript').version;        // 5.9.2
const tsMorphTsVersion = require('ts-morph').ts.version; // 5.9.2

if (tsVersion !== tsMorphTsVersion) {
    throw new Error('TypeScript version mismatch');
}
```

**Why**: Different TypeScript versions produce different AST structures. Mismatched versions cause:
- Incorrect AST node types
- Missing properties on nodes
- Type checker failures
- False positives/negatives in change detection

### AST Parsing Flow

```
1. File Content (string)
   └─> ts-morph Project.createSourceFile()
       └─> TypeScript Compiler API parseSourceFile()
           └─> Returns ts.SourceFile (AST root)

2. ts-morph Wrapper
   └─> Wraps ts.SourceFile
       └─> Provides high-level methods:
           - getInterfaces()
           - getClasses()
           - getFunctions()
           - etc.

3. Direct AST Access (when needed)
   └─> node.compilerNode
       └─> Returns raw ts.Node
           └─> Use TypeScript Compiler API directly

4. Type Checking (when needed)
   └─> program.getTypeChecker()
       └─> checker.getTypeAtLocation(node)
           └─> Returns type information
```

### Example: Interface Call Signature Detection

```typescript
// Using ts-morph
const intf = sourceFile.getInterface('MyInterface');

// Access underlying AST
const compilerNode = intf.compilerNode as ts.InterfaceDeclaration;
const members = compilerNode.members; // ts.TypeElement[]

// Use TypeScript API directly
const tsApi = require('typescript');
for (const member of members) {
    if (tsApi.isCallSignatureDeclaration(member)) {
        // This is a call signature: (param: type) => returnType
        const callSig = member as ts.CallSignatureDeclaration;
        const params = callSig.parameters;
        const returnType = callSig.type;
    }
}
```

### JavaScript Files

For JavaScript files, the extension also uses TypeScript Compiler API:
- TypeScript can parse JavaScript (without type checking)
- Same AST structure as TypeScript
- No type information available
- Uses structural analysis only

---

## Key Design Decisions

### 1. Baseline Strategy
- **Session-only baseline cache** - Cleared on extension reload
- **Multiple baseline modes** - Git HEAD, PR merge base, or last save
- **Fallback chain** - Git → Disk → Text diff if AST fails

### 2. AST vs Text Diff
- **Primary**: AST-based analysis (accurate, type-aware)
- **Fallback**: Text diff if AST parsing fails
- **TypeScript version alignment** - Critical for consistent AST parsing

### 3. Two-Stage Test Discovery
- **Stage 1**: Fast import check (filters 90% of tests)
- **Stage 2**: Symbol usage analysis (only on Stage 1 matches)
- **Performance**: Prevents AST traversal on all test files

### 4. Breaking Change Detection
- **AST-based** for syntax changes (parameter optionality, signature changes)
- **Symbol table** for export removals
- **Type checker** for type compatibility (when available)

### 5. Caching Strategy
- **Baseline cache**: In-memory, session-only
- **AST cache**: LRU eviction (max 300 entries)
- **Analysis cache**: Per-file, cleared on file change

---

## Extension Points

### Adding a New Language Analyzer

1. Create analyzer in `analyzers/language/YourLanguageAnalyzer.ts`
2. Implement `ILanguageAnalyzer` interface
3. Register in `LanguageAnalyzerFactory`
4. Add file extension mapping

### Adding a New Test Framework

1. Update `TestRunner.ts` with framework detection
2. Add command pattern for test execution
3. Update output parsing logic

---

## Performance Considerations

1. **Lazy Evaluation** - Tree view items created on-demand
2. **Caching** - Baseline and AST caching reduce redundant work
3. **Two-Stage Filtering** - Fast checks before expensive AST traversal
4. **Background Processing** - Analysis doesn't block UI
5. **Timeout Protection** - Analysis times out after max duration

---

## Debugging

### Debug Output Channels
- **Impact Analyzer** - General analysis logs
- **Impact Analyzer Debug** - Detailed AST/export analysis logs
- **Test Runner** - Test execution output

### Key Log Points
- `[TypeScriptAnalyzer] compareExports` - Export comparison
- `[SimpleImpactViewProvider] extractBreakingIssues` - Breaking issue extraction
- `[ProfessionalImpactAnalyzer] snapshotDiff attached` - Result attachment

---

## Future Enhancements

1. **Incremental Analysis** - Only analyze changed regions
2. **Parallel Analysis** - Analyze multiple files concurrently
3. **Symbol-Level Caching** - Cache individual symbol snapshots
4. **Type-Aware Test Matching** - Use type information for better test discovery
5. **Cross-File Impact** - Detect impact across file boundaries

