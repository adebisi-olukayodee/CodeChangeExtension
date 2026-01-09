"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeReport = serializeReport;
exports.reportsEqual = reportsEqual;
exports.createEmptyReport = createEmptyReport;
/**
 * Serialize an ImpactReport to JSON string.
 * Useful for snapshot testing and debugging.
 */
function serializeReport(report) {
    return JSON.stringify(report, null, 2);
}
/**
 * Compare two ImpactReports for equality.
 * Useful for testing.
 */
function reportsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
/**
 * Create an empty ImpactReport for a given file.
 */
function createEmptyReport(sourceFile) {
    return {
        sourceFile,
        functions: [],
        downstreamFiles: [],
        tests: [],
        issues: []
    };
}
//# sourceMappingURL=ImpactReport.js.map