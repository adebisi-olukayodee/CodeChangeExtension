/**
 * Core contract for impact analysis results.
 * 
 * This type is designed to be:
 * - Serializable (can be converted to JSON)
 * - Testable (no Date objects, no complex nested structures)
 * - Stable (deterministic output)
 * - Focused (only what matters for impact analysis)
 * 
 * This is the contract that all tests assert against.
 */
export type ImpactReport = {
    sourceFile: string;
    functions: string[];
    downstreamFiles: string[];
    tests: string[];
    issues: Array<{
        type: "downstream" | "test" | "function";
        target: string;
    }>;
};

/**
 * Serialize an ImpactReport to JSON string.
 * Useful for snapshot testing and debugging.
 */
export function serializeReport(report: ImpactReport): string {
    return JSON.stringify(report, null, 2);
}

/**
 * Compare two ImpactReports for equality.
 * Useful for testing.
 */
export function reportsEqual(a: ImpactReport, b: ImpactReport): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Create an empty ImpactReport for a given file.
 */
export function createEmptyReport(sourceFile: string): ImpactReport {
    return {
        sourceFile,
        functions: [],
        downstreamFiles: [],
        tests: [],
        issues: []
    };
}


