/**
 * Pure impact analysis function.
 * 
 * This function accepts explicit before/after content strings and produces
 * a deterministic ImpactReport. It's designed for testing but can be used
 * in production when you have explicit content to compare.
 * 
 * Key characteristics:
 * - No file system dependencies (works with content strings)
 * - No Git dependencies
 * - Deterministic output
 * - Testable in isolation
 */

import * as fs from 'fs';
import * as path from 'path';
import { ImpactReport, createEmptyReport } from '../types/ImpactReport';
import { DependencyAnalyzer } from '../analyzers/DependencyAnalyzer';
import { TestFinder } from '../analyzers/TestFinder';
import { LanguageAnalyzerFactory } from '../analyzers/language/LanguageAnalyzerFactory';
import { ILanguageAnalyzer } from '../analyzers/ILanguageAnalyzer';
import { CodeAnalyzer } from '../analyzers/CodeAnalyzer'; // Fallback for unsupported languages
import { SnapshotDiff } from '../analyzers/language/SymbolSnapshot';
import { EnhancedImpactReport } from '../types/EnhancedImpactReport';
import { EnhancedReportFormatter } from '../utils/EnhancedReportFormatter';

export interface AnalyzeImpactParams {
    /** File path (relative to projectRoot) */
    file: string;
    /** Content before the change */
    before: string;
    /** Content after the change */
    after: string;
    /** Root directory of the project (for finding downstream files and tests) */
    projectRoot: string;
}

/**
 * Analyze the impact of a code change by comparing before/after content.
 * 
 * This is a pure function that:
 * 1. Parses both versions to find changed functions/classes
 * 2. Finds downstream files that depend on changed code
 * 3. Finds tests that might be affected
 * 4. Returns a deterministic ImpactReport
 */
export type DebugLogFunction = (message: string) => void;

export interface AnalyzeImpactResult {
    report: ImpactReport;
    snapshotDiff?: SnapshotDiff;
}

export async function analyzeImpact(
    params: AnalyzeImpactParams,
    debugLog?: DebugLogFunction
): Promise<ImpactReport> {
    const result = await analyzeImpactWithDiff(params, debugLog);
    return result.report;
}

/**
 * Analyze impact and return both standard report and snapshot diff (for enhanced reporting)
 */
