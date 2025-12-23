"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyReport = exports.reportsEqual = exports.serializeReport = void 0;
/**
 * Serialize an ImpactReport to JSON string.
 * Useful for snapshot testing and debugging.
 */
function serializeReport(report) {
    return JSON.stringify(report, null, 2);
}
exports.serializeReport = serializeReport;
/**
 * Compare two ImpactReports for equality.
 * Useful for testing.
 */
function reportsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
exports.reportsEqual = reportsEqual;
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
exports.createEmptyReport = createEmptyReport;
//# sourceMappingURL=ImpactReport.js.map