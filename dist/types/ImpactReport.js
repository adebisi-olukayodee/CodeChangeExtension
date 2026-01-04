/**
 * Serialize an ImpactReport to JSON string.
 * Useful for snapshot testing and debugging.
 */
export function serializeReport(report) {
    return JSON.stringify(report, null, 2);
}
/**
 * Compare two ImpactReports for equality.
 * Useful for testing.
 */
export function reportsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
/**
 * Create an empty ImpactReport for a given file.
 */
export function createEmptyReport(sourceFile) {
    return {
        sourceFile,
        functions: [],
        downstreamFiles: [],
        tests: [],
        issues: []
    };
}
