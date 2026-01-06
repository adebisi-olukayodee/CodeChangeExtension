/**
 * Symbol snapshot - immutable representation of code state at a point in time.
 * Used for comparing before/after states to detect changes.
 */

export type PackageSnapshot = {
    type?: 'module' | 'commonjs' | 'missing';
    exports?: unknown; // keep as unknown, we only need presence/emptiness
};

export interface SymbolSnapshot {
    /** File path */
    filePath: string;
    /** Timestamp when snapshot was created */
    timestamp: Date;
    
    /** Functions in the file */
    functions: SymbolInfo[];
    /** Classes in the file */
    classes: SymbolInfo[];
    /** Interfaces in the file */
    interfaces: SymbolInfo[];
    /** Type aliases in the file */
    typeAliases: SymbolInfo[];
    /** Enums in the file */
    enums: SymbolInfo[];
    
    /** Exported symbols (what other files can import) */
    exports: ExportInfo[];
    /** Imported modules */
    imports: ImportInfo[];
    
    /** Export statistics - split into buckets for accurate tracking */
    exportStats?: {
        /** Direct exports declared in this file (export const, export function, etc.) */
        directExports: number;
        /** Resolved symbols from export * from / export {x} from (runtime) */
        reExportedSymbols: number;
        /** Resolved symbols from export type ... from (type-only) */
        typeOnlyExports: number;
        /** Total exports (directExports + reExportedSymbols + typeOnlyExports) */
        exportsTotal: number;
        /** Runtime exports (directExports_runtime + reExportedSymbols_runtime) */
        exportsRuntime: number;
        /** Type exports (directExports_type + typeOnlyExports + reExportedSymbols_typeOnly) */
        exportsType: number;
        /** Unique export keys (for deduplication validation) */
        exportsUnique: number;
        /** Exports with declaration nodes (for signature inspection) */
        exportsWithDeclarations: number;
        /** Unresolved re-export groups (for diagnostics) */
        reexportGroupsUnresolved?: number;
    };
    
    /** Type information for symbols (when type checker available) */
    typeInfo?: Map<string, TypeInfo>;
    /** Module system (for JavaScript files) */
    moduleSystem?: 'cjs' | 'esm' | 'mixed' | 'unknown';
    /** Package.json metadata (type, exports map) */
    packageJson?: PackageSnapshot;
}

export interface SymbolInfo {
    /** Symbol name */
    name: string;
    /** Fully qualified name (e.g., "MyClass.method") */
    qualifiedName: string;
    /** Line number */
    line: number;
    /** Column number */
    column: number;
    /** Signature/hash for comparison */
    signature: string;
    /** Return type (for functions) */
    returnType?: string;
    /** Parameters (for functions) */
    parameters?: ParameterInfo[];
    /** Is exported */
    isExported: boolean;
    /** Symbol kind */
    kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'method' | 'property';
    /** Additional metadata */
    metadata?: Record<string, any>;
    /** Overload signatures (for functions with overloads) */
    overloads?: string[];
}

export interface ParameterInfo {
    name: string;
    type: string;
    optional: boolean;
    defaultValue?: string;
    rest?: boolean;
}

export interface ExportInfo {
    /** Exported symbol name (public API name - what consumers see) */
    name: string;
    /** Export type: 'named' | 'default' | 'namespace' */
    type: 'named' | 'default' | 'namespace';
    /** What it exports (function, class, etc.) or 're-export' */
    kind: string;
    /** Line number */
    line: number;
    /** Source module (for re-exports: export { x } from './module') */
    sourceModule?: string;
    /** Source name from the source module (propertyName in export { y as x } - 'y' is sourceName) */
    sourceName?: string;
    /** Original exported name from source module (for re-exports) - deprecated, use sourceName */
    exportedName?: string;
    /** Local name (if re-exported as different name: export { x as y }) - deprecated, use sourceName */
    localName?: string;
    /** Is this a type-only export (export type ... from or export { type ... } from) */
    isTypeOnly?: boolean;
    /** Declaration file path (resolved) */
    declFilePath?: string;
    /** Declaration start position */
    declPos?: number;
    /** Declaration end position */
    declEnd?: number;
    /** TypeScript symbol ID (for stable identity) */
    tsSymbolId?: string;
}

export interface ImportInfo {
    /** Module path */
    module: string;
    /** Imported symbols */
    symbols: string[];
    /** Is default import */
    isDefault: boolean;
    /** Is namespace import */
    isNamespace: boolean;
}

export interface TypeInfo {
    /** Type string representation */
    type: string;
    /** Is primitive */
    isPrimitive: boolean;
    /** Is union type */
    isUnion: boolean;
    /** Is intersection type */
    isIntersection: boolean;
    /** Generic type parameters */
    typeParameters?: string[];
}

export interface SymbolChange {
    /** Symbol that changed */
    symbol: SymbolInfo;
    /** Change type */
    changeType: 'added' | 'removed' | 'modified' | 'signature-changed' | 'type-changed';
    /** Before state (if modified) */
    before?: SymbolInfo;
    /** After state (if modified) */
    after?: SymbolInfo;
    /** Severity of change */
    severity: 'low' | 'medium' | 'high';
    /** Is breaking change */
    isBreaking: boolean;
    /** Additional metadata (rule IDs, messages, etc.) */
    metadata?: Record<string, any>;
}

export interface ExportChange {
    /** After state (current) */
    after: ExportInfo;
    /** Before state (previous) */
    before: ExportInfo;
}

export interface PackageChange {
    ruleId: string;
    severity: 'breaking' | 'warning' | 'info';
    file: string;
    symbol: string;
    message: string;
}

export interface SnapshotDiff {
    /** Changed symbols */
    changedSymbols: SymbolChange[];
    /** Added symbols */
    added: SymbolInfo[];
    /** Removed symbols */
    removed: SymbolInfo[];
    /** Modified symbols */
    modified: SymbolChange[];
    /** Export changes */
    exportChanges: {
        added: ExportInfo[];
        removed: ExportInfo[];
        modified: ExportInfo[] | ExportChange[]; // Can be either format for backward compatibility
    };
    /** Package.json changes (exports map, type) */
    packageChanges: PackageChange[];
}
