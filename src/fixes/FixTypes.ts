/**
 * Fix Engine Type Definitions
 * Core types for the fix engine architecture
 */

import * as vscode from 'vscode';
import { BreakingChange } from '../types/EnhancedImpactReport';
import { ParameterInfo } from '../analyzers/language/SymbolSnapshot';

/**
 * Enriched issue with fix-relevant evidence
 */
export interface Issue {
    /** Rule ID (e.g., "TSAPI-FN-001") */
    ruleId: string;
    /** Change kind (optional→required, export removed, rename, etc.) */
    changeKind: string;
    /** Source file and location */
    source: {
        file: string;
        range: vscode.Range;
        symbolId: string;
    };
    /** Before signature snapshot */
    before: SignatureSnapshot;
    /** After signature snapshot */
    after: SignatureSnapshot;
    /** Downstream references (call sites, import sites) */
    downstreamRefs: Reference[];
    /** Original breaking change (for backward compatibility) */
    original: BreakingChange;
}

/**
 * Signature snapshot for before/after comparison
 */
export interface SignatureSnapshot {
    /** Function/class/interface name */
    name: string;
    /** Parameters (for functions) */
    parameters?: ParameterInfo[];
    /** Return type (for functions) */
    returnType?: string;
    /** Type string representation */
    typeString?: string;
    /** Full signature string */
    signature: string;
}

/**
 * Reference to a symbol (call site, import site, property access, etc.)
 */
export interface Reference {
    /** File URI */
    uri: string;
    /** Range where reference occurs */
    range: vscode.Range;
    /** Kind of reference */
    nodeKind: 'call' | 'import' | 'property-access' | 'type-ref' | 'namespace';
    /** Symbol being referenced */
    symbolId: string;
    /** Optional AST node information */
    nodeInfo?: {
        /** Node text */
        text: string;
        /** Parent node kind */
        parentKind?: string;
    };
}

/**
 * Fix candidate - a concrete action the UI can offer
 */
export interface FixCandidate {
    /** Unique identifier */
    id: string;
    /** Human-readable title */
    title: string;
    /** Fix kind */
    kind: 'autofix' | 'guided' | 'manual';
    /** Confidence score (0.0 to 1.0) */
    confidence: number;
    /** Edits to apply (may be omitted for manual guidance) */
    edits?: WorkspaceEditPlan;
    /** Guidance text for manual/guided fixes */
    guidance?: string;
    /** Preview summary */
    preview?: PreviewSummary;
    /** Telemetry tag */
    telemetryTag?: string;
    /** Related issue */
    issue: Issue;
}

/**
 * Workspace edit plan - edits with invariants
 */
export interface WorkspaceEditPlan {
    /** Edits grouped by file */
    edits: Array<{
        uri: string;
        changes: vscode.TextEdit[];
    }>;
    /** Number of affected files */
    affectedFiles: number;
    /** Number of affected ranges */
    affectedRanges: number;
    /** Preconditions to validate before applying */
    preconditions: Precondition[];
}

/**
 * Precondition - invariant to check before applying fix
 */
export interface Precondition {
    /** Precondition kind */
    kind: 'textMatch' | 'symbolMatch';
    /** File URI */
    uri: string;
    /** Range to check */
    range: vscode.Range;
    /** Expected value */
    expected: string | { symbolId: string };
}

/**
 * Preview summary
 */
export interface PreviewSummary {
    /** Files that will be touched */
    files: string[];
    /** Number of edits per file */
    editCounts: Map<string, number>;
    /** Sample diff hunks (optional) */
    sampleHunks?: Array<{
        file: string;
        before: string;
        after: string;
    }>;
}

/**
 * Fix provider interface
 */
export interface FixProvider {
    /** Check if this provider supports the given issue */
    supports(issue: Issue): boolean;
    /** Generate fix candidates for the issue */
    getFixes(ctx: FixContext, issue: Issue): Promise<FixCandidate[]>;
}

/**
 * Fix context - everything needed to compute fixes
 */
export interface FixContext {
    /** Project root directory */
    projectRoot: string;
    /** TypeScript compiler options */
    compilerOptions: any;
    /** File text snapshots (current buffer + disk) */
    getFileText(uri: string): Promise<string>;
    /** Symbol resolver (map symbolId → declarations) */
    resolveSymbol(symbolId: string): Promise<SymbolDeclaration | null>;
    /** Reference index (downstream call sites/import sites) */
    referenceIndex: ReferenceIndex;
    /** Settings (confidence thresholds, max files, etc.) */
    settings: FixSettings;
}

/**
 * Symbol declaration
 */
export interface SymbolDeclaration {
    /** Symbol ID */
    symbolId: string;
    /** File URI */
    uri: string;
    /** Declaration range */
    range: vscode.Range;
    /** Symbol name */
    name: string;
    /** Symbol kind */
    kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable';
    /** Parameters (for functions) */
    parameters?: ParameterInfo[];
}

/**
 * Reference index interface
 */
export interface ReferenceIndex {
    /** Get all references to a symbol */
    getReferences(symbolId: string): Reference[];
    /** Get references in a specific file */
    getReferencesInFile(uri: string): Reference[];
    /** Check if symbol has references */
    hasReferences(symbolId: string): boolean;
    /** Update index for a file (incremental) */
    updateFile(uri: string, content: string): Promise<void>;
}

/**
 * Fix settings
 */
export interface FixSettings {
    /** Minimum confidence threshold (0.0 to 1.0) */
    minConfidence: number;
    /** Maximum files to touch in one fix */
    maxFiles: number;
    /** Show low confidence fixes */
    showLowConfidence: boolean;
}

