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

/**
 * Rule IDs that should never get the heuristic suffix, even if marked as heuristic.
 * These rules either:
 * - Have messages that are already explicit enough about their nature
 * - Are warning-only rules where the severity itself indicates uncertainty
 * 
 * Uses explicit rule ID strings (not constants) to ensure stability if constants are refactored.
 */
const NO_HEURISTIC_SUFFIX_RULES = new Set<string>([
    'JSAPI-CLS-002', // Exported class removed - should be breaking, not heuristic
    'JSAPI-CLS-003', // Constructor removed - message is already explicit
    'JSAPI-FN-002', // Rest parameter removed - message is already explicit
]);

/**
 * Rule metadata: defines which rules require heuristic disclaimers
 * Rules marked as heuristic: true will get the "(JavaScript heuristic - may miss runtime changes)" suffix
 * Rules marked as heuristic: false will not get the suffix (either because they're reliable or already indicate uncertainty)
 */
const RULE_METADATA: Record<string, { heuristic: boolean }> = {
    // TypeScript rules - never heuristic (type-aware, reliable)
    [BreakingChangeRule.FN_REMOVED]: { heuristic: false },
    [BreakingChangeRule.FN_SIGNATURE_CHANGED]: { heuristic: false },
    [BreakingChangeRule.FN_PARAM_REMOVED]: { heuristic: false },
    [BreakingChangeRule.FN_RETURN_TYPE_CHANGED]: { heuristic: false },
    [BreakingChangeRule.CLS_REMOVED]: { heuristic: false },
    [BreakingChangeRule.CLS_METHOD_REMOVED]: { heuristic: false },
    [BreakingChangeRule.CLS_METHOD_SIGNATURE_CHANGED]: { heuristic: false },
    [BreakingChangeRule.IFACE_PROPERTY_REMOVED]: { heuristic: false },
    [BreakingChangeRule.IFACE_PROPERTY_REQUIRED]: { heuristic: false },
    [BreakingChangeRule.IFACE_PROPERTY_TYPE_CHANGED]: { heuristic: false },
    [BreakingChangeRule.TYPE_REMOVED]: { heuristic: false },
    [BreakingChangeRule.TYPE_DEFINITION_CHANGED]: { heuristic: false },
    [BreakingChangeRule.TYPE_PROPERTY_REQUIRED]: { heuristic: false },
    [BreakingChangeRule.TYPE_PROPERTY_TYPE_CHANGED]: { heuristic: false },
    [BreakingChangeRule.ENUM_MEMBER_REMOVED]: { heuristic: false },
    [BreakingChangeRule.ENUM_REMOVED]: { heuristic: false },
    [BreakingChangeRule.EXPORT_REMOVED]: { heuristic: false },
    [BreakingChangeRule.EXPORT_TYPE_CHANGED]: { heuristic: false },
    
    // JavaScript export rules - structural and reliable, NOT heuristic
    [BreakingChangeRule.JSAPI_EXPORT_REMOVED]: { heuristic: false },
    [BreakingChangeRule.JSAPI_DEFAULT_EXPORT_REMOVED]: { heuristic: false },
    [BreakingChangeRule.JSAPI_EXPORT_STAR_REMOVED]: { heuristic: false },
    [BreakingChangeRule.JSAPI_EXPORT_ALIAS_CHANGED]: { heuristic: false },
    [BreakingChangeRule.JSAPI_DEFAULT_EXPORT_KIND_CHANGED]: { heuristic: false },
    [BreakingChangeRule.JSAPI_EXPORT_TYPE_CHANGED]: { heuristic: false },
    [BreakingChangeRule.JSAPI_DEFAULT_TO_NAMED_EXPORT]: { heuristic: false },
    [BreakingChangeRule.JSAPI_BARREL_EXPORT_REMOVED]: { heuristic: false },
    [BreakingChangeRule.JSAPI_CJS_EXPORT_REMOVED]: { heuristic: false },
    [BreakingChangeRule.JSAPI_JSX_COMPONENT_REMOVED]: { heuristic: false },
    
    // JavaScript function/class rules - heuristic (structural only, may miss runtime changes)
    // Messages already indicate uncertainty (e.g., "Potential breaking change"), so redundant disclaimer will be skipped
    [BreakingChangeRule.JSAPI_FN_REMOVED]: { heuristic: true },
    [BreakingChangeRule.JSAPI_FN_PARAM_COUNT_DECREASED]: { heuristic: true },
    [BreakingChangeRule.JSAPI_FN_REST_PARAM_REMOVED]: { heuristic: true },
    [BreakingChangeRule.JSAPI_CLS_REMOVED]: { heuristic: true },
    [BreakingChangeRule.JSAPI_CLS_METHOD_REMOVED]: { heuristic: true },
    [BreakingChangeRule.JSAPI_CLS_CONSTRUCTOR_REMOVED]: { heuristic: true },
    
    // JavaScript module/system rules - heuristic (may miss runtime changes)
    // Messages already indicate uncertainty (e.g., "likely breaking"), so redundant disclaimer will be skipped
    [BreakingChangeRule.JSAPI_CJS_DEFAULT_SHAPE_CHANGED]: { heuristic: true },
    [BreakingChangeRule.JSAPI_MODULE_SYSTEM_CHANGED]: { heuristic: true },
    [BreakingChangeRule.JSAPI_PACKAGE_TYPE_CHANGED]: { heuristic: true },
    [BreakingChangeRule.JSAPI_IMPORT_SPECIFIER_CHANGED]: { heuristic: true },
    [BreakingChangeRule.JSAPI_PACKAGE_EXPORTS_CHANGED]: { heuristic: true },
};

