/**
 * Enhanced impact report with detailed breaking changes, rule IDs, and structured output.
 * This format provides comprehensive information about API changes and their impact.
 */

export interface EnhancedImpactReport {
    /** File path that was analyzed */
    filePath: string;
    /** Breaking changes detected */
    breakingChanges: BreakingChange[];
    /** Symbols that were impacted (changed, removed, or modified) */
    impactedSymbols: string[];
    /** Downstream files that depend on the changes */
    downstreamFiles: DownstreamFile[];
    /** Tests that are affected by the changes */
    affectedTests: AffectedTest[];
    /** Summary statistics */
    summary: ImpactSummary;
}

export interface BreakingChange {
    /** Rule ID (e.g., "TSAPI-FN-001") */
    ruleId: string;
    /** Severity level */
    severity: 'breaking' | 'warning' | 'info';
    /** Symbol name that changed */
    symbol: string;
    /** Human-readable message describing the change */
    message: string;
    /** Before signature/state */
    before: string;
    /** After signature/state */
    after: string;
    /** Line number where change occurred */
    line?: number;
    /** Additional context */
    context?: Record<string, any>;
}

export interface DownstreamFile {
    /** File path */
    file: string;
    /** Reason why this file is impacted */
    reason: string;
    /** Symbols from this file that depend on the change */
    dependentSymbols?: string[];
}

export interface AffectedTest {
    /** Test file path */
    file: string;
    /** Reason why this test is affected */
    reason: string;
    /** Test cases that might be affected */
    testCases?: string[];
}

export interface ImpactSummary {
    /** Number of breaking changes */
    breakingCount: number;
    /** Number of impacted symbols */
    impactedSymbolsCount: number;
    /** Number of downstream files */
    downstreamCount: number;
    /** Number of affected tests */
    affectedTestsCount: number;
}

/**
 * Breaking change rule IDs for TypeScript API changes
 */
export enum BreakingChangeRule {
    // Function changes
    FN_PARAM_REQUIRED = 'TSAPI-FN-001',      // Parameter changed from optional to required
    FN_PARAM_REMOVED = 'TSAPI-FN-002',       // Parameter removed
    FN_PARAM_TYPE_CHANGED = 'TSAPI-FN-003', // Parameter type changed
    FN_RETURN_TYPE_CHANGED = 'TSAPI-FN-004', // Return type changed
    FN_REMOVED = 'TSAPI-FN-005',             // Function removed
    FN_SIGNATURE_CHANGED = 'TSAPI-FN-006',   // Function signature changed (generic)
    FN_OVERLOAD_CHANGED = 'TSAPI-FN-007',    // Function overload set changed
    
    // Class changes
    CLS_METHOD_REMOVED = 'TSAPI-CLS-001',    // Class method removed
    CLS_PROPERTY_REMOVED = 'TSAPI-CLS-002',  // Class property removed
    CLS_METHOD_SIGNATURE_CHANGED = 'TSAPI-CLS-003', // Class method signature changed
    CLS_REMOVED = 'TSAPI-CLS-004',           // Class removed
    
    // Interface changes
    IFACE_PROPERTY_REMOVED = 'TSAPI-IF-001', // Interface property removed
    IFACE_PROPERTY_REQUIRED = 'TSAPI-IF-002', // Interface property changed from optional to required
    IFACE_PROPERTY_TYPE_CHANGED = 'TSAPI-IF-003', // Interface property type changed
    IFACE_REMOVED = 'TSAPI-IF-004',          // Interface removed
    
    // Type alias changes
    // Following the user's recommended mapping:
    // TYPE-001: property removed
    // TYPE-002: type definition changed (generic fallback)
    // TYPE-003: property optional → required
    // TYPE-004: property type changed/narrowed
    TYPE_REMOVED = 'TSAPI-TYPE-001',         // Type alias removed (entire type) - reusing TYPE-001
    TYPE_DEFINITION_CHANGED = 'TSAPI-TYPE-002', // Type definition changed (generic fallback for non-object-literal types)
    TYPE_PROPERTY_REQUIRED = 'TSAPI-TYPE-003', // Type property changed from optional to required
    TYPE_PROPERTY_TYPE_CHANGED = 'TSAPI-TYPE-004', // Type property type changed/narrowed
    
    // Enum changes
    ENUM_MEMBER_REMOVED = 'TSAPI-ENUM-001',  // Enum member removed
    ENUM_REMOVED = 'TSAPI-ENUM-002',         // Enum removed
    
    // Export changes
    EXPORT_REMOVED = 'TSAPI-EXP-001',        // Export removed
    EXPORT_TYPE_CHANGED = 'TSAPI-EXP-002',   // Export type changed (named -> default, etc.)
    
    // JavaScript heuristic rules (warnings, not breaking)
    // These are structural-only and may miss runtime-breaking changes
    JSAPI_FN_REMOVED = 'JSAPI-FN-001',       // Exported function removed (heuristic)
    JSAPI_FN_PARAM_COUNT_DECREASED = 'JSAPI-FN-002', // Function parameter count decreased (heuristic)
    JSAPI_FN_REST_PARAM_REMOVED = 'JSAPI-FN-003',    // Rest parameter removed (heuristic)
    JSAPI_CLS_REMOVED = 'JSAPI-CLS-001',     // Exported class removed (heuristic)
    JSAPI_CLS_METHOD_REMOVED = 'JSAPI-CLS-002', // Public method removed from class (heuristic)
    JSAPI_CLS_CONSTRUCTOR_REMOVED = 'JSAPI-CLS-003', // Constructor removed from class (heuristic)
    JSAPI_EXPORT_REMOVED = 'JSAPI-EXP-001',  // Export removed (structural - reliable, breaking)
    JSAPI_DEFAULT_EXPORT_REMOVED = 'JSAPI-EXP-002', // Default export removed (breaking)
    JSAPI_EXPORT_STAR_REMOVED = 'JSAPI-EXP-003', // Export star removed (breaking)
    JSAPI_EXPORT_ALIAS_CHANGED = 'JSAPI-EXP-004', // Export alias changed (breaking)
    JSAPI_DEFAULT_EXPORT_KIND_CHANGED = 'JSAPI-EXP-005', // Default export kind changed (breaking)
    JSAPI_EXPORT_TYPE_CHANGED = 'JSAPI-EXP-006', // Named to default export (breaking)
    JSAPI_DEFAULT_TO_NAMED_EXPORT = 'JSAPI-EXP-007', // Default to named export (breaking)
    JSAPI_BARREL_EXPORT_REMOVED = 'JSAPI-EXP-008', // Barrel export removed (breaking)
    JSAPI_CJS_EXPORT_REMOVED = 'JSAPI-CJS-001', // CommonJS export removed (breaking)
    JSAPI_CJS_DEFAULT_SHAPE_CHANGED = 'JSAPI-CJS-002', // CJS default export shape changed (warning)
    JSAPI_MODULE_SYSTEM_CHANGED = 'JSAPI-MOD-001', // Module system changed (CJS <-> ESM) (warning)
    JSAPI_PACKAGE_TYPE_CHANGED = 'JSAPI-MOD-002', // package.json type changed (warning)
    JSAPI_IMPORT_SPECIFIER_CHANGED = 'JSAPI-MOD-003', // Import specifier changed (info)
    JSAPI_PACKAGE_EXPORTS_CHANGED = 'JSAPI-MOD-004', // package.json exports map changed (breaking)
    JSAPI_JSX_COMPONENT_REMOVED = 'JSAPI-JSX-001', // JSX component removed (breaking)
}

