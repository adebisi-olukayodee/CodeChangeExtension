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
import { SymbolChange, SnapshotDiff } from '../analyzers/language/SymbolSnapshot';
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
        const impactedSymbols = this.extractImpactedSymbols(snapshotDiff);
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

        // Also check export removals and re-export changes
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
        for (const modifiedExport of diff.exportChanges.modified) {
            if (modifiedExport.sourceModule) {
                breakingChanges.push({
                    ruleId: BreakingChangeRule.EXPORT_TYPE_CHANGED,
                    severity: 'breaking',
                    symbol: modifiedExport.name,
                    message: `Re-export '${modifiedExport.name}' changed`,
                    before: `export { ${modifiedExport.exportedName || modifiedExport.name}${modifiedExport.localName ? ` as ${modifiedExport.localName}` : ''} } from '${modifiedExport.sourceModule}'`,
                    after: `export { ${modifiedExport.exportedName || modifiedExport.name}${modifiedExport.localName ? ` as ${modifiedExport.localName}` : ''} } from '${modifiedExport.sourceModule}'`,
                    line: modifiedExport.line
                });
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