export async function analyzeImpactWithDiff(
    params: AnalyzeImpactParams,
    debugLog?: DebugLogFunction
): Promise<AnalyzeImpactResult> {
    // CRITICAL: This log MUST appear if this function is called
    console.error(`[analyzeImpactWithDiff] ========== ENTRY ==========`);
    console.error(`[analyzeImpactWithDiff] file: ${params.file}`);
    console.error(`[analyzeImpactWithDiff] projectRoot: ${params.projectRoot}`);
    console.error(`[analyzeImpactWithDiff] before length: ${params.before.length}`);
    console.error(`[analyzeImpactWithDiff] after length: ${params.after.length}`);
    
    const { file, before, after, projectRoot } = params;
    
    console.log(`[analyzeImpactWithDiff] ENTRY - file: ${file}, projectRoot: ${projectRoot}`);
    const log = debugLog || ((msg: string) => console.log(`[PureImpactAnalyzer] ${msg}`));

    log(`========================================`);
    log(`analyzeImpact() called for: ${file}`);
    log(`Before length: ${before.length}, After length: ${after.length}`);
    log(`Before === After: ${before === after}`);

    // If before and after are identical, return empty report
    if (before === after) {
        log(`✅ Before === After, returning empty report`);
        log(`========================================`);
        return {
            report: createEmptyReport(file),
            snapshotDiff: undefined
        };
    }

    log(`⚠️ Before !== After, analyzing changes...`);

    // Set project root for analyzers that need it
    LanguageAnalyzerFactory.setProjectRoot(projectRoot);

    const fullFilePath = path.join(projectRoot, file);
    const fileExt = path.extname(fullFilePath).toLowerCase();
    log(`File extension: ${fileExt}`);
    
    const languageAnalyzer = LanguageAnalyzerFactory.getAnalyzer(fullFilePath);
    
    const dependencyAnalyzer = new DependencyAnalyzer();
    const testFinder = new TestFinder();

    let changedFunctions: string[] = [];
    let changedClasses: string[] = [];
    let changedCodeAnalysis: any;
    let snapshotDiff: SnapshotDiff | undefined = undefined;

    if (languageAnalyzer) {
        // Use language-specific analyzer
        const analyzerName = languageAnalyzer.constructor.name;
        const supportedExts = languageAnalyzer.getSupportedExtensions().join(', ');
        log(`✅ Using language-specific analyzer: ${analyzerName} (${languageAnalyzer.getLanguage()})`);
        log(`   Supported extensions: ${supportedExts}`);
        log(`   File: ${file}`);
        
        // Use snapshot-based approach if available (preferred)
        if (languageAnalyzer.buildSnapshot && languageAnalyzer.diffSnapshots) {
            log(`   Using snapshot-based analysis (AST + symbols + exports)`);
            
            // Build snapshots
            log(`Building BEFORE snapshot...`);
            const beforeSnapshot = await languageAnalyzer.buildSnapshot(fullFilePath, before);
            log(`BEFORE snapshot: ${beforeSnapshot.functions.length} functions, ${beforeSnapshot.classes.length} classes, ${beforeSnapshot.interfaces.length} interfaces`);
            
            log(`Building AFTER snapshot...`);
            const afterSnapshot = await languageAnalyzer.buildSnapshot(fullFilePath, after);
            log(`AFTER snapshot: ${afterSnapshot.functions.length} functions, ${afterSnapshot.classes.length} classes, ${afterSnapshot.interfaces.length} interfaces`);
            
            // Diff snapshots
            log(`Diffing snapshots...`);
            snapshotDiff = await languageAnalyzer.diffSnapshots(beforeSnapshot, afterSnapshot);
            log(`Snapshot diff: ${snapshotDiff.changedSymbols.length} changed symbols, ${snapshotDiff.added.length} added, ${snapshotDiff.removed.length} removed, ${snapshotDiff.modified.length} modified`);
            
            // Extract changed functions and classes from changed symbols
            changedFunctions = snapshotDiff.changedSymbols
                .filter(s => s.symbol.kind === 'function' || s.symbol.kind === 'method')
                .map(s => s.symbol.name);
            changedClasses = snapshotDiff.changedSymbols
                .filter(s => s.symbol.kind === 'class')
                .map(s => s.symbol.name);
            
            // Also extract changed types and interfaces for downstream analysis
            const changedTypes = snapshotDiff.changedSymbols
                .filter(s => s.symbol.kind === 'type' || s.symbol.kind === 'interface')
                .map(s => s.symbol.name);
            
            // Also include breaking changes (export removals, type changes)
            const breakingChanges = snapshotDiff.changedSymbols.filter(s => s.isBreaking);
            log(`Breaking changes: ${breakingChanges.length}`);
            
            log(`Changed functions: ${JSON.stringify(changedFunctions)}`);
            log(`Changed classes: ${JSON.stringify(changedClasses)}`);
            log(`Changed types/interfaces: ${JSON.stringify(changedTypes)}`);
            
            // Build code analysis from snapshot
            changedCodeAnalysis = {
                functions: changedFunctions,
                classes: changedClasses,
                modules: afterSnapshot.imports.map(i => i.module),
                imports: afterSnapshot.imports.flatMap(i => i.symbols),
                exports: afterSnapshot.exports.map(e => e.name),
                complexity: afterSnapshot.functions.length + afterSnapshot.classes.length + afterSnapshot.interfaces.length,
                linesOfCode: after.split('\n').length
            };
        } else {
            // Fallback to old findChangedElements method
            log(`   Using legacy findChangedElements method`);
            const changedElements = await languageAnalyzer.findChangedElements(
                before,
                after,
                fullFilePath
            );
            
            changedFunctions = changedElements.changedFunctions;
            changedClasses = changedElements.changedClasses;
            
            log(`Changed functions: ${JSON.stringify(changedFunctions)}`);
            log(`Changed classes: ${JSON.stringify(changedClasses)}`);

            // Get full analysis for downstream/test finding
            const afterAnalysis = await languageAnalyzer.analyze(fullFilePath, after);
            changedCodeAnalysis = {
                functions: changedFunctions,
                classes: changedClasses,
                modules: afterAnalysis.modules,
                imports: afterAnalysis.imports,
                exports: afterAnalysis.exports,
                complexity: afterAnalysis.functions.length + afterAnalysis.classes.length,
                linesOfCode: after.split('\n').length
            };
        }
    } else {
        // Fallback to generic CodeAnalyzer for unsupported languages
        log(`⚠️ No language-specific analyzer found for extension: ${fileExt}`);
        log(`   Falling back to generic CodeAnalyzer (regex-based parsing)`);
        log(`   Supported languages: ${LanguageAnalyzerFactory.getSupportedLanguages().join(', ')}`);
        const codeAnalyzer = new CodeAnalyzer();
        
        // Analyze both versions
        log(`Analyzing BEFORE version...`);
        const beforeAnalysis = await codeAnalyzer.analyzeFile(file, before);
        log(`BEFORE analysis: ${beforeAnalysis.functions.length} functions, ${beforeAnalysis.classes.length} classes`);
        log(`BEFORE functions: ${JSON.stringify(beforeAnalysis.functions)}`);
        
        log(`Analyzing AFTER version...`);
        const afterAnalysis = await codeAnalyzer.analyzeFile(file, after);
        log(`AFTER analysis: ${afterAnalysis.functions.length} functions, ${afterAnalysis.classes.length} classes`);
        log(`AFTER functions: ${JSON.stringify(afterAnalysis.functions)}`);

        // Find changed functions (in after but different in before, or removed)
        log(`Finding changed functions...`);
        changedFunctions = findChangedFunctions(
            beforeAnalysis.functions,
            afterAnalysis.functions,
            before,
            after,
            log
        );
        log(`Changed functions: ${JSON.stringify(changedFunctions)}`);

        // Find changed classes
        log(`Finding changed classes...`);
        changedClasses = findChangedClasses(
            beforeAnalysis.classes,
            afterAnalysis.classes,
            before,
            after
        );
        log(`Changed classes: ${JSON.stringify(changedClasses)}`);

        changedCodeAnalysis = {
            functions: changedFunctions,
            classes: changedClasses,
            modules: afterAnalysis.modules,
            imports: afterAnalysis.imports,
            exports: afterAnalysis.exports,
            complexity: afterAnalysis.complexity,
            linesOfCode: afterAnalysis.linesOfCode
        };
    }

    // Check if there are any changes (functions, classes, exports, types, interfaces, etc.)
    const hasAnyChanges = changedFunctions.length > 0 || 
                         changedClasses.length > 0 ||
                         (snapshotDiff && (
                             snapshotDiff.changedSymbols.length > 0 ||
                             snapshotDiff.exportChanges.removed.length > 0 ||
                             snapshotDiff.exportChanges.modified.length > 0
                         ));

    if (!hasAnyChanges) {
        log(`✅ No changes detected, returning empty report`);
        log(`========================================`);
        return {
            report: createEmptyReport(file),
            snapshotDiff
        };
    }
    
    log(`⚠️ Found ${changedFunctions.length} changed functions, ${changedClasses.length} changed classes`);
    if (snapshotDiff) {
        log(`   Snapshot diff: ${snapshotDiff.changedSymbols.length} changed symbols, ${snapshotDiff.exportChanges.removed.length} removed exports, ${snapshotDiff.exportChanges.modified.length} modified exports`);
    }

    console.log(`[PureImpactAnalyzer] About to collect impacted symbols and find downstream files`);
    console.log(`[PureImpactAnalyzer] snapshotDiff exists: ${!!snapshotDiff}`);
    console.log(`[PureImpactAnalyzer] snapshotDiff.exportChanges.modified.length: ${snapshotDiff?.exportChanges.modified.length || 0}`);

    // Collect impacted symbols from export changes for dependency analysis
    const impactedExportNames = new Set<string>();
    if (snapshotDiff) {
        // Add removed export names
        for (const removedExport of snapshotDiff.exportChanges.removed) {
            impactedExportNames.add(removedExport.name);
        }
        // Add modified export names
        for (const modifiedExport of snapshotDiff.exportChanges.modified) {
            if ('name' in modifiedExport) {
                impactedExportNames.add(modifiedExport.name);
            } else if ('after' in modifiedExport) {
                impactedExportNames.add(modifiedExport.after.name);
            }
        }
    }
    
    // Add changed function/class names
    for (const func of changedFunctions) {
        impactedExportNames.add(func);
    }
    for (const cls of changedClasses) {
        impactedExportNames.add(cls);
    }

    // Find downstream files
    // If we have export changes but no function/class changes, we need to find files that import the exports
    // Use the after file path for dependency analysis (graph is built from after/ tree)
    let afterFilePath = fullFilePath;
    if (fullFilePath.includes(`${path.sep}before${path.sep}`) && projectRoot.includes(`${path.sep}after${path.sep}`)) {
        afterFilePath = fullFilePath.replace(`${path.sep}before${path.sep}`, `${path.sep}after${path.sep}`);
        log(`Mapped before file path to after file path: ${fullFilePath} -> ${afterFilePath}`);
    }
    
    log(`Finding downstream files for: ${afterFilePath}`);
    log(`Project root: ${projectRoot}`);
    log(`Impacted export names: ${Array.from(impactedExportNames)}`);
    
    // CRITICAL: These logs MUST appear before dependency analyzer is called
    console.error(`[PureImpactAnalyzer] ========== CALLING DEPENDENCY ANALYZER ==========`);
    console.error(`[PureImpactAnalyzer] afterFilePath: ${afterFilePath}`);
    console.error(`[PureImpactAnalyzer] projectRoot: ${projectRoot}`);
    console.error(`[PureImpactAnalyzer] impactedExportNames.size: ${impactedExportNames.size}`);
    console.error(`[PureImpactAnalyzer] impactedExportNames: ${Array.from(impactedExportNames).join(', ')}`);
    
    console.log(`[PureImpactAnalyzer] About to call dependencyAnalyzer.findDownstreamComponents`);
    console.log(`[PureImpactAnalyzer] afterFilePath: ${afterFilePath}`);
    console.log(`[PureImpactAnalyzer] projectRoot: ${projectRoot}`);
    console.log(`[PureImpactAnalyzer] impactedExportNames.size: ${impactedExportNames.size}`);
    
    let downstreamFiles: string[] = [];
    if (impactedExportNames.size > 0) {
        console.error(`[PureImpactAnalyzer] Calling findDownstreamComponents with impactedExportNames`);
        downstreamFiles = await dependencyAnalyzer.findDownstreamComponents(
            afterFilePath,
            changedCodeAnalysis,
            Array.from(impactedExportNames),
            projectRoot
        );
        console.error(`[PureImpactAnalyzer] findDownstreamComponents returned ${downstreamFiles.length} files`);
    } else {
        console.error(`[PureImpactAnalyzer] Calling findDownstreamComponents WITHOUT impactedExportNames`);
        downstreamFiles = await dependencyAnalyzer.findDownstreamComponents(
            afterFilePath,
            changedCodeAnalysis,
            undefined,
            projectRoot
        );
        console.error(`[PureImpactAnalyzer] findDownstreamComponents returned ${downstreamFiles.length} files`);
    }
    
    log(`Found ${downstreamFiles.length} downstream files`);
    
    // Filter out test files from downstream files (test files should only be in affectedTests)
    const isTestFile = (filePath: string): boolean => {
        const normalized = filePath.replace(/\\/g, '/');
        return (
            normalized.includes('/test/') ||
            normalized.includes('/tests/') ||
            normalized.includes('/__tests__/') ||
            /\.test\.(ts|tsx|js|jsx)$/i.test(normalized) ||
            /\.spec\.(ts|tsx|js|jsx)$/i.test(normalized)
        );
    };
    
    // Separate downstream files from test files
    const sourceDownstreamFiles = downstreamFiles.filter(f => !isTestFile(f));
    const testFilesFromDependencyAnalyzer = downstreamFiles.filter(f => isTestFile(f));
    
    log(`Filtered ${downstreamFiles.length} files: ${sourceDownstreamFiles.length} source files, ${testFilesFromDependencyAnalyzer.length} test files`);
    
    // Convert to relative paths
    const relativeDownstreamFiles = sourceDownstreamFiles.map(f => 
        path.relative(projectRoot, f)
    );

    // Find affected tests
    // Note: TestFinder may return empty in test environments without vscode.workspace
    // For testing, we'll also do a simple file system scan
    let affectedTests: string[] = [];
    try {
        affectedTests = await testFinder.findAffectedTests(
            fullFilePath,
            changedCodeAnalysis
        );
    } catch (error) {
        // Fallback: scan for test files manually
        console.log('TestFinder failed (likely in test environment), using fallback');
        affectedTests = await findTestFilesFallback(fullFilePath, projectRoot, sourceDownstreamFiles);
    }
    
    // Add test files found by DependencyAnalyzer (they're transitive dependencies)
    const affectedTestsSet = new Set(affectedTests);
    for (const testFile of testFilesFromDependencyAnalyzer) {
        affectedTestsSet.add(testFile);
    }
    affectedTests = Array.from(affectedTestsSet);
    
    log(`Found ${affectedTests.length} affected tests (${testFilesFromDependencyAnalyzer.length} from DependencyAnalyzer)`);
    
    // Convert to relative paths
    const relativeTests = affectedTests.map(f => 
        path.relative(projectRoot, f)
    );

    // Build issues list
    const issues = [
        ...relativeDownstreamFiles.map(target => ({
            type: "downstream" as const,
            target
        })),
        ...relativeTests.map(target => ({
            type: "test" as const,
            target
        })),
        ...changedFunctions.map(target => ({
            type: "function" as const,
            target
        }))
    ];

    const report: ImpactReport = {
        sourceFile: file,
        functions: changedFunctions,
        downstreamFiles: relativeDownstreamFiles,
        tests: relativeTests,
        issues
    };

    return {
        report,
        snapshotDiff
    };
}