/**
 * Check if a rule requires a heuristic disclaimer
 */
function isHeuristicRule(ruleId: string): boolean {
    const metadata = RULE_METADATA[ruleId];
    return metadata?.heuristic === true;
}

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
        const breakingChanges = this.extractBreakingChanges(snapshotDiff, filePath);
        
        // Add package.json changes to breaking changes
        for (const pkgChange of snapshotDiff.packageChanges) {
            breakingChanges.push({
                ruleId: pkgChange.ruleId,
                severity: pkgChange.severity,
                symbol: pkgChange.symbol,
                message: pkgChange.message,
                before: '',
                after: '',
                line: 1, // package.json changes don't have line numbers
            });
        }
        
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
     * Rule priority map: more specific rules have higher priority (lower number = higher priority)
     * When deduplicating findings for the same (file, symbol), keep the rule with highest priority
     */
    private static readonly RULE_PRIORITY: Map<string, number> = new Map([
        // Most specific export rules (highest priority)
        [BreakingChangeRule.JSAPI_DEFAULT_EXPORT_REMOVED, 1],
        [BreakingChangeRule.JSAPI_EXPORT_STAR_REMOVED, 2],
        [BreakingChangeRule.JSAPI_CJS_EXPORT_REMOVED, 3],
        [BreakingChangeRule.JSAPI_BARREL_EXPORT_REMOVED, 4],
        [BreakingChangeRule.JSAPI_EXPORT_ALIAS_CHANGED, 5],
        [BreakingChangeRule.JSAPI_DEFAULT_EXPORT_KIND_CHANGED, 6],
        [BreakingChangeRule.JSAPI_EXPORT_TYPE_CHANGED, 7],
        [BreakingChangeRule.JSAPI_DEFAULT_TO_NAMED_EXPORT, 8],
        // Generic export rules (lower priority - will be suppressed if more specific rule exists)
        [BreakingChangeRule.JSAPI_EXPORT_REMOVED, 100],
        [BreakingChangeRule.EXPORT_REMOVED, 101],
    ]);

    /**
     * Get priority for a rule ID (lower number = higher priority)
     */
    private static getRulePriority(ruleId: string): number {
        return this.RULE_PRIORITY.get(ruleId) ?? 999; // Unknown rules have lowest priority
    }

    /**
     * Deduplicate breaking changes by keeping the most specific rule for each (file, symbol) pair
     */
    private static deduplicateBreakingChanges(breakingChanges: BreakingChange[], filePath: string): BreakingChange[] {
        // Group by (file, symbol) - use relative path for file
        const byKey = new Map<string, BreakingChange[]>();
        const fileKey = filePath.replace(/\\/g, '/');
        
        for (const bc of breakingChanges) {
            const key = `${fileKey}:${bc.symbol}`;
            if (!byKey.has(key)) {
                byKey.set(key, []);
            }
            byKey.get(key)!.push(bc);
        }

        // For each (file, symbol) group, keep only the finding with highest priority (lowest number)
        const deduplicated: BreakingChange[] = [];
        for (const [key, findings] of byKey) {
            if (findings.length === 1) {
                deduplicated.push(findings[0]);
            } else {
                // Multiple findings for same symbol - keep the most specific one
                findings.sort((a, b) => {
                    const priorityA = this.getRulePriority(a.ruleId);
                    const priorityB = this.getRulePriority(b.ruleId);
                    return priorityA - priorityB; // Lower number = higher priority
                });
                deduplicated.push(findings[0]); // Keep the first (highest priority) one
            }
        }

        return deduplicated;
    }

    /**
     * Extract breaking changes from SnapshotDiff
     */
    private static extractBreakingChanges(diff: SnapshotDiff, filePath: string): BreakingChange[] {
        console.log(`[EnhancedReportFormatter] Extracting breaking changes from diff`);
        console.log(`[EnhancedReportFormatter]   - Changed symbols: ${diff.changedSymbols.length}`);
        console.log(`[EnhancedReportFormatter]   - Export changes: ${diff.exportChanges.added.length} added, ${diff.exportChanges.removed.length} removed, ${diff.exportChanges.modified.length} modified`);
        
        const breakingChanges: BreakingChange[] = [];
        
        // Track symbols that have been handled by type change findings (JSAPI-EXP-006/007)
        // to suppress generic removal findings (JSAPI-EXP-001/002)
        // This must be declared early so it can be used in both modified and removed export processing
        const typeChangeSymbols = new Set<string>();
        
        // Track CJS default shape changes to suppress duplicates
        const cjsDefaultShapeChanges = new Set<string>();

        for (const change of diff.changedSymbols) {
            // Include all changes: TypeScript breaking changes AND JavaScript warnings
            // JavaScript findings are marked as warnings (isBreaking: false) but should still be reported
            let ruleId = this.getRuleId(change);
            const isJavaScriptRule = ruleId.startsWith('JSAPI-');
            
            // Skip non-breaking TypeScript changes, but include JavaScript warnings
            if (!change.isBreaking && !isJavaScriptRule) {
                continue;
            }
            
            // Skip CJS default shape changes that will be handled by formatter from exportChanges.modified
            // This prevents duplicates (analyzer emits in changedSymbols, formatter emits from exportChanges.modified)
            if (ruleId === BreakingChangeRule.JSAPI_CJS_DEFAULT_SHAPE_CHANGED) {
                continue;
            }

            let message = this.getBreakingChangeMessage(change);
            const before = this.getBeforeSignature(change);
            const after = this.getAfterSignature(change);

            // Handle JSX component removals: if JSAPI-EXP-001 for function from .jsx/.tsx file, use JSAPI-JSX-001
            const isJsxFile = filePath.toLowerCase().endsWith('.jsx') || filePath.toLowerCase().endsWith('.tsx');
            if (ruleId === BreakingChangeRule.JSAPI_EXPORT_REMOVED && isJsxFile && change.symbol.kind === 'function') {
                ruleId = BreakingChangeRule.JSAPI_JSX_COMPONENT_REMOVED;
                message = `Exported JSX component '${change.symbol.qualifiedName}' was removed.`;
            }
            
            // Import specifier changes are detected using structured data in exportChanges.removed/added,
            // not via message parsing. Skip JSAPI-EXP-001 entries that correspond to import specifier changes
            // (they will be handled in the exportChanges.removed path as JSAPI-MOD-003).
            // This check is done later when we build exportRemovalsInChangedSymbols, so we don't need to
            // handle it here in changedSymbols.

            // Determine severity: 
            // - JSAPI-EXP-001, JSAPI-EXP-002, JSAPI-EXP-003, JSAPI-EXP-004, JSAPI-EXP-005, JSAPI-EXP-006, JSAPI-EXP-007 are breaking (structural, reliable)
            // - JSAPI-CLS-002 when used for exported class removal is breaking (structural, reliable)
            // - Other JSAPI rules are warnings (heuristic)
            // - TypeScript rules follow isBreaking flag
            const isJsExportRule = ruleId === BreakingChangeRule.JSAPI_EXPORT_REMOVED || 
                                  ruleId === BreakingChangeRule.JSAPI_DEFAULT_EXPORT_REMOVED ||
                                  ruleId === BreakingChangeRule.JSAPI_EXPORT_STAR_REMOVED ||
                                  ruleId === BreakingChangeRule.JSAPI_EXPORT_ALIAS_CHANGED ||
                                  ruleId === BreakingChangeRule.JSAPI_DEFAULT_EXPORT_KIND_CHANGED ||
                                  ruleId === BreakingChangeRule.JSAPI_EXPORT_TYPE_CHANGED ||
                                  ruleId === BreakingChangeRule.JSAPI_CJS_EXPORT_REMOVED ||
                                  ruleId === BreakingChangeRule.JSAPI_BARREL_EXPORT_REMOVED ||
                                  ruleId === BreakingChangeRule.JSAPI_JSX_COMPONENT_REMOVED;
            // JSAPI-CLS-002 is used for both method removal (warning) and exported class removal (breaking)
            // Check message to distinguish: exported class removal messages start with "Exported class"
            const isExportedClassRemoval = ruleId === BreakingChangeRule.JSAPI_CLS_METHOD_REMOVED && 
                                          message.startsWith('Exported class');
            const severity = isJsExportRule || isExportedClassRemoval ? 'breaking' : 
                            (isJavaScriptRule ? 'warning' : 
                            (change.isBreaking ? 'breaking' : 'warning'));

            // Add heuristic disclaimer based on rule metadata
            // SOURCE OF TRUTH: RULE_METADATA[ruleId].heuristic determines heuristic-ness
            // Severity is derived independently (heuristic rules typically have warning severity, but
            // we don't derive heuristic-ness from severity to avoid drift)
            const finalMessage = this.applyHeuristicSuffix(message, ruleId);

            breakingChanges.push({
                ruleId,
                severity,
                symbol: change.symbol.qualifiedName,
                message: finalMessage,
                before,
                after,
                line: change.symbol.line,
                context: {
                    changeType: change.changeType,
                    isExported: change.symbol.isExported,
                    kind: change.symbol.kind,
                    isHeuristic: isJavaScriptRule && !isJsExportRule // Flag for UI grouping (export rules are not heuristic)
                }
            });
        }

        // Export removals: The analyzer should have already emitted findings for these
        // in changedSymbols with the correct ruleId (JSAPI-EXP-001 for JS, TSAPI-EXP-001 for TS)
        // Only emit here if they weren't already handled by the analyzer
        // This is a fallback for analyzers that don't emit export removals in changedSymbols
        // Track which exports have been handled by the analyzer (to avoid duplicates)
        // Track exports that have been handled to suppress duplicates
        // Include JSAPI-EXP-006/007 (type changes) to suppress generic removal findings
        
        // Barrel exports (re-exports with sourceModule) should be handled in exportChanges.removed,
        // not changedSymbols. Build a set of barrel export names to exclude from exportRemovalsInChangedSymbols
        // Also build a set of import specifier change export names to exclude
        const importSpecifierChangeNames = new Set(
            diff.exportChanges.removed
                .filter(exp => exp.sourceModule && !exp.sourceModule.startsWith('cjs:'))
                .filter(exp => {
                    // Check if this is an import specifier change (extensionless to explicit .js)
                    return diff.exportChanges.added.some(
                        addedExp => addedExp.name === exp.name && 
                                   addedExp.sourceModule === exp.sourceModule + '.js'
                    );
                })
                .map(exp => exp.name)
        );
        
        const barrelExportNames = new Set(
            diff.exportChanges.removed
                .filter(exp => exp.sourceModule && !exp.sourceModule.startsWith('cjs:') && !importSpecifierChangeNames.has(exp.name))
                .map(exp => exp.name)
        );
        
        // Filter out import specifier changes from breakingChanges (they'll be handled in exportChanges.removed)
        // Use structured data (exportChanges.removed/added), not message parsing
        const filteredBreakingChanges = breakingChanges.filter(bc => {
            if (bc.ruleId === BreakingChangeRule.JSAPI_EXPORT_REMOVED && importSpecifierChangeNames.has(bc.symbol)) {
                return false; // Exclude import specifier changes - they'll be handled as JSAPI-MOD-003 in exportChanges.removed
            }
            return true;
        });
        
        const exportRemovalsInChangedSymbols = new Set(
            filteredBreakingChanges.filter(bc => {
                // Don't include JSAPI-EXP-001 entries that are barrel exports (let exportChanges.removed handle them)
                if (bc.ruleId === BreakingChangeRule.JSAPI_EXPORT_REMOVED && barrelExportNames.has(bc.symbol)) {
                    return false;
                }
                return bc.ruleId === BreakingChangeRule.EXPORT_REMOVED || 
                       bc.ruleId === BreakingChangeRule.JSAPI_EXPORT_REMOVED ||
                       bc.ruleId === BreakingChangeRule.JSAPI_DEFAULT_EXPORT_REMOVED ||
                       bc.ruleId === BreakingChangeRule.JSAPI_EXPORT_TYPE_CHANGED ||
                       bc.ruleId === BreakingChangeRule.JSAPI_DEFAULT_TO_NAMED_EXPORT ||
                       bc.ruleId === BreakingChangeRule.JSAPI_EXPORT_STAR_REMOVED ||
                       bc.ruleId === BreakingChangeRule.JSAPI_CJS_EXPORT_REMOVED ||
                       bc.ruleId === BreakingChangeRule.JSAPI_CLS_REMOVED; // JSAPI-CLS-002
            }).map(bc => bc.symbol)
        );
        
        // Replace breakingChanges with filtered version
        breakingChanges.length = 0;
        breakingChanges.push(...filteredBreakingChanges);
        
        for (const removedExport of diff.exportChanges.removed) {
            // Skip if already emitted by analyzer (check by export name and type)
            const exportKey = removedExport.type === 'default' ? 'default' : removedExport.name;
            if (exportRemovalsInChangedSymbols.has(exportKey) || exportRemovalsInChangedSymbols.has(removedExport.name)) {
                continue;
            }
            
            // Suppress if this removal is part of a type change (JSAPI-EXP-006/007)
            // This prevents double-reporting: "foo removed" + "foo changed to default"
            if (typeChangeSymbols.has(exportKey) || typeChangeSymbols.has(removedExport.name)) {
                continue;
            }
            
            // Fallback: emit export removal (shouldn't happen if analyzer is correct)
            const isJsFile = filePath.toLowerCase().endsWith('.js') || filePath.toLowerCase().endsWith('.jsx');
            const isJsxFile = filePath.toLowerCase().endsWith('.jsx') || filePath.toLowerCase().endsWith('.tsx');
            
            // Determine the correct rule ID based on export type
            // IMPORTANT: Check for class exports FIRST to use more specific rule
            let ruleId: string;
            let message: string;
            if (removedExport.kind === 'class') {
                // Note: Test expects JSAPI-CLS-002 for exported class removal
                ruleId = BreakingChangeRule.JSAPI_CLS_METHOD_REMOVED; // JSAPI-CLS-002
                message = `Exported class '${removedExport.name}' was removed.`;
            } else if (isJsxFile && removedExport.kind === 'function') {
                // JSX component removal - functions exported from .jsx/.tsx files
                ruleId = BreakingChangeRule.JSAPI_JSX_COMPONENT_REMOVED; // JSAPI-JSX-001
                message = `Exported JSX component '${removedExport.name}' was removed.`;
            } else if (removedExport.type === 'default') {
                ruleId = BreakingChangeRule.JSAPI_DEFAULT_EXPORT_REMOVED;
                message = 'Default export was removed.';
            } else if (removedExport.name === '*') {
                ruleId = BreakingChangeRule.JSAPI_EXPORT_STAR_REMOVED;
                message = 'Re-export star was removed.';
            } else if (removedExport.sourceModule && removedExport.sourceModule.startsWith('cjs:')) {
                ruleId = BreakingChangeRule.JSAPI_CJS_EXPORT_REMOVED;
                message = `CommonJS export '${removedExport.name}' was removed.`;
            } else if (removedExport.sourceModule && (removedExport.sourceName || removedExport.exportedName)) {
                // Export alias removal (re-export with alias was removed)
                // e.g., export { foo as bar } -> export { foo } (bar removed, but foo remains)
                ruleId = BreakingChangeRule.JSAPI_EXPORT_ALIAS_CHANGED; // JSAPI-EXP-004
                message = `Export alias '${removedExport.name}' was removed.`;
            } else if (removedExport.sourceModule) {
                // Check if this is an import specifier change (extensionless to explicit extension)
                // e.g., export { x } from "./a" -> export { x } from "./a.js"
                const correspondingAdded = diff.exportChanges.added.find(
                    exp => exp.name === removedExport.name && 
                           exp.sourceModule && 
                           exp.sourceModule === removedExport.sourceModule + '.js'
                );
                
                if (correspondingAdded) {
                    // Import specifier changed (extensionless to explicit .js)
                    ruleId = BreakingChangeRule.JSAPI_IMPORT_SPECIFIER_CHANGED; // JSAPI-MOD-003
                    message = `Import specifier changed from extensionless to explicit .js.`;
                    // For import specifier changes, use sourceModule as symbol (not export name)
                    const symbol = removedExport.sourceModule;
                    const severity = 'info'; // JSAPI-MOD-003 is info severity
                    
                    breakingChanges.push({
                        ruleId,
                        severity,
                        symbol,
                        message,
                        before: `export { ${removedExport.name} } from '${removedExport.sourceModule}'`,
                        after: `export { ${removedExport.name} } from '${removedExport.sourceModule}.js'`,
                        line: removedExport.line
                    });
                    continue; // Skip the default breakingChanges.push below
                } else {
                    // Barrel export (re-export from another module)
                    ruleId = BreakingChangeRule.JSAPI_BARREL_EXPORT_REMOVED; // JSAPI-EXP-008
                    message = `Barrel export '${removedExport.name}' was removed.`;
                }
            } else {
                ruleId = isJsFile ? BreakingChangeRule.JSAPI_EXPORT_REMOVED : BreakingChangeRule.EXPORT_REMOVED;
                message = `Export '${removedExport.name}' was removed`;
            }
            
            // For exported class removal, severity should be breaking (not warning)
            // JSAPI-CLS-002 is heuristic for method removal, but breaking for exported class removal
            const severity = (ruleId === BreakingChangeRule.JSAPI_CLS_METHOD_REMOVED && removedExport.kind === 'class')
                ? 'breaking'
                : 'breaking'; // Export removals are breaking (structural, reliable)
            
            breakingChanges.push({
                ruleId,
                severity,
                symbol: removedExport.name,
                message,
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
                
                // Check for CJS default export shape change first (before other type checks)
                const isCjsDefault = before.sourceModule === 'cjs:module.exports' && 
                                    after.sourceModule === 'cjs:module.exports' &&
                                    before.type === 'default' && 
                                    after.type === 'default' &&
                                    before.kind !== after.kind;
                
                if (isCjsDefault) {
                    // CJS default export shape changed (function -> object, etc.)
                    const ruleId = BreakingChangeRule.JSAPI_CJS_DEFAULT_SHAPE_CHANGED; // JSAPI-CJS-002
                    const kindFrom = before.kind || 'unknown';
                    const kindTo = after.kind || 'unknown';
                    const message = `module.exports shape changed (${kindFrom} -> ${kindTo}).`;
                    
                    breakingChanges.push({
                        ruleId,
                        severity: 'warning', // CJS shape changes are warnings (heuristic)
                        symbol: 'module.exports',
                        message,
                        before: `module.exports = ${kindFrom}`,
                        after: `module.exports = ${kindTo}`,
                        line: after.line
                    });
                    
                    // Suppress generic findings
                    typeChangeSymbols.add('default');
                    typeChangeSymbols.add('module.exports');
                    
                    continue;
                }
                
                // Check for export type changes (named <-> default)
                if (before.type !== after.type) {
                    // Skip export type change detection when this is part of a module system change (CJS <-> ESM)
                    // The module system change (JSAPI-MOD-001) already covers this case
                    const isBeforeCjs = before.sourceModule === 'cjs:module.exports' || before.sourceModule === 'cjs:exports';
                    const isAfterCjs = after.sourceModule === 'cjs:module.exports' || after.sourceModule === 'cjs:exports';
                    const isModuleSystemChange = (isBeforeCjs && !isAfterCjs) || (!isBeforeCjs && isAfterCjs);
                    
                    // Check if JSAPI-MOD-001 is already in breakingChanges (module system change detected)
                    const hasModuleSystemChange = breakingChanges.some(bc => bc.ruleId === BreakingChangeRule.JSAPI_MODULE_SYSTEM_CHANGED);
                    
                    // Skip JSAPI-EXP-007/006 if this is part of a module system change
                    if (isModuleSystemChange || hasModuleSystemChange) {
                        continue;
                    }
                    
                    const isJsFile = filePath.toLowerCase().endsWith('.js') || filePath.toLowerCase().endsWith('.jsx');
                    let ruleId: string;
                    let message: string;
                    let symbol: string;
                    
                    if (before.type === 'named' && after.type === 'default') {
                        // Named to default export
                        ruleId = BreakingChangeRule.JSAPI_EXPORT_TYPE_CHANGED; // JSAPI-EXP-006
                        message = 'Named export changed to default export.';
                        symbol = before.name; // Use the original named export name
                    } else if (before.type === 'default' && after.type === 'named') {
                        // Default to named export
                        ruleId = BreakingChangeRule.JSAPI_DEFAULT_TO_NAMED_EXPORT; // JSAPI-EXP-007
                        message = 'Default export changed to named export.';
                        symbol = 'default'; // Use the original default export name (what consumers were importing)
                    } else {
                        // Other type changes
                        ruleId = isJsFile ? BreakingChangeRule.JSAPI_EXPORT_TYPE_CHANGED : BreakingChangeRule.EXPORT_TYPE_CHANGED;
                        message = `Export type changed from ${before.type} to ${after.type}.`;
                        symbol = after.name;
                    }
                    
                    breakingChanges.push({
                        ruleId,
                        severity: 'breaking',
                        symbol,
                        message,
                        before: `${before.type} export ${before.name}`,
                        after: `${after.type} export ${after.name}`,
                        line: after.line
                    });
                    
                    // Suppress generic removal findings for the same symbol
                    // If we emit JSAPI-EXP-006/007, don't also emit JSAPI-EXP-001 or JSAPI-EXP-002
                    typeChangeSymbols.add(symbol);
                    if (before.type === 'named') {
                        typeChangeSymbols.add(before.name);
                    } else if (before.type === 'default') {
                        typeChangeSymbols.add('default');
                    }
                    if (after.type === 'named') {
                        typeChangeSymbols.add(after.name);
                    } else if (after.type === 'default') {
                        typeChangeSymbols.add('default');
                    }
                    
                    continue;
                }
                
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

        // Deduplicate: keep the most specific finding for each (file, symbol) pair
        // This ensures JSAPI-EXP-002 (default export) wins over JSAPI-EXP-001 (generic export)
        return this.deduplicateBreakingChanges(breakingChanges, filePath);
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
     * Apply heuristic suffix to a message if applicable.
     * 
     * SOURCE OF TRUTH: Uses RULE_METADATA[ruleId].heuristic to determine if rule is heuristic.
     * Does NOT derive heuristic-ness from severity to avoid drift.
     * 
     * @param message The original message
     * @param ruleId The rule ID
     * @returns The message with suffix appended if applicable, otherwise the original message
     */
    static applyHeuristicSuffix(message: string, ruleId: string): string {
        const isHeuristic = isHeuristicRule(ruleId);
        const isInDenylist = NO_HEURISTIC_SUFFIX_RULES.has(ruleId);
        const messageAlreadyIndicatesUncertainty = 
            message.toLowerCase().includes('likely') ||
            message.toLowerCase().includes('potential') ||
            message.toLowerCase().includes('may miss');
        const shouldAddHeuristicDisclaimer = isHeuristic && !isInDenylist && !messageAlreadyIndicatesUncertainty;
        return shouldAddHeuristicDisclaimer 
            ? `${message} (JavaScript heuristic - may miss runtime changes)` 
            : message;
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

