"use strict";
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeImpact = analyzeImpact;
exports.analyzeImpactWithDiff = analyzeImpactWithDiff;
exports.analyzeImpactEnhanced = analyzeImpactEnhanced;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ImpactReport_1 = require("../types/ImpactReport");
const DependencyAnalyzer_1 = require("../analyzers/DependencyAnalyzer");
const TestFinder_1 = require("../analyzers/TestFinder");
const LanguageAnalyzerFactory_1 = require("../analyzers/language/LanguageAnalyzerFactory");
const CodeAnalyzer_1 = require("../analyzers/CodeAnalyzer"); // Fallback for unsupported languages
const EnhancedReportFormatter_1 = require("../utils/EnhancedReportFormatter");
async function analyzeImpact(params, debugLog) {
    const result = await analyzeImpactWithDiff(params, debugLog);
    return result.report;
}
/**
 * Analyze impact and return both standard report and snapshot diff (for enhanced reporting)
 */
async function analyzeImpactWithDiff(params, debugLog) {
    // CRITICAL: This log MUST appear if this function is called
    console.error(`[analyzeImpactWithDiff] ========== ENTRY ==========`);
    console.error(`[analyzeImpactWithDiff] file: ${params.file}`);
    console.error(`[analyzeImpactWithDiff] projectRoot: ${params.projectRoot}`);
    console.error(`[analyzeImpactWithDiff] before length: ${params.before.length}`);
    console.error(`[analyzeImpactWithDiff] after length: ${params.after.length}`);
    const { file, before, after, projectRoot } = params;
    console.log(`[analyzeImpactWithDiff] ENTRY - file: ${file}, projectRoot: ${projectRoot}`);
    const log = debugLog || ((msg) => console.log(`[PureImpactAnalyzer] ${msg}`));
    log(`========================================`);
    log(`analyzeImpact() called for: ${file}`);
    log(`Before length: ${before.length}, After length: ${after.length}`);
    log(`Before === After: ${before === after}`);
    // If before and after are identical, return empty report
    if (before === after) {
        log(`✅ Before === After, returning empty report`);
        log(`========================================`);
        return {
            report: (0, ImpactReport_1.createEmptyReport)(file),
            snapshotDiff: undefined
        };
    }
    log(`⚠️ Before !== After, analyzing changes...`);
    // Set project root for analyzers that need it
    LanguageAnalyzerFactory_1.LanguageAnalyzerFactory.setProjectRoot(projectRoot);
    // Construct full file path - handle both relative and absolute paths
    let fullFilePath;
    if (path.isAbsolute(file)) {
        // If file is already absolute, use it directly (might happen if relative path calculation was wrong)
        fullFilePath = file;
        log(`⚠️ File path is already absolute: ${fullFilePath}`);
        log(`⚠️ Expected relative path from project root: ${projectRoot}`);
    }
    else {
        fullFilePath = path.join(projectRoot, file);
    }
    // Normalize the path to ensure consistency
    fullFilePath = path.resolve(fullFilePath);
    const fileExt = path.extname(fullFilePath).toLowerCase();
    log(`File: ${file}`);
    log(`Project root: ${projectRoot}`);
    log(`Full file path: ${fullFilePath}`);
    log(`File extension: ${fileExt}`);
    const languageAnalyzer = LanguageAnalyzerFactory_1.LanguageAnalyzerFactory.getAnalyzer(fullFilePath);
    const dependencyAnalyzer = new DependencyAnalyzer_1.DependencyAnalyzer();
    const testFinder = new TestFinder_1.TestFinder();
    let changedFunctions = [];
    let changedClasses = [];
    let changedCodeAnalysis;
    let snapshotDiff = undefined;
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
            log(`Snapshot diff: ${snapshotDiff.changedSymbols.length} changed symbols, ${snapshotDiff.added.length} added symbols, ${snapshotDiff.removed.length} removed symbols, ${snapshotDiff.modified.length} modified symbols`);
            log(`Export changes: ${snapshotDiff.exportChanges.added.length} added, ${snapshotDiff.exportChanges.removed.length} removed, ${snapshotDiff.exportChanges.modified.length} modified`);
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
            // Count breaking changes (includes both symbol-level breaking changes and export removals)
            const breakingSymbolChanges = snapshotDiff.changedSymbols.filter(s => s.isBreaking);
            const breakingExportRemovals = snapshotDiff.exportChanges.removed.length;
            const breakingExportModifications = snapshotDiff.exportChanges.modified.length;
            const totalBreakingChanges = breakingSymbolChanges.length + breakingExportRemovals + breakingExportModifications;
            log(`Breaking changes: ${totalBreakingChanges} (${breakingSymbolChanges.length} symbol changes, ${breakingExportRemovals} export removals, ${breakingExportModifications} export modifications)`);
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
        }
        else {
            // Fallback to old findChangedElements method
            log(`   Using legacy findChangedElements method`);
            const changedElements = await languageAnalyzer.findChangedElements(before, after, fullFilePath);
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
    }
    else {
        // Fallback to generic CodeAnalyzer for unsupported languages
        log(`⚠️ No language-specific analyzer found for extension: ${fileExt}`);
        log(`   Falling back to generic CodeAnalyzer (regex-based parsing)`);
        log(`   Supported languages: ${LanguageAnalyzerFactory_1.LanguageAnalyzerFactory.getSupportedLanguages().join(', ')}`);
        const codeAnalyzer = new CodeAnalyzer_1.CodeAnalyzer();
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
        changedFunctions = findChangedFunctions(beforeAnalysis.functions, afterAnalysis.functions, before, after, log);
        log(`Changed functions: ${JSON.stringify(changedFunctions)}`);
        // Find changed classes
        log(`Finding changed classes...`);
        changedClasses = findChangedClasses(beforeAnalysis.classes, afterAnalysis.classes, before, after);
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
        (snapshotDiff && (snapshotDiff.changedSymbols.length > 0 ||
            snapshotDiff.exportChanges.removed.length > 0 ||
            snapshotDiff.exportChanges.modified.length > 0));
    if (!hasAnyChanges) {
        log(`✅ No changes detected, returning empty report`);
        log(`========================================`);
        return {
            report: (0, ImpactReport_1.createEmptyReport)(file),
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
    const impactedExportNames = new Set();
    if (snapshotDiff) {
        // Add removed export names
        for (const removedExport of snapshotDiff.exportChanges.removed) {
            impactedExportNames.add(removedExport.name);
        }
        // Add modified export names
        for (const modifiedExport of snapshotDiff.exportChanges.modified) {
            if ('name' in modifiedExport) {
                impactedExportNames.add(modifiedExport.name);
            }
            else if ('after' in modifiedExport) {
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
    log(`Impacted export names count: ${impactedExportNames.size}`);
    if (impactedExportNames.size === 0) {
        log(`⚠️ No impacted export names found - will find all files that import this module`);
    }
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
    // Get downstream files with line numbers
    let downstreamFilesWithLines = [];
    if (impactedExportNames.size > 0) {
        console.error(`[PureImpactAnalyzer] Calling findDownstreamComponentsWithLines with impactedExportNames`);
        downstreamFilesWithLines = await dependencyAnalyzer.findDownstreamComponentsWithLines(afterFilePath, changedCodeAnalysis, Array.from(impactedExportNames), projectRoot);
        console.error(`[PureImpactAnalyzer] findDownstreamComponentsWithLines returned ${downstreamFilesWithLines.length} files`);
    }
    else {
        console.error(`[PureImpactAnalyzer] Calling findDownstreamComponentsWithLines WITHOUT impactedExportNames`);
        downstreamFilesWithLines = await dependencyAnalyzer.findDownstreamComponentsWithLines(afterFilePath, changedCodeAnalysis, undefined, projectRoot);
        console.error(`[PureImpactAnalyzer] findDownstreamComponentsWithLines returned ${downstreamFilesWithLines.length} files`);
    }
    const downstreamFiles = downstreamFilesWithLines.map(item => item.file);
    log(`Found ${downstreamFiles.length} downstream files`);
    // Filter out test files from downstream files (test files should only be in affectedTests)
    const isTestFile = (filePath) => {
        const normalized = filePath.replace(/\\/g, '/');
        const isTest = (normalized.includes('/test/') ||
            normalized.includes('/tests/') ||
            normalized.includes('/__tests__/') ||
            /\.test\.(ts|tsx|js|jsx)$/i.test(normalized) ||
            /\.spec\.(ts|tsx|js|jsx)$/i.test(normalized));
        if (isTest) {
            log(`[PureImpactAnalyzer] File classified as test: ${normalized}`);
        }
        return isTest;
    };
    // Separate downstream files from test files (with line numbers)
    const sourceDownstreamFilesWithLines = downstreamFilesWithLines.filter(item => !isTestFile(item.file));
    const testFilesFromDependencyAnalyzer = downstreamFilesWithLines.filter(item => isTestFile(item.file));
    log(`Filtered ${downstreamFiles.length} files: ${sourceDownstreamFilesWithLines.length} source files, ${testFilesFromDependencyAnalyzer.length} test files`);
    // Debug: Log which files were classified as what
    if (downstreamFilesWithLines.length > 0) {
        log(`[PureImpactAnalyzer] Downstream files found:`);
        downstreamFilesWithLines.forEach(item => {
            const normalized = item.file.replace(/\\/g, '/');
            const isTest = isTestFile(item.file);
            log(`  - ${normalized} (line ${item.lineNumber}) - ${isTest ? 'TEST' : 'SOURCE'}`);
        });
    }
    // Convert to relative paths and store line numbers
    const relativeDownstreamFiles = sourceDownstreamFilesWithLines.map(item => ({
        file: path.relative(projectRoot, item.file),
        lineNumber: item.lineNumber
    }));
    // Store downstream files with line numbers for later use
    // Use plain object instead of Map for better serialization compatibility
    // Only store valid line numbers (>= 0); -1 means "unknown line" and should not be stored
    const downstreamFilesMap = {};
    for (const item of relativeDownstreamFiles) {
        // Only store if we have a valid line number (>= 0)
        // -1 is a sentinel for "unknown line" - don't store it, UI will handle it
        if (item.lineNumber >= 0) {
            downstreamFilesMap[item.file] = item.lineNumber;
            log(`[PureImpactAnalyzer] ✅ Stored line number for ${item.file}: ${item.lineNumber}`);
        }
        else {
            log(`[PureImpactAnalyzer] ⚠️ Line number is -1 (unknown) for ${item.file} - file will be shown but without line navigation`);
        }
    }
    const validLineCount = Object.keys(downstreamFilesMap).length;
    log(`[PureImpactAnalyzer] Stored ${validLineCount}/${relativeDownstreamFiles.length} downstream files with valid line numbers`);
    // Find affected tests - ONLY high-confidence tests with proven dependencies
    // High-confidence criteria:
    // 1. Tests found by DependencyAnalyzer (in downstreamFiles) - these have proven dependencies
    // 2. Tests that directly import the changed file
    // 3. (TS only) Tests with type reference paths to the changed file
    let affectedTests = [];
    // Strategy 1: Tests found by DependencyAnalyzer (highest confidence - proven dependency)
    const highConfidenceTests = new Set(testFilesFromDependencyAnalyzer.map(item => item.file));
    // Strategy 2: Find tests that directly import the changed file
    try {
        const testsThatImportSource = await findTestsThatImportFile(fullFilePath, projectRoot);
        for (const testFile of testsThatImportSource) {
            highConfidenceTests.add(testFile);
        }
    }
    catch (error) {
        log(`Error finding tests that import source: ${error}`);
    }
    // Strategy 3: Try TestFinder for additional tests that import the file (TS type references, etc.)
    try {
        const testFinderResults = await testFinder.findAffectedTests(fullFilePath, changedCodeAnalysis);
        // Only include tests from TestFinder if they have proven imports
        // TestFinder's filterRelevantTests already checks for imports, so include those
        for (const testFile of testFinderResults) {
            // Verify it actually imports the source (TestFinder should have filtered, but double-check)
            if (await testFileImportsSourceFile(testFile, fullFilePath, projectRoot)) {
                highConfidenceTests.add(testFile);
            }
        }
    }
    catch (error) {
        // Fallback: scan for test files manually, but only include those with proven imports
        console.log('TestFinder failed (likely in test environment), using fallback');
        const fallbackTests = await findTestFilesFallback(fullFilePath, projectRoot, sourceDownstreamFilesWithLines.map(item => item.file));
        // The fallback already filters by imports, so include those
        for (const testFile of fallbackTests) {
            highConfidenceTests.add(testFile);
        }
    }
    // Gate: Only include high-confidence tests with proven dependencies
    // If no proven dependencies exist, return empty array (don't guess)
    affectedTests = Array.from(highConfidenceTests);
    // Log summary
    const hasProvenDependencies = sourceDownstreamFilesWithLines.length > 0 || testFilesFromDependencyAnalyzer.length > 0 || affectedTests.length > 0;
    if (!hasProvenDependencies) {
        log(`⚠️ No proven test dependencies found. Not including any tests in affected tests list (to avoid false positives).`);
    }
    else {
        log(`Found ${affectedTests.length} high-confidence affected tests (${testFilesFromDependencyAnalyzer.length} from DependencyAnalyzer, ${affectedTests.length - testFilesFromDependencyAnalyzer.length} from import analysis)`);
    }
    // Convert to relative paths
    const relativeTests = affectedTests.map(f => path.relative(projectRoot, f));
    // Build issues list
    const issues = [
        ...relativeDownstreamFiles.map(item => ({
            type: "downstream",
            target: item.file
        })),
        ...relativeTests.map(target => ({
            type: "test",
            target
        })),
        ...changedFunctions.map(target => ({
            type: "function",
            target
        }))
    ];
    const report = {
        sourceFile: file,
        functions: changedFunctions,
        downstreamFiles: relativeDownstreamFiles.map(item => item.file), // Convert to string array for backward compatibility
        tests: relativeTests,
        issues
    };
    // Store line numbers map as a property on the report (not in the type definition for backward compatibility)
    report.downstreamFilesLineNumbers = downstreamFilesMap;
    return {
        report,
        snapshotDiff
    };
}
/**
 * Generate enhanced impact report with detailed breaking changes
 */
async function analyzeImpactEnhanced(params, debugLog) {
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
    return EnhancedReportFormatter_1.EnhancedReportFormatter.format(path.join(params.projectRoot, params.file), result.snapshotDiff, result.report, params.projectRoot);
}
/**
 * Find functions that changed between before and after.
 *
 * A function is considered "changed" if:
 * - Its signature changed (parameters, return type)
 * - It was removed
 * - It was renamed (heuristic: similar name, different location)
 */
function findChangedFunctions(beforeFunctions, afterFunctions, beforeContent, afterContent, debugLog) {
    const log = debugLog || (() => { });
    const changed = [];
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
                }
                else {
                    log(`  ✅ Signatures match - no change`);
                }
            }
            else {
                log(`  ⚠️ Could not extract one or both signatures`);
            }
        }
        else {
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
function findChangedClasses(beforeClasses, afterClasses, beforeContent, afterContent) {
    const changed = [];
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
function extractFunctionSignature(functionName, content) {
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
function extractClassDefinition(className, content) {
    const pattern = new RegExp(`(?:export\\s+)?class\\s+${escapeRegex(className)}[^{]*\\{[^}]*\\}`, 's');
    const match = content.match(pattern);
    return match ? match[0].trim() : null;
}
/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Fallback test file finder for test environments.
 * Scans the project directory for test files that might reference the source file.
 */
/**
 * Helper: Check if a file imports another file (checks import/require statements)
 */
async function testFileImportsSourceFile(testFilePath, sourceFilePath, projectRoot) {
    try {
        const content = fs.readFileSync(testFilePath, 'utf8');
        return fileImportsTarget(content, sourceFilePath, projectRoot);
    }
    catch {
        return false;
    }
}
/**
 * Helper: Check if content imports a target file
 */
function fileImportsTarget(content, targetPath, projectRoot) {
    const normalizedTarget = path.resolve(targetPath);
    const targetRel = path.relative(projectRoot, normalizedTarget).replace(/\\/g, '/');
    const targetDir = path.dirname(normalizedTarget);
    const targetDirRel = path.relative(projectRoot, targetDir).replace(/\\/g, '/');
    const targetName = path.basename(normalizedTarget, path.extname(normalizedTarget));
    const targetNameNoExt = path.basename(normalizedTarget, path.extname(normalizedTarget));
    // Get package name from source file (e.g., 'axios' from 'index.d.ts')
    // For package-level imports like 'import ... from "axios"'
    const packageName = getPackageNameFromFile(targetPath, projectRoot);
    // Escape special regex characters
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetRelEsc = esc(targetRel.replace(/\.(ts|tsx|js|jsx)$/, ''));
    const targetDirRelEsc = esc(targetDirRel);
    const targetNameEsc = esc(targetNameNoExt);
    const packageNameEsc = packageName ? esc(packageName) : null;
    // Allow ./ and ../ prefixes (repeatedly)
    const prefix = `(?:\\.{1,2}\\/)*`;
    // Check various import patterns
    const patterns = [
        // Relative imports: from './path/to/file' or from '../path/to/file'
        new RegExp(`from\\s+['"]${prefix}${targetRelEsc}['"]`, 'i'),
        new RegExp(`from\\s+['"]${prefix}${targetDirRelEsc}['"]`, 'i'),
        new RegExp(`from\\s+['"]${prefix}${targetNameEsc}['"]`, 'i'),
        new RegExp(`import\\s+.*\\s+from\\s+['"]${prefix}${targetRelEsc}['"]`, 'i'),
        new RegExp(`import\\s*\\(\\s*['"]${prefix}${targetRelEsc}['"]`, 'i'),
        new RegExp(`require\\s*\\(\\s*['"]${prefix}${targetRelEsc}['"]`, 'i'),
    ];
    // Add package-level import patterns (e.g., 'import ... from "axios"')
    if (packageNameEsc) {
        patterns.push(new RegExp(`from\\s+['"]${packageNameEsc}['"]`, 'i'), new RegExp(`import\\s+.*\\s+from\\s+['"]${packageNameEsc}['"]`, 'i'), new RegExp(`require\\s*\\(\\s*['"]${packageNameEsc}['"]`, 'i'));
    }
    return patterns.some(p => p.test(content));
}
/**
 * Helper: Try to extract package name from file path
 * E.g., for axios/index.d.ts -> 'axios'
 */
function getPackageNameFromFile(filePath, projectRoot) {
    try {
        // Check if file is in node_modules (external package)
        if (filePath.includes('node_modules')) {
            const parts = filePath.split(path.sep);
            const nodeModulesIndex = parts.indexOf('node_modules');
            if (nodeModulesIndex >= 0 && nodeModulesIndex + 1 < parts.length) {
                return parts[nodeModulesIndex + 1];
            }
        }
        // Check package.json in the file's directory tree
        let currentDir = path.dirname(filePath);
        const rootDir = projectRoot;
        while (currentDir !== rootDir && currentDir !== path.dirname(currentDir)) {
            const packageJsonPath = path.join(currentDir, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                try {
                    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                    return packageJson.name || null;
                }
                catch {
                    // Invalid JSON, continue
                }
            }
            currentDir = path.dirname(currentDir);
        }
    }
    catch {
        // Ignore errors
    }
    return null;
}
/**
 * Find tests that directly import the source file (high-confidence)
 */
async function findTestsThatImportFile(sourceFilePath, projectRoot) {
    const testFiles = [];
    const testPatterns = [
        /\.test\.(js|jsx|ts|tsx)$/i,
        /\.spec\.(js|jsx|ts|tsx)$/i
    ];
    function walkDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // Skip node_modules and other build directories
                    if (!['node_modules', '.git', 'dist', 'build', 'out'].includes(entry.name)) {
                        walkDir(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    const isTestFile = testPatterns.some(pattern => pattern.test(entry.name));
                    if (isTestFile) {
                        if (fileImportsTarget(fs.readFileSync(fullPath, 'utf8'), sourceFilePath, projectRoot)) {
                            testFiles.push(fullPath);
                        }
                    }
                }
            }
        }
        catch {
            // Skip if can't read
        }
    }
    walkDir(projectRoot);
    return [...new Set(testFiles)];
}
/**
 * Find all test files in repo (for low-confidence suggestions when no dependencies proven)
 */
async function findAllTestFilesInRepo(projectRoot) {
    const testFiles = [];
    const testPatterns = [
        /\.test\.(js|jsx|ts|tsx)$/i,
        /\.spec\.(js|jsx|ts|tsx)$/i
    ];
    function walkDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!['node_modules', '.git', 'dist', 'build', 'out'].includes(entry.name)) {
                        walkDir(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    if (testPatterns.some(pattern => pattern.test(entry.name))) {
                        testFiles.push(fullPath);
                    }
                }
            }
        }
        catch {
            // Skip if can't read
        }
    }
    walkDir(projectRoot);
    return [...new Set(testFiles)];
}
/**
 * Fallback: Find test files that import the source or downstream files
 * ONLY returns tests with proven imports (no name matching fallback)
 */
async function findTestFilesFallback(sourceFilePath, projectRoot, downstreamFiles = []) {
    const testFiles = [];
    const normalizedSource = path.resolve(sourceFilePath);
    const normalizedDownstream = new Set(downstreamFiles.map(f => path.resolve(f)));
    // Test patterns
    const testPatterns = [
        /\.test\.(js|jsx|ts|tsx)$/i,
        /\.spec\.(js|jsx|ts|tsx)$/i
    ];
    // Walk directory recursively
    function walkDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // Skip node_modules and other build directories
                    if (!['node_modules', '.git', 'dist', 'build', 'out'].includes(entry.name)) {
                        walkDir(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    // Check if it's a test file
                    const isTestFile = testPatterns.some(pattern => pattern.test(entry.name));
                    if (isTestFile) {
                        try {
                            const content = fs.readFileSync(fullPath, 'utf8');
                            const normalizedPath = path.resolve(fullPath);
                            // ONLY include if test imports the source file (proven dependency)
                            if (fileImportsTarget(content, normalizedSource, projectRoot)) {
                                testFiles.push(fullPath);
                                continue;
                            }
                            // OR if test imports any downstream file (transitive dependency)
                            for (const downstream of normalizedDownstream) {
                                if (fileImportsTarget(content, downstream, projectRoot)) {
                                    testFiles.push(fullPath);
                                    break;
                                }
                            }
                            // NO name matching fallback - only proven imports
                        }
                        catch {
                            // Skip if can't read
                        }
                    }
                }
            }
        }
        catch {
            // Skip if can't read directory
        }
    }
    // Start from project root to find all test files
    walkDir(projectRoot);
    return [...new Set(testFiles)];
}
//# sourceMappingURL=PureImpactAnalyzer.js.map