/**
 * Generate enhanced impact report with detailed breaking changes
 */
export async function analyzeImpactEnhanced(
    params: AnalyzeImpactParams,
    debugLog?: DebugLogFunction
): Promise<EnhancedImpactReport> {
    // CRITICAL MARKER - If you see EnhancedReportFormatter logs but NOT this, the compiled code is stale
    console.error(`[analyzeImpactEnhanced] ========== STARTING ==========`);
    console.error(`[analyzeImpactEnhanced] file: ${params.file}`);
    console.error(`[analyzeImpactEnhanced] projectRoot: ${params.projectRoot}`);
    console.log(`[analyzeImpactEnhanced] Starting, file: ${params.file}, projectRoot: ${params.projectRoot}`);
    const result = await analyzeImpactWithDiff(params, debugLog);
    console.log(`[analyzeImpactEnhanced] Got result, snapshotDiff exists: ${!!result.snapshotDiff}`);
    console.log(`[analyzeImpactEnhanced] Report downstreamFiles: ${result.report.downstreamFiles.length}, tests: ${result.report.tests.length}`);
    
    if (!result.snapshotDiff) {
        // Fallback: create minimal enhanced report from standard report
        return {
            filePath: params.file,
            breakingChanges: [],
            impactedSymbols: result.report.functions,
            downstreamFiles: result.report.downstreamFiles.map(f => ({
                file: f,
                reason: 'Depends on changed code'
            })),
            affectedTests: result.report.tests.map(t => ({
                file: t,
                reason: 'Tests changed code'
            })),
            summary: {
                breakingCount: 0,
                impactedSymbolsCount: result.report.functions.length,
                downstreamCount: result.report.downstreamFiles.length,
                affectedTestsCount: result.report.tests.length
            }
        };
    }

    console.error(`[analyzeImpactEnhanced] About to call EnhancedReportFormatter.format`);
    console.error(`[analyzeImpactEnhanced] snapshotDiff exists: ${!!result.snapshotDiff}`);
    console.error(`[analyzeImpactEnhanced] report.downstreamFiles.length: ${result.report.downstreamFiles.length}`);
    console.error(`[analyzeImpactEnhanced] report.tests.length: ${result.report.tests.length}`);
    
    return EnhancedReportFormatter.format(
        path.join(params.projectRoot, params.file),
        result.snapshotDiff,
        result.report,
        params.projectRoot
    );
}

