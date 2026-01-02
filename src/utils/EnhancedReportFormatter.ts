/**
 * Formatter to convert analysis results into enhanced impact report format.
 */

import * as path from 'path';
import {
    EnhancedImpactReport,
    BreakingChange,
    DownstreamFile,
    AffectedTest,
    ImpactSummary,
    BreakingChangeRule
} from '../types/EnhancedImpactReport';
import { SymbolChange, SnapshotDiff, ExportInfo, ExportChange } from '../analyzers/language/SymbolSnapshot';
import { ImpactReport } from '../types/ImpactReport';

export class EnhancedReportFormatter {
    /**
     * Convert a SnapshotDiff and ImpactReport into an EnhancedImpactReport
     */
    static format(
        filePath: string,
        snapshotDiff: SnapshotDiff,
        impactReport: ImpactReport,
        projectRoot: string
    ): EnhancedImpactReport {
        const breakingChanges = this.extractBreakingChanges(snapshotDiff);
        
        // Option A: Derive impactedSymbols from findings (breaking changes)
        // This ensures consistency - every breaking change's symbol is in impactedSymbols
        const impactedSymbolsSet = new Set<string>();
        
        for (const breakingChange of breakingChanges) {
            if (breakingChange.symbol) {
                // Add the primary symbol (e.g., "Client.ping")
                // This is the precise symbol that changed - keep as primary for tests and UI
                impactedSymbolsSet.add(breakingChange.symbol);
                
                // For class method removals, also include the container class for broader matching
                // This helps with dependency analysis and UI grouping while keeping precision
                // Primary: Client.ping (precision), Also: Client (broader matching / UI grouping)
                if (breakingChange.ruleId === BreakingChangeRule.CLS_METHOD_REMOVED) {
                    // Extract container class name from qualified method name (e.g., "Client.ping" -> "Client")
                    const parts = breakingChange.symbol.split('.');
                    if (parts.length > 1) {
                        const containerName = parts.slice(0, -1).join('.');
                        impactedSymbolsSet.add(containerName);
                    }
                }
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
    private static extractBreakingChanges(diff: SnapshotDiff): BreakingChange[] {
        console.log(`[EnhancedReportFormatter] Extracting breaking changes from diff`);
        console.log(`[EnhancedReportFormatter]   - Changed symbols: ${diff.changedSymbols.length}`);
        console.log(`[EnhancedReportFormatter]   - Export changes: ${diff.exportChanges.removed.length} removed, ${diff.exportChanges.modified.length} modified`);
        
        const breakingChanges: BreakingChange[] = [];

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
                ruleId: BreakingChangeRule.EXPORT_REMOVED,
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
                const change = modifiedExport as { before: ExportInfo; after: ExportInfo };
                const before = change.before;
                const after = change.after;
                
                console.log(`[EnhancedReportFormatter] Processing export change: name='${after.name}', before sourceName='${before.sourceName}', after sourceName='${after.sourceName}'`);
                
                if (after.sourceModule) {
                    // This is a re-export change - sourceModule or sourceName changed
                    const beforeSourceName = before.sourceName || before.name;
                    const afterSourceName = after.sourceName || after.name;
                    
                    const breakingChange: BreakingChange = {
                        ruleId: BreakingChangeRule.EXPORT_TYPE_CHANGED,
                        severity: 'breaking',
                        symbol: after.name, // Public API name (what consumers see - 'x' in both cases)
                        message: `Re-export '${after.name}' changed source from '${beforeSourceName}' to '${afterSourceName}' in '${after.sourceModule}'`,
                        before: `export { ${beforeSourceName} as ${after.name} } from '${before.sourceModule || after.sourceModule}'`,
                        after: `export { ${afterSourceName} as ${after.name} } from '${after.sourceModule}'`,
                        line: after.line
                    };
                    
                    breakingChanges.push(breakingChange);
                    console.log(`[EnhancedReportFormatter] ✅ Emitted TSAPI-EXP-002 for '${after.name}'`);
                }
            } else {
                // Legacy format - just ExportInfo (for non-re-export changes)
                const exportInfo = modifiedExport as ExportInfo;
                if (exportInfo.sourceModule) {
                    // Fallback for re-export changes in legacy format
                    breakingChanges.push({
                        ruleId: BreakingChangeRule.EXPORT_TYPE_CHANGED,
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
    private static getRuleId(change: SymbolChange): string {
        // Check if metadata has ruleId
        if (change.metadata?.ruleId) {
            return change.metadata.ruleId;
        }

        // Infer rule ID from change type and symbol kind
        const kind = change.symbol.kind;
        const changeType = change.changeType;

        if (kind === 'function' || kind === 'method') {
            if (changeType === 'removed') {
                return kind === 'method' ? BreakingChangeRule.CLS_METHOD_REMOVED : BreakingChangeRule.FN_REMOVED;
            }
            if (changeType === 'signature-changed') {
                return kind === 'method' ? BreakingChangeRule.CLS_METHOD_SIGNATURE_CHANGED : BreakingChangeRule.FN_SIGNATURE_CHANGED;
            }
            if (changeType === 'type-changed') {
                return BreakingChangeRule.FN_RETURN_TYPE_CHANGED;
            }
        }

        if (kind === 'class') {
            if (changeType === 'removed') {
                return BreakingChangeRule.CLS_REMOVED;
            }
        }

        if (kind === 'interface') {
            if (changeType === 'removed') {
                return BreakingChangeRule.IFACE_REMOVED;
            }
        }

        if (kind === 'type') {
            if (changeType === 'removed') {
                return BreakingChangeRule.TYPE_REMOVED;
            }
            if (changeType === 'type-changed') {
                return BreakingChangeRule.TYPE_DEFINITION_CHANGED;
            }
        }

        if (kind === 'enum') {
            if (changeType === 'removed') {
                return BreakingChangeRule.ENUM_REMOVED;
            }
        }

        // Safe fallback based on kind (not always function)
        if (kind === 'class') {
            return BreakingChangeRule.CLS_METHOD_SIGNATURE_CHANGED;
        }
        if (kind === 'interface') {
            return BreakingChangeRule.IFACE_PROPERTY_TYPE_CHANGED;
        }
        if (kind === 'type') {
            return BreakingChangeRule.TYPE_DEFINITION_CHANGED;
        }
        if (kind === 'enum') {
            return BreakingChangeRule.ENUM_REMOVED;
        }
        
        // Default fallback for functions/methods
        return BreakingChangeRule.FN_SIGNATURE_CHANGED;
    }

    /**
     * Generate human-readable message for breaking change
     */
    private static getBreakingChangeMessage(change: SymbolChange): string {
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
    private static getBeforeSignature(change: SymbolChange): string {
        if (change.before) {
            return change.before.signature;
        }
        return change.symbol.signature;
    }

    /**
     * Get after signature string
     */
    private static getAfterSignature(change: SymbolChange): string {
        return change.symbol.signature;
    }

    /**
     * Extract list of impacted symbol names
     * @deprecated Use breakingChanges.map(f => f.symbol) instead - this ensures consistency
     */
    private static extractImpactedSymbols(diff: SnapshotDiff): string[] {
        const symbols = new Set<string>();

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
    private static formatDownstreamFiles(
        downstreamFiles: string[],
        projectRoot: string
    ): DownstreamFile[] {
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
    private static formatAffectedTests(
        tests: string[],
        projectRoot: string
    ): AffectedTest[] {
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
    static toJSON(report: EnhancedImpactReport, indent: number = 2): string {
        return JSON.stringify(report, null, indent);
    }
}

