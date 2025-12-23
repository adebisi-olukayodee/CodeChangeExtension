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
    TYPE_REMOVED = 'TSAPI-TYPE-001',         // Type alias removed
    TYPE_DEFINITION_CHANGED = 'TSAPI-TYPE-002', // Type definition changed
    
    // Enum changes
    ENUM_MEMBER_REMOVED = 'TSAPI-ENUM-001',  // Enum member removed
    ENUM_REMOVED = 'TSAPI-ENUM-002',         // Enum removed
    
    // Export changes
    EXPORT_REMOVED = 'TSAPI-EXP-001',        // Export removed
    EXPORT_TYPE_CHANGED = 'TSAPI-EXP-002',   // Export type changed (named -> default, etc.)
}

