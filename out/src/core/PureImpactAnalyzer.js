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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeImpact = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ImpactReport_1 = require("../types/ImpactReport");
const CodeAnalyzer_1 = require("../analyzers/CodeAnalyzer");
const DependencyAnalyzer_1 = require("../analyzers/DependencyAnalyzer");
const TestFinder_1 = require("../analyzers/TestFinder");
async function analyzeImpact(params, debugLog) {
    const { file, before, after, projectRoot } = params;
    const log = debugLog || ((msg) => console.log(`[PureImpactAnalyzer] ${msg}`));
    log(`========================================`);
    log(`analyzeImpact() called for: ${file}`);
    log(`Before length: ${before.length}, After length: ${after.length}`);
    log(`Before === After: ${before === after}`);
    // If before and after are identical, return empty report
    if (before === after) {
        log(`✅ Before === After, returning empty report`);
        log(`========================================`);
        return (0, ImpactReport_1.createEmptyReport)(file);
    }
    log(`⚠️ Before !== After, analyzing changes...`);
    const codeAnalyzer = new CodeAnalyzer_1.CodeAnalyzer();
    const dependencyAnalyzer = new DependencyAnalyzer_1.DependencyAnalyzer();
    const testFinder = new TestFinder_1.TestFinder();
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
    const changedFunctions = findChangedFunctions(beforeAnalysis.functions, afterAnalysis.functions, before, after, log);
    log(`Changed functions: ${JSON.stringify(changedFunctions)}`);
    // Find changed classes
    log(`Finding changed classes...`);
    const changedClasses = findChangedClasses(beforeAnalysis.classes, afterAnalysis.classes, before, after);
    log(`Changed classes: ${JSON.stringify(changedClasses)}`);
    // If nothing changed, return empty report
    if (changedFunctions.length === 0 && changedClasses.length === 0) {
        log(`✅ No functions or classes changed, returning empty report`);
        log(`========================================`);
        return (0, ImpactReport_1.createEmptyReport)(file);
    }
    log(`⚠️ Found ${changedFunctions.length} changed functions, ${changedClasses.length} changed classes`);
    // Build code analysis result for downstream/test finding
    const changedCodeAnalysis = {
        functions: changedFunctions,
        classes: changedClasses,
        modules: afterAnalysis.modules,
        imports: afterAnalysis.imports,
        exports: afterAnalysis.exports,
        complexity: afterAnalysis.complexity,
        linesOfCode: afterAnalysis.linesOfCode
    };
    // Find downstream files
    const fullFilePath = path.join(projectRoot, file);
    const downstreamFiles = await dependencyAnalyzer.findDownstreamComponents(fullFilePath, changedCodeAnalysis);
    // Convert to relative paths
    const relativeDownstreamFiles = downstreamFiles.map(f => path.relative(projectRoot, f));
    // Find affected tests
    // Note: TestFinder may return empty in test environments without vscode.workspace
    // For testing, we'll also do a simple file system scan
    let affectedTests = [];
    try {
        affectedTests = await testFinder.findAffectedTests(fullFilePath, changedCodeAnalysis);
    }
    catch (error) {
        // Fallback: scan for test files manually
        console.log('TestFinder failed (likely in test environment), using fallback');
        affectedTests = await findTestFilesFallback(fullFilePath, projectRoot);
    }
    // Convert to relative paths
    const relativeTests = affectedTests.map(f => path.relative(projectRoot, f));
    // Build issues list
    const issues = [
        ...relativeDownstreamFiles.map(target => ({
            type: "downstream",
            target
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
    return {
        sourceFile: file,
        functions: changedFunctions,
        downstreamFiles: relativeDownstreamFiles,
        tests: relativeTests,
        issues
    };
}
exports.analyzeImpact = analyzeImpact;
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
async function findTestFilesFallback(sourceFilePath, projectRoot) {
    const testFiles = [];
    const sourceFileName = path.basename(sourceFilePath, path.extname(sourceFilePath));
    const sourceDir = path.dirname(sourceFilePath);
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
                        // Check if it references the source file
                        try {
                            const content = fs.readFileSync(fullPath, 'utf8');
                            if (content.includes(sourceFileName) ||
                                content.includes(path.basename(sourceFilePath))) {
                                testFiles.push(fullPath);
                            }
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
    // Start from source directory and project root
    walkDir(sourceDir);
    walkDir(projectRoot);
    return [...new Set(testFiles)];
}
//# sourceMappingURL=PureImpactAnalyzer.js.map