"use strict";
/**
 * Formatter to convert analysis results into enhanced impact report format.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedReportFormatter = void 0;
const path = __importStar(require("path"));
const EnhancedImpactReport_1 = require("../types/EnhancedImpactReport");
class EnhancedReportFormatter {
    /**
     * Convert a SnapshotDiff and ImpactReport into an EnhancedImpactReport
     */
    static format(filePath, snapshotDiff, impactReport, projectRoot) {
        const breakingChanges = this.extractBreakingChanges(snapshotDiff);
        // Option A: Derive impactedSymbols from findings (breaking changes)
        // This ensures consistency - every breaking change's symbol is in impactedSymbols
        const impactedSymbolsSet = new Set();
        for (const breakingChange of breakingChanges) {
            if (breakingChange.symbol) {
                // Add the primary symbol (e.g., "Client.ping")
                // This is the precise symbol that changed - keep as primary for tests and UI
                impactedSymbolsSet.add(breakingChange.symbol);
                // Optional: For class method removals, also include the container class for broader matching
                // This helps with dependency analysis and UI grouping while keeping precision
                // Currently disabled to match test expectations, but can be enabled for production
                // if (breakingChange.ruleId === BreakingChangeRule.CLS_METHOD_REMOVED) {
                //     // Extract container class name from qualified method name (e.g., "Client.ping" -> "Client")
                //     const parts = breakingChange.symbol.split('.');
                //     if (parts.length > 1) {
                //         const containerName = parts.slice(0, -1).join('.');
                //         impactedSymbolsSet.add(containerName);
                //     }
                // }
            }
        }
        const impactedSymbols = Array.from(impactedSymbolsSet).sort();
        const downstreamFiles = this.formatDownstreamFiles(impactReport.downstreamFiles, projectRoot);
        const affectedTests = this.formatAffectedTests(impactReport.tests, projectRoot);
        return {
            filePath: path.relative(projectRoot, filePath),
            breakingChanges,
            impactedSymbols,
            downstreamFiles,
            affectedTests,
            summary: {
                breakingCount: breakingChanges.length,
                impactedSymbolsCount: impactedSymbols.length,
                downstreamCount: downstreamFiles.length,
                affectedTestsCount: affectedTests.length
            }
        };
    }
    /**
     * Extract breaking changes from SnapshotDiff
     */
    static extractBreakingChanges(diff) {
        console.log(`[EnhancedReportFormatter] Extracting breaking changes from diff`);
        console.log(`[EnhancedReportFormatter]   - Changed symbols: ${diff.changedSymbols.length}`);
        console.log(`[EnhancedReportFormatter]   - Export changes: ${diff.exportChanges.removed.length} removed, ${diff.exportChanges.modified.length} modified`);
        const breakingChanges = [];
        for (const change of diff.changedSymbols) {
            if (!change.isBreaking) {
                continue;
            }
            const ruleId = this.getRuleId(change);
            const message = this.getBreakingChangeMessage(change);
            const before = this.getBeforeSignature(change);
            const after = this.getAfterSignature(change);
            breakingChanges.push({
                ruleId,
                severity: 'breaking',
                symbol: change.symbol.qualifiedName,
                message,
                before,
                after,
                line: change.symbol.line,
                context: {
                    changeType: change.changeType,
                    isExported: change.symbol.isExported,
                    kind: change.symbol.kind
                }
            });
        }
        // Export removals are the source of truth for TSAPI-EXP-001
        // Symbols in removed exports are suppressed from function/class/type removal rules
        // So we always emit TSAPI-EXP-001 for removed exports
        for (const removedExport of diff.exportChanges.removed) {
            breakingChanges.push({
                ruleId: EnhancedImpactReport_1.BreakingChangeRule.EXPORT_REMOVED,
                severity: 'breaking',
                symbol: removedExport.name,
                message: removedExport.sourceModule
                    ? `Re-export '${removedExport.name}' from '${removedExport.sourceModule}' was removed`
                    : `Export '${removedExport.name}' was removed`,
                before: removedExport.sourceModule
                    ? `export { ${removedExport.exportedName || removedExport.name}${removedExport.localName ? ` as ${removedExport.localName}` : ''} } from '${removedExport.sourceModule}'`
                    : `${removedExport.type} export ${removedExport.name}`,
                after: '(removed)',
                line: removedExport.line
            });
        }
        // Check for re-export changes (TSAPI-EXP-002)
        console.log(`[EnhancedReportFormatter] Processing ${diff.exportChanges.modified.length} modified exports`);
        console.log(`[EnhancedReportFormatter] Modified exports details:`, JSON.stringify(diff.exportChanges.modified, null, 2));
        for (const modifiedExport of diff.exportChanges.modified) {
            // Check if it's an ExportChange object (with before/after) or just ExportInfo
            if ('before' in modifiedExport && 'after' in modifiedExport) {
                // Enhanced format with before/after
                const change = modifiedExport;
                const before = change.before;
                const after = change.after;
                console.log(`[EnhancedReportFormatter] Processing export change: name='${after.name}', before sourceName='${before.sourceName}', after sourceName='${after.sourceName}'`);
                if (after.sourceModule) {
                    // This is a re-export change - sourceModule or sourceName changed
                    const beforeSourceName = before.sourceName || before.name;
                    const afterSourceName = after.sourceName || after.name;
                    const breakingChange = {
                        ruleId: EnhancedImpactReport_1.BreakingChangeRule.EXPORT_TYPE_CHANGED,
                        severity: 'breaking',
                        symbol: after.name,
                        message: `Re-export '${after.name}' changed source from '${beforeSourceName}' to '${afterSourceName}' in '${after.sourceModule}'`,
                        before: `export { ${beforeSourceName} as ${after.name} } from '${before.sourceModule || after.sourceModule}'`,
                        after: `export { ${afterSourceName} as ${after.name} } from '${after.sourceModule}'`,
                        line: after.line
                    };
                    breakingChanges.push(breakingChange);
                    console.log(`[EnhancedReportFormatter] ✅ Emitted TSAPI-EXP-002 for '${after.name}'`);
                }
            }
            else {
                // Legacy format - just ExportInfo (for non-re-export changes)
                const exportInfo = modifiedExport;
                if (exportInfo.sourceModule) {
                    // Fallback for re-export changes in legacy format
                    breakingChanges.push({
                        ruleId: EnhancedImpactReport_1.BreakingChangeRule.EXPORT_TYPE_CHANGED,
                        severity: 'breaking',
                        symbol: exportInfo.name,
                        message: `Re-export '${exportInfo.name}' changed`,
                        before: `export { ... } from '${exportInfo.sourceModule}'`,
                        after: `export { ${exportInfo.sourceName || exportInfo.name} as ${exportInfo.name} } from '${exportInfo.sourceModule}'`,
                        line: exportInfo.line
                    });
                }
            }
        }
        return breakingChanges;
    }
    /**
     * Get rule ID for a symbol change
     */
    static getRuleId(change) {
        // Check if metadata has ruleId
        if (change.metadata?.ruleId) {
            return change.metadata.ruleId;
        }
        // Infer rule ID from change type and symbol kind
        const kind = change.symbol.kind;
        const changeType = change.changeType;
        if (kind === 'function' || kind === 'method') {
            if (changeType === 'removed') {
                return kind === 'method' ? EnhancedImpactReport_1.BreakingChangeRule.CLS_METHOD_REMOVED : EnhancedImpactReport_1.BreakingChangeRule.FN_REMOVED;
            }
            if (changeType === 'signature-changed') {
                return kind === 'method' ? EnhancedImpactReport_1.BreakingChangeRule.CLS_METHOD_SIGNATURE_CHANGED : EnhancedImpactReport_1.BreakingChangeRule.FN_SIGNATURE_CHANGED;
            }
            if (changeType === 'type-changed') {
                return EnhancedImpactReport_1.BreakingChangeRule.FN_RETURN_TYPE_CHANGED;
            }
        }
        if (kind === 'class') {
            if (changeType === 'removed') {
                return EnhancedImpactReport_1.BreakingChangeRule.CLS_REMOVED;
            }
        }
        if (kind === 'interface') {
            if (changeType === 'removed') {
                return EnhancedImpactReport_1.BreakingChangeRule.IFACE_REMOVED;
            }
        }
        if (kind === 'type') {
            if (changeType === 'removed') {
                return EnhancedImpactReport_1.BreakingChangeRule.TYPE_REMOVED;
            }
            if (changeType === 'type-changed') {
                return EnhancedImpactReport_1.BreakingChangeRule.TYPE_DEFINITION_CHANGED;
            }
        }
        if (kind === 'enum') {
            if (changeType === 'removed') {
                return EnhancedImpactReport_1.BreakingChangeRule.ENUM_REMOVED;
            }
        }
        // Safe fallback based on kind (not always function)
        if (kind === 'class') {
            return EnhancedImpactReport_1.BreakingChangeRule.CLS_METHOD_SIGNATURE_CHANGED;
        }
        if (kind === 'interface') {
            return EnhancedImpactReport_1.BreakingChangeRule.IFACE_PROPERTY_TYPE_CHANGED;
        }
        if (kind === 'type') {
            return EnhancedImpactReport_1.BreakingChangeRule.TYPE_DEFINITION_CHANGED;
        }
        if (kind === 'enum') {
            return EnhancedImpactReport_1.BreakingChangeRule.ENUM_REMOVED;
        }
        // Default fallback for functions/methods
        return EnhancedImpactReport_1.BreakingChangeRule.FN_SIGNATURE_CHANGED;
    }
    /**
     * Generate human-readable message for breaking change
     */
    static getBreakingChangeMessage(change) {
        if (change.metadata?.message) {
            return change.metadata.message;
        }
        const symbolName = change.symbol.qualifiedName;
        const kind = change.symbol.kind;
        switch (change.changeType) {
            case 'removed':
                return `${kind === 'function' ? 'Function' : kind === 'class' ? 'Class' : kind === 'interface' ? 'Interface' : 'Symbol'} '${symbolName}' was removed`;
            case 'signature-changed':
                return `${kind === 'function' ? 'Function' : 'Method'} '${symbolName}' signature changed`;
            case 'type-changed':
                return `${kind === 'function' ? 'Function' : 'Symbol'} '${symbolName}' type changed`;
            default:
                return `Symbol '${symbolName}' changed`;
        }
    }
    /**
     * Get before signature string
     */
    static getBeforeSignature(change) {
        if (change.before) {
            return change.before.signature;
        }
        return change.symbol.signature;
    }
    /**
     * Get after signature string
     */
    static getAfterSignature(change) {
        return change.symbol.signature;
    }
    /**
     * Extract list of impacted symbol names
     * @deprecated Use breakingChanges.map(f => f.symbol) instead - this ensures consistency
     */
    static extractImpactedSymbols(diff) {
        const symbols = new Set();
        for (const change of diff.changedSymbols) {
            if (change.isBreaking || change.severity === 'high' || change.severity === 'medium') {
                symbols.add(change.symbol.qualifiedName);
            }
        }
        return Array.from(symbols).sort();
    }
    /**
     * Format downstream files with reasons
     */
    static formatDownstreamFiles(downstreamFiles, projectRoot) {
        return downstreamFiles.map(file => {
            const relativePath = path.isAbsolute(file) ? path.relative(projectRoot, file) : file;
            return {
                file: relativePath,
                reason: `Imports or depends on changed symbols`
            };
        });
    }
    /**
     * Format affected tests with reasons
     */
    static formatAffectedTests(tests, projectRoot) {
        return tests.map(testFile => {
            const relativePath = path.isAbsolute(testFile) ? path.relative(projectRoot, testFile) : testFile;
            return {
                file: relativePath,
                reason: `Tests code that depends on changed symbols`
            };
        });
    }
    /**
     * Convert EnhancedImpactReport to JSON string (pretty printed)
     */
    static toJSON(report, indent = 2) {
        return JSON.stringify(report, null, indent);
    }
}
exports.EnhancedReportFormatter = EnhancedReportFormatter;
//# sourceMappingURL=EnhancedReportFormatter.js.map