/**
 * Find functions that changed between before and after.
 * 
 * A function is considered "changed" if:
 * - Its signature changed (parameters, return type)
 * - It was removed
 * - It was renamed (heuristic: similar name, different location)
 */
function findChangedFunctions(
    beforeFunctions: string[],
    afterFunctions: string[],
    beforeContent: string,
    afterContent: string,
    debugLog?: (message: string) => void
): string[] {
    const log = debugLog || (() => {});
    const changed: string[] = [];

    log(`Comparing ${beforeFunctions.length} before functions vs ${afterFunctions.length} after functions`);

    // Find functions that were removed
    for (const func of beforeFunctions) {
        if (!afterFunctions.includes(func)) {
            log(`Function removed: ${func}`);
            changed.push(func);
        }
    }

    // Find functions whose signatures changed
    for (const func of afterFunctions) {
        if (beforeFunctions.includes(func)) {
            // Function exists in both - check if signature changed
            log(`Checking function: ${func}`);
            const beforeSig = extractFunctionSignature(func, beforeContent);
            const afterSig = extractFunctionSignature(func, afterContent);
            
            log(`  Before signature: ${beforeSig || '(not found)'}`);
            log(`  After signature:  ${afterSig || '(not found)'}`);
            
            if (beforeSig && afterSig) {
                if (beforeSig !== afterSig) {
                    log(`  ⚠️ Signatures DIFFER - marking as changed`);
                    changed.push(func);
                } else {
                    log(`  ✅ Signatures match - no change`);
                }
            } else {
                log(`  ⚠️ Could not extract one or both signatures`);
            }
        } else {
            // New function - not considered "changed" for impact analysis
            log(`New function (not in before): ${func} - ignoring`);
        }
    }

    log(`Total changed functions: ${changed.length}`);
    return [...new Set(changed)];
}

