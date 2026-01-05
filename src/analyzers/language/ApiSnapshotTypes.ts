/**
 * API Snapshot Types - normalized representations of exported symbol signatures
 * Used for comparing API surfaces between versions to detect breaking changes.
 */

/**
 * Unique identity for an exported symbol
 */
export type ExportIdentity = string; // Format: exportName|isTypeOnly|declFilePath|declPos

/**
 * Function signature snapshot
 */
export interface FunctionApiShape {
    kind: 'function';
    name: string;
    /** Overload signatures (normalized) */
    overloads: FunctionSignature[];
    /** Type parameters */
    typeParameters?: string[];
}

export interface FunctionSignature {
    /** Parameter list (normalized) */
    parameters: ParameterSignature[];
    /** Return type text (normalized) */
    returnType: string;
    /** Type parameters for this overload */
    typeParameters?: string[];
}

export interface ParameterSignature {
    name: string;
    type: string;
    optional: boolean;
    rest?: boolean;
    /** Default value text (if any) */
    defaultValue?: string;
}

/**
 * Class API shape
 */
export interface ClassApiShape {
    kind: 'class';
    name: string;
    /** Type parameters */
    typeParameters?: string[];
    /** Public/protected members */
    members: ClassMember[];
    /** Constructor signature */
    constructor?: FunctionSignature;
    /** Extends clause */
    extends?: string;
    /** Implements clauses */
    implements?: string[];
}

export interface ClassMember {
    name: string;
    kind: 'method' | 'property' | 'get' | 'set' | 'constructor';
    optional?: boolean;
    readonly?: boolean;
    visibility: 'public' | 'protected' | 'private';
    /** Method signature (for methods/get/set) */
    signature?: FunctionSignature;
    /** Property type (for properties) */
    type?: string;
    /** Static */
    static?: boolean;
}

/**
 * Type/Interface API shape
 */
export interface TypeApiShape {
    kind: 'type' | 'interface';
    name: string;
    /** Type parameters */
    typeParameters?: string[];
    /** Properties */
    properties: TypeProperty[];
    /** Index signatures */
    indexSignatures?: IndexSignature[];
    /** Type text (for complex types: unions, intersections, etc.) */
    typeText?: string;
    /** Extends clauses (for interfaces) */
    extends?: string[];
}

export interface TypeProperty {
    name: string;
    type: string;
    optional?: boolean;
    readonly?: boolean;
}

export interface IndexSignature {
    keyType: string;
    valueType: string;
    readonly?: boolean;
}

/**
 * Enum API shape
 */
export interface EnumApiShape {
    kind: 'enum';
    name: string;
    /** Enum members */
    members: EnumMember[];
    /** Is const enum */
    const?: boolean;
}

export interface EnumMember {
    name: string;
    /** Value (string or number) */
    value?: string | number;
}

/**
 * Variable/Const API shape
 */
export interface VariableApiShape {
    kind: 'variable' | 'const';
    name: string;
    type: string;
    readonly?: boolean;
}

/**
 * Union of all API shapes
 */
export type ApiShape = 
    | FunctionApiShape 
    | ClassApiShape 
    | TypeApiShape 
    | EnumApiShape 
    | VariableApiShape;

/**
 * Complete API snapshot for an entrypoint
 * Maps export identity to API shape
 */
export interface ApiSnapshot {
    /** Entrypoint file path */
    entrypointPath: string;
    /** Map of export identity to API shape */
    exports: Map<ExportIdentity, ApiShape>;
    /** Timestamp */
    timestamp: Date;
}

/**
 * API diff result
 */
export interface ApiDiff {
    /** Removed exports (breaking) */
    removed: Array<{ identity: ExportIdentity; shape: ApiShape }>;
    /** Added exports (non-breaking) */
    added: Array<{ identity: ExportIdentity; shape: ApiShape }>;
    /** Modified exports (breaking/warn) */
    modified: Array<{
        identity: ExportIdentity;
        before: ApiShape;
        after: ApiShape;
        changes: string[]; // Description of changes
    }>;
    /** Renamed/moved exports (matched by name/kind fallback) */
    renamed: Array<{
        beforeIdentity: ExportIdentity;
        afterIdentity: ExportIdentity;
        name: string;
    }>;
}

/**
 * Resolved export with declaration location
 */
export interface ResolvedExport {
    /** Exported name (public API) */
    exportName: string;
    /** Is type-only export */
    isTypeOnly: boolean;
    /** Declaration file path */
    declFilePath: string;
    /** Declaration start position */
    declPos: number;
    /** Declaration end position */
    declEnd: number;
    /** TypeScript symbol (for building API shape) */
    tsSymbol?: any; // ts.Symbol from TypeScript compiler API
    /** Source module (if re-exported) */
    sourceModule?: string;
    /** Export kind */
    kind: string;
}