/**
 * Find classes that changed between before and after.
 */
function findChangedClasses(
    beforeClasses: string[],
    afterClasses: string[],
    beforeContent: string,
    afterContent: string
): string[] {
    const changed: string[] = [];

    // Find classes that were removed
    for (const cls of beforeClasses) {
        if (!afterClasses.includes(cls)) {
            changed.push(cls);
        }
    }

    // Find classes whose structure changed
    for (const cls of afterClasses) {
        if (beforeClasses.includes(cls)) {
            // Class exists in both - check if it changed
            // For now, we consider any class that exists in both as potentially changed
            // In a more sophisticated implementation, we'd compare class structure
            const beforeClassDef = extractClassDefinition(cls, beforeContent);
            const afterClassDef = extractClassDefinition(cls, afterContent);
            
            if (beforeClassDef && afterClassDef && beforeClassDef !== afterClassDef) {
                changed.push(cls);
            }
        }
    }

    return [...new Set(changed)];
}

/**
 * Extract function signature from content.
 * Returns normalized signature (parameters + return type only, no comments/whitespace).
 * This is comment-insensitive - only compares actual signature parts.
 */
function extractFunctionSignature(functionName: string, content: string): string | null {
    // Patterns to find function declarations
    const patterns = [
        // export function name(...) : returnType
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${escapeRegex(functionName)}\\s*\\(([^)]*)\\)\\s*(?::\\s*([^{\\s]+))?`, 'm'),
        // function name(...) : returnType
        new RegExp(`(?:async\\s+)?function\\s+${escapeRegex(functionName)}\\s*\\(([^)]*)\\)\\s*(?::\\s*([^{\\s]+))?`, 'm'),
        // const name = (...) => ...
        new RegExp(`const\\s+${escapeRegex(functionName)}\\s*=\\s*\\(([^)]*)\\)\\s*(?::\\s*([^{\\s=]+))?\\s*=>`, 'm')
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
            // Extract only parameters and return type (ignore comments, body, etc.)
            const params = match[1] || '';
            const returnType = match[2] || '';
            
            // Normalize: remove comments, extra whitespace
            const normalizedParams = params
                .replace(/\/\/.*$/gm, '') // Remove line comments
                .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();
            
            const normalizedReturnType = returnType
                .replace(/\/\/.*$/gm, '')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .trim();
            
            // Return normalized signature: name(params): returnType
            const signature = returnType 
                ? `${functionName}(${normalizedParams}): ${normalizedReturnType}`
                : `${functionName}(${normalizedParams})`;
            
            return signature;
        }
    }

    return null;
}

/**
 * Extract class definition from content.
 */
function extractClassDefinition(className: string, content: string): string | null {
    const pattern = new RegExp(`(?:export\\s+)?class\\s+${escapeRegex(className)}[^{]*\\{[^}]*\\}`, 's');
    const match = content.match(pattern);
    return match ? match[0].trim() : null;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fallback test file finder for test environments.
 * Scans the project directory for test files that might reference the source file.
 */
async function findTestFilesFallback(
    sourceFilePath: string,
    projectRoot: string,
    downstreamFiles: string[] = []
): Promise<string[]> {
    const testFiles: string[] = [];
    const sourceFileName = path.basename(sourceFilePath, path.extname(sourceFilePath));
    const sourceDir = path.dirname(sourceFilePath);
    const normalizedSource = path.resolve(sourceFilePath);
    const normalizedDownstream = new Set(downstreamFiles.map(f => path.resolve(f)));

    // Test patterns
    const testPatterns = [
        /\.test\.(js|jsx|ts|tsx)$/i,
        /\.spec\.(js|jsx|ts|tsx)$/i
    ];

    // Helper to check if a file imports another file
    function fileImportsTarget(content: string, targetPath: string, projectRoot: string): boolean {
        const targetRel = path.relative(projectRoot, targetPath).replace(/\\/g, '/').replace(/\.ts$/, '');
        const targetDir = path.dirname(targetPath);
        const targetDirRel = path.relative(projectRoot, targetDir).replace(/\\/g, '/');
        const targetName = path.basename(targetPath, path.extname(targetPath));
        
        // Escape special regex characters
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const targetRelEsc = esc(targetRel);
        const targetDirRelEsc = esc(targetDirRel);
        const targetNameEsc = esc(targetName);
        
        // Allow ./ and ../ prefixes (repeatedly)
        const prefix = `(?:\\.{1,2}\\/)*`;
        
        // Check various import patterns
        const patterns = [
            new RegExp(`from\\s+['"]${prefix}${targetRelEsc}['"]`, 'i'),
            new RegExp(`from\\s+['"]${prefix}${targetDirRelEsc}['"]`, 'i'),
            new RegExp(`from\\s+['"]${prefix}${targetNameEsc}['"]`, 'i'),
            new RegExp(`import\\s*\\(\\s*['"]${prefix}${targetRelEsc}['"]`, 'i'),
            new RegExp(`require\\s*\\(\\s*['"]${prefix}${targetRelEsc}['"]`, 'i'),
        ];
        
        return patterns.some(p => p.test(content));
    }

    // Walk directory recursively
    function walkDir(dir: string): void {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // Skip node_modules and other build directories
                    if (!['node_modules', '.git', 'dist', 'build', 'out'].includes(entry.name)) {
                        walkDir(fullPath);
                    }
                } else if (entry.isFile()) {
                    // Check if it's a test file
                    const isTestFile = testPatterns.some(pattern => pattern.test(entry.name));
                    if (isTestFile) {
                        try {
                            const content = fs.readFileSync(fullPath, 'utf8');
                            const normalizedPath = path.resolve(fullPath);
                            
                            // Check if test imports the source file
                            if (fileImportsTarget(content, normalizedSource, projectRoot)) {
                                testFiles.push(fullPath);
                                continue;
                            }
                            
                            // Check if test imports any downstream file
                            for (const downstream of normalizedDownstream) {
                                if (fileImportsTarget(content, downstream, projectRoot)) {
                                    testFiles.push(fullPath);
                                    break;
                                }
                            }
                            
                            // Also check simple name matching as fallback
                            if (content.includes(sourceFileName) || 
                                content.includes(path.basename(sourceFilePath))) {
                                testFiles.push(fullPath);
                            }
                        } catch {
                            // Skip if can't read
                        }
                    }
                }
            }
        } catch {
            // Skip if can't read directory
        }
    }

    // Start from project root to find all test files
    walkDir(projectRoot);

    return [...new Set(testFiles)];
}

