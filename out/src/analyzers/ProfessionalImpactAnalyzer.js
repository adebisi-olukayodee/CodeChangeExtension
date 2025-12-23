"use strict";
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
exports.ProfessionalImpactAnalyzer = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
const ts_morph_1 = require("ts-morph");
const child_process_1 = require("child_process");
class ProfessionalImpactAnalyzer {
    constructor() {
        this.gitRoot = null;
        this.contentCache = new Map();
        this.initializeProject();
        this.initializeGitRoot();
    }
    initializeProject() {
        // Initialize ts-morph project
        this.project = new ts_morph_1.Project({
            useInMemoryFileSystem: false,
            compilerOptions: {
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.CommonJS,
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                forceConsistentCasingInFileNames: true,
                resolveJsonModule: true,
                declaration: true,
                declarationMap: true,
                sourceMap: true
            }
        });
        // Initialize TypeScript program
        this.program = ts.createProgram([], {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true
        });
        this.checker = this.program.getTypeChecker();
    }
    async initializeGitRoot() {
        const candidates = [];
        try {
            // Prefer VS Code workspace folders (user project roots)
            const vscode = require('vscode');
            const workspaceFolders = vscode.workspace?.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                for (const folder of workspaceFolders) {
                    if (folder?.uri?.fsPath) {
                        candidates.push(folder.uri.fsPath);
                    }
                }
            }
        }
        catch (error) {
            console.log('Unable to access VS Code workspace folders while resolving git root:', error);
        }
        // Fallback to current working directory
        candidates.push(process.cwd());
        for (const candidate of candidates) {
            try {
                const result = (0, child_process_1.execSync)('git rev-parse --show-toplevel', {
                    encoding: 'utf8',
                    cwd: candidate
                });
                this.gitRoot = result.trim();
                console.log(`[ProfessionalAnalyzer] Git root resolved to ${this.gitRoot} (cwd: ${candidate})`);
                return;
            }
            catch (error) {
                // try next candidate
            }
        }
        console.log('Not in a git repository or git not available');
        this.gitRoot = null;
    }
    async analyzeFileImpact(filePath) {
        try {
            console.log(`Professional analysis starting for: ${filePath}`);
            // Check if this is a Python file - use regex-based parsing
            const fileLanguage = this.getFileLanguage(filePath);
            if (fileLanguage === 'python') {
                console.log(`Detected Python file - using Python-specific parser`);
                return await this.analyzePythonFile(filePath);
            }
            // For TypeScript/JavaScript files, use AST-based parsing
            // Show visible notification for debugging
            const vscode = require('vscode');
            vscode.window.showInformationMessage(`🔍 Analyzing: ${filePath.split('\\').pop()}`);
            // Add file to project
            console.log(`Attempting to add file to project: ${filePath}`);
            console.log(`File exists check:`, require('fs').existsSync(filePath));
            let sourceFile;
            try {
                sourceFile = this.project.addSourceFileAtPath(filePath);
                console.log(`Successfully added file to project`);
            }
            catch (error) {
                console.error(`Failed to add file to project:`, error);
                // Try to read the file content directly
                const content = require('fs').readFileSync(filePath, 'utf8');
                sourceFile = this.project.createSourceFile(filePath, content);
                console.log(`Created source file from content`);
            }
            // Get git diff to understand what changed
            const gitDiff = await this.getGitDiff(filePath);
            console.log(`Git diff for ${filePath}:`, gitDiff);
            const changedLines = this.parseChangedLines(gitDiff);
            console.log(`Changed lines:`, changedLines);
            // If no git diff available, analyze all functions/classes as changed
            let changedFunctions;
            let changedClasses;
            if (changedLines.length === 0) {
                console.log('No git diff available, using content-based change detection');
                vscode.window.showInformationMessage('📝 No git diff - using content analysis');
                // Use content-based change detection
                const currentContent = require('fs').readFileSync(filePath, 'utf8');
                const previousContent = this.getCachedContent(filePath);
                if (previousContent && previousContent !== currentContent) {
                    console.log('File content changed, analyzing differences');
                    vscode.window.showInformationMessage('📝 File content changed - analyzing differences');
                    // Compare current and previous content to find actual changes
                    const currentFunctions = await this.analyzeAllFunctions(sourceFile);
                    const currentClasses = await this.analyzeAllClasses(sourceFile);
                    // For now, if content changed, show all functions/classes
                    // In a real implementation, you'd parse both versions and compare
                    changedFunctions = currentFunctions;
                    changedClasses = currentClasses;
                }
                else if (!previousContent) {
                    console.log('First time analyzing file, showing all functions/classes');
                    vscode.window.showInformationMessage('📝 First analysis - showing all functions/classes');
                    changedFunctions = await this.analyzeAllFunctions(sourceFile);
                    changedClasses = await this.analyzeAllClasses(sourceFile);
                }
                else {
                    console.log('No content changes detected');
                    vscode.window.showInformationMessage('📝 No changes detected');
                    changedFunctions = [];
                    changedClasses = [];
                }
                // Cache the current content for next time
                this.cacheContent(filePath, currentContent);
            }
            else {
                // Analyze changes using TypeScript Compiler API
                vscode.window.showInformationMessage(`📝 Git diff found - analyzing changed lines: ${changedLines.length}`);
                changedFunctions = await this.analyzeChangedFunctions(sourceFile, changedLines);
                changedClasses = await this.analyzeChangedClasses(sourceFile, changedLines);
            }
            console.log(`Found ${changedFunctions.length} changed functions:`, changedFunctions.map(f => f.name));
            console.log(`Found ${changedClasses.length} changed classes:`, changedClasses.map(c => c.name));
            // Show visible results
            vscode.window.showInformationMessage(`✅ Found ${changedFunctions.length} functions, ${changedClasses.length} classes`);
            // Debug: Show function and class names
            if (changedFunctions.length > 0) {
                console.log(`Function names: ${changedFunctions.map(f => f.name).join(', ')}`);
            }
            if (changedClasses.length > 0) {
                console.log(`Class names: ${changedClasses.map(c => c.name).join(', ')}`);
            }
            // Find affected tests using type-aware analysis
            const affectedTests = await this.findAffectedTestsTypeAware(changedFunctions, changedClasses, filePath);
            // Analyze downstream dependencies
            const downstreamComponents = await this.findDownstreamComponentsTypeAware(changedFunctions, changedClasses, filePath);
            // Detect breaking changes
            const breakingChanges = await this.detectBreakingChanges(changedFunctions, changedClasses);
            // Analyze type changes
            const typeChanges = await this.analyzeTypeChanges(sourceFile, changedLines);
            // Calculate metrics
            const confidence = this.calculateConfidence(changedFunctions, changedClasses, affectedTests);
            const estimatedTestTime = this.estimateTestTime(affectedTests);
            const coverageImpact = this.calculateCoverageImpact(changedFunctions, changedClasses);
            const riskLevel = this.calculateRiskLevel(breakingChanges, downstreamComponents);
            return {
                filePath,
                changedFunctions,
                changedClasses,
                affectedTests,
                downstreamComponents,
                confidence,
                estimatedTestTime,
                coverageImpact,
                riskLevel,
                breakingChanges,
                typeChanges
            };
        }
        catch (error) {
            console.error('Professional analysis failed:', error);
            return this.getEmptyResult(filePath);
        }
    }
    getCachedContent(filePath) {
        return this.contentCache.get(filePath) || null;
    }
    cacheContent(filePath, content) {
        this.contentCache.set(filePath, content);
    }
    async analyzeChangedFunctions(sourceFile, changedLines) {
        const changedFunctions = [];
        // Get all function declarations
        const functions = sourceFile.getFunctions();
        console.log(`Found ${functions.length} functions in file`);
        for (const func of functions) {
            const funcStartLine = func.getStartLineNumber();
            const funcEndLine = func.getEndLineNumber();
            const funcName = func.getName() || 'anonymous';
            console.log(`Function ${funcName} at line ${funcStartLine} (ends at ${funcEndLine})`);
            // Check if function start is in changed lines OR if any changed line is within the function body
            const isFunctionChanged = this.isInChangedLines(funcStartLine, changedLines) ||
                changedLines.some(changedLine => changedLine >= funcStartLine && changedLine <= funcEndLine);
            if (isFunctionChanged) {
                console.log(`Function ${funcName} is in changed lines (lines ${funcStartLine}-${funcEndLine})`);
                const changedFunction = {
                    name: func.getName() || 'anonymous',
                    line: funcStartLine,
                    signature: this.getFunctionSignature(func),
                    returnType: this.getReturnType(func),
                    parameters: this.getParameters(func),
                    isExported: func.isExported(),
                    isAsync: func.isAsync()
                };
                changedFunctions.push(changedFunction);
            }
        }
        // Also check method declarations in classes
        const classes = sourceFile.getClasses();
        for (const cls of classes) {
            const methods = cls.getMethods();
            for (const method of methods) {
                const methodStartLine = method.getStartLineNumber();
                const methodEndLine = method.getEndLineNumber();
                // Check if method start is in changed lines OR if any changed line is within the method body
                const isMethodChanged = this.isInChangedLines(methodStartLine, changedLines) ||
                    changedLines.some(changedLine => changedLine >= methodStartLine && changedLine <= methodEndLine);
                if (isMethodChanged) {
                    const changedFunction = {
                        name: `${cls.getName()}.${method.getName()}`,
                        line: methodStartLine,
                        signature: this.getFunctionSignature(method),
                        returnType: this.getReturnType(method),
                        parameters: this.getParameters(method),
                        isExported: cls.isExported(),
                        isAsync: method.isAsync()
                    };
                    changedFunctions.push(changedFunction);
                    console.log(`Method ${cls.getName()}.${method.getName()} detected as changed (lines ${methodStartLine}-${methodEndLine})`);
                }
            }
        }
        return changedFunctions;
    }
    async analyzeChangedClasses(sourceFile, changedLines) {
        const changedClasses = [];
        const classes = sourceFile.getClasses();
        for (const cls of classes) {
            const line = cls.getStartLineNumber();
            if (this.isInChangedLines(line, changedLines)) {
                const methods = cls.getMethods().map(method => ({
                    name: method.getName(),
                    line: method.getStartLineNumber(),
                    signature: this.getFunctionSignature(method),
                    returnType: this.getReturnType(method),
                    parameters: this.getParameters(method),
                    isExported: cls.isExported(),
                    isAsync: method.isAsync()
                }));
                const properties = cls.getProperties().map(prop => ({
                    name: prop.getName(),
                    type: prop.getTypeNode()?.getText() || 'any',
                    isOptional: prop.hasQuestionToken(),
                    isReadonly: prop.isReadonly()
                }));
                const changedClass = {
                    name: cls.getName() || 'anonymous',
                    line,
                    methods,
                    properties,
                    isExported: cls.isExported(),
                    extends: cls.getExtends()?.getText(),
                    implements: cls.getImplements().map(impl => impl.getText())
                };
                changedClasses.push(changedClass);
            }
        }
        return changedClasses;
    }
    async analyzeAllFunctions(sourceFile) {
        const allFunctions = [];
        // Get all function declarations
        const functions = sourceFile.getFunctions();
        console.log(`Found ${functions.length} functions in file (analyzing all as changed)`);
        // Show visible notification
        const vscode = require('vscode');
        vscode.window.showInformationMessage(`🔍 Found ${functions.length} functions in file`);
        for (const func of functions) {
            const line = func.getStartLineNumber();
            const funcName = func.getName() || 'anonymous';
            console.log(`Function ${funcName} at line ${line} (marked as changed)`);
            const changedFunction = {
                name: func.getName() || 'anonymous',
                line,
                signature: this.getFunctionSignature(func),
                returnType: this.getReturnType(func),
                parameters: this.getParameters(func),
                isExported: func.isExported(),
                isAsync: func.isAsync()
            };
            allFunctions.push(changedFunction);
        }
        // Also check method declarations in classes
        const classes = sourceFile.getClasses();
        for (const cls of classes) {
            const methods = cls.getMethods();
            for (const method of methods) {
                const line = method.getStartLineNumber();
                const methodName = method.getName();
                console.log(`Method ${cls.getName()}.${methodName} at line ${line} (marked as changed)`);
                const changedFunction = {
                    name: `${cls.getName()}.${methodName}`,
                    line,
                    signature: this.getFunctionSignature(method),
                    returnType: this.getReturnType(method),
                    parameters: this.getParameters(method),
                    isExported: cls.isExported(),
                    isAsync: method.isAsync()
                };
                allFunctions.push(changedFunction);
            }
        }
        return allFunctions;
    }
    async analyzeAllClasses(sourceFile) {
        const allClasses = [];
        const classes = sourceFile.getClasses();
        console.log(`Found ${classes.length} classes in file (analyzing all as changed)`);
        for (const cls of classes) {
            const line = cls.getStartLineNumber();
            const className = cls.getName() || 'anonymous';
            console.log(`Class ${className} at line ${line} (marked as changed)`);
            const methods = cls.getMethods().map(method => ({
                name: method.getName(),
                line: method.getStartLineNumber(),
                signature: this.getFunctionSignature(method),
                returnType: this.getReturnType(method),
                parameters: this.getParameters(method),
                isExported: cls.isExported(),
                isAsync: method.isAsync()
            }));
            const properties = cls.getProperties().map(prop => ({
                name: prop.getName(),
                type: prop.getTypeNode()?.getText() || 'any',
                isOptional: prop.hasQuestionToken(),
                isReadonly: prop.isReadonly()
            }));
            const changedClass = {
                name: cls.getName() || 'anonymous',
                line,
                methods,
                properties,
                isExported: cls.isExported(),
                extends: cls.getExtends()?.getText(),
                implements: cls.getImplements().map(impl => impl.getText())
            };
            allClasses.push(changedClass);
        }
        return allClasses;
    }
    async findAffectedTestsTypeAware(changedFunctions, changedClasses, sourceFilePath) {
        const affectedTests = [];
        try {
            console.log(`Finding tests for ${changedFunctions.length} functions and ${changedClasses.length} classes`);
            // Get source file language to filter by compatible languages
            const sourceLanguage = this.getFileLanguage(sourceFilePath);
            // Look for test files in the workspace
            const testFiles = await this.findTestFilesInWorkspace();
            console.log(`Found ${testFiles.length} test files in workspace`);
            // For each test file, check if it imports or uses our changed functions/classes
            for (const testFile of testFiles) {
                try {
                    // Skip the source file itself if it's a test file
                    if (this.normalizePath(testFile) === this.normalizePath(sourceFilePath)) {
                        continue;
                    }
                    const testLanguage = this.getFileLanguage(testFile);
                    // Filter by language compatibility
                    if (!this.isLanguageCompatible(sourceLanguage, testLanguage)) {
                        continue;
                    }
                    const testContent = require('fs').readFileSync(testFile, 'utf8');
                    // Check if test file imports from the source file itself
                    // This catches cases where test imports types or other exports from the changed file
                    const sourceFileName = path.basename(sourceFilePath, path.extname(sourceFilePath));
                    const sourceDir = path.dirname(sourceFilePath);
                    const sourceRelativePath = path.relative(path.dirname(testFile), sourceFilePath).replace(/\\/g, '/');
                    // Match various import patterns for the source file
                    const sourceFileImportPatterns = [
                        new RegExp(`from\\s+['"]${this.escapeRegex(sourceRelativePath)}['"]`, 'g'),
                        new RegExp(`from\\s+['"]\\.\\.?/[^'"]*${this.escapeRegex(sourceFileName)}['"]`, 'g'),
                        new RegExp(`require\\(['"]${this.escapeRegex(sourceRelativePath)}['"]\\)`, 'g')
                    ];
                    const importsFromSourceFile = sourceFileImportPatterns.some(pattern => pattern.test(testContent));
                    // Check if test file imports or uses any of our changed functions/classes
                    let foundFunction = false;
                    for (const func of changedFunctions) {
                        if (this.isFunctionUsedInFile(testContent, func.name, sourceLanguage, testLanguage)) {
                            affectedTests.push(testFile);
                            console.log(`Test file ${testFile} uses function ${func.name}`);
                            foundFunction = true;
                            break; // Don't add the same test file multiple times
                        }
                    }
                    if (!foundFunction && !affectedTests.includes(testFile)) {
                        for (const cls of changedClasses) {
                            if (this.isClassUsedInFile(testContent, cls.name, sourceLanguage, testLanguage)) {
                                affectedTests.push(testFile);
                                console.log(`Test file ${testFile} uses class ${cls.name}`);
                                foundFunction = true;
                                break; // Don't add the same test file multiple times
                            }
                        }
                    }
                    // If test imports from source file but doesn't directly use changed functions,
                    // still flag it as affected (it might test related functionality)
                    if (!affectedTests.includes(testFile) && importsFromSourceFile) {
                        affectedTests.push(testFile);
                        console.log(`Test file ${testFile} imports from source file ${sourceFilePath}`);
                    }
                }
                catch (error) {
                    console.log(`Error reading test file ${testFile}:`, error);
                }
            }
            return [...new Set(affectedTests)]; // Remove duplicates
        }
        catch (error) {
            console.error('Error finding affected tests:', error);
            return [];
        }
    }
    async findDownstreamComponentsTypeAware(changedFunctions, changedClasses, sourceFilePath) {
        const downstreamComponents = [];
        try {
            console.log(`Finding downstream components for ${changedFunctions.length} functions and ${changedClasses.length} classes`);
            // Get source file language to filter by compatible languages
            const sourceLanguage = this.getFileLanguage(sourceFilePath);
            console.log(`Source file language: ${sourceLanguage}`);
            // Find all source files in the workspace
            const sourceFiles = await this.findSourceFilesInWorkspace();
            console.log(`Found ${sourceFiles.length} source files in workspace`);
            // For each source file, check if it references our changed functions/classes
            for (const sourceFile of sourceFiles) {
                try {
                    // Skip the source file itself (normalize paths for comparison)
                    if (this.normalizePath(sourceFile) === this.normalizePath(sourceFilePath)) {
                        console.log(`Skipping source file itself: ${sourceFile}`);
                        continue;
                    }
                    // Skip test files - they should only appear in "Affected Tests", not "Downstream Components"
                    if (this.isTestFile(sourceFile)) {
                        console.log(`Skipping test file from downstream components: ${sourceFile}`);
                        continue;
                    }
                    // Filter by language compatibility
                    const targetLanguage = this.getFileLanguage(sourceFile);
                    if (!this.isLanguageCompatible(sourceLanguage, targetLanguage)) {
                        console.log(`Skipping ${sourceFile} - incompatible language (${sourceLanguage} -> ${targetLanguage})`);
                        continue;
                    }
                    const content = require('fs').readFileSync(sourceFile, 'utf8');
                    let isDownstream = false;
                    // Check if source file references any changed functions
                    for (const func of changedFunctions) {
                        if (this.isFunctionUsedInFile(content, func.name, sourceLanguage, targetLanguage)) {
                            console.log(`Source file ${sourceFile} references function ${func.name}`);
                            isDownstream = true;
                            break;
                        }
                    }
                    // Check if source file references any changed classes
                    if (!isDownstream) {
                        for (const cls of changedClasses) {
                            if (this.isClassUsedInFile(content, cls.name, sourceLanguage, targetLanguage)) {
                                console.log(`Source file ${sourceFile} references class ${cls.name}`);
                                isDownstream = true;
                                break;
                            }
                        }
                    }
                    if (isDownstream) {
                        downstreamComponents.push(sourceFile);
                    }
                }
                catch (error) {
                    console.error(`Error reading source file ${sourceFile}:`, error);
                }
            }
            console.log(`Found ${downstreamComponents.length} direct downstream components`);
            // Now find indirect dependencies (files that import from files that use our changed functions)
            const indirectDependencies = await this.findIndirectDependencies(downstreamComponents, changedFunctions, changedClasses, sourceFilePath);
            console.log(`Found ${indirectDependencies.length} indirect downstream components`);
            // Combine direct and indirect dependencies
            const allDependencies = [...new Set([...downstreamComponents, ...indirectDependencies])];
            console.log(`Found ${allDependencies.length} total downstream components (direct + indirect)`);
            return allDependencies;
        }
        catch (error) {
            console.error('Error finding downstream components:', error);
            return [];
        }
    }
    /**
     * Find indirect dependencies - files that import from files that use our changed functions
     * Example: calculateDiscount -> priceHelpers -> cart-summary
     */
    async findIndirectDependencies(directDependencies, changedFunctions, changedClasses, sourceFilePath) {
        const indirectDependencies = [];
        if (directDependencies.length === 0) {
            return indirectDependencies;
        }
        try {
            const sourceLanguage = this.getFileLanguage(sourceFilePath);
            const sourceFiles = await this.findSourceFilesInWorkspace();
            // For each direct dependency, find files that import from it
            for (const directDep of directDependencies) {
                const directDepFileName = path.basename(directDep, path.extname(directDep));
                const directDepLanguage = this.getFileLanguage(directDep);
                console.log(`Finding files that import from ${directDepFileName}`);
                for (const potentialDep of sourceFiles) {
                    try {
                        // Skip if it's the source file or already a direct dependency
                        if (this.normalizePath(potentialDep) === this.normalizePath(sourceFilePath) ||
                            directDependencies.includes(potentialDep) ||
                            indirectDependencies.includes(potentialDep)) {
                            continue;
                        }
                        // Skip test files - they should only appear in "Affected Tests", not "Downstream Components"
                        if (this.isTestFile(potentialDep)) {
                            console.log(`Skipping test file from indirect dependencies: ${potentialDep}`);
                            continue;
                        }
                        const targetLanguage = this.getFileLanguage(potentialDep);
                        if (!this.isLanguageCompatible(sourceLanguage, targetLanguage)) {
                            continue;
                        }
                        const content = require('fs').readFileSync(potentialDep, 'utf8');
                        // Check if this file imports from the direct dependency
                        // Try multiple path variations
                        const directDepRelativePath = path.relative(path.dirname(potentialDep), directDep).replace(/\\/g, '/');
                        const directDepRelativePathNoExt = directDepRelativePath.replace(/\.(ts|tsx|js|jsx)$/, '');
                        const directDepDirName = path.basename(path.dirname(directDep));
                        const directDepBaseName = path.basename(directDep, path.extname(directDep));
                        // Debug logging
                        console.log(`Checking indirect dependency: ${path.basename(potentialDep)} -> ${path.basename(directDep)}`);
                        console.log(`  Relative path: ${directDepRelativePath}`);
                        console.log(`  Relative path (no ext): ${directDepRelativePathNoExt}`);
                        console.log(`  Base name: ${directDepBaseName}`);
                        // Build patterns to match various import styles - check RAW content first (imports are preserved)
                        const directDepImportPatterns = [
                            // ES6 import: import ... from '../lib/priceHelpers'
                            new RegExp(`from\\s+['"]${this.escapeRegex(directDepRelativePathNoExt)}['"]`, 'g'),
                            // ES6 import: import ... from '../lib/priceHelpers.ts'
                            new RegExp(`from\\s+['"]${this.escapeRegex(directDepRelativePath)}['"]`, 'g'),
                            // ES6 import: import ... from '../lib/priceHelpers' (any relative path ending with filename)
                            new RegExp(`from\\s+['"]\\.\\.?/[^'"]*${this.escapeRegex(directDepBaseName)}['"]`, 'g'),
                            // ES6 import: import ... from '../lib/priceHelpers' (with directory)
                            new RegExp(`from\\s+['"]\\.\\.?/[^'"]*/${directDepDirName}/${this.escapeRegex(directDepBaseName)}['"]`, 'g'),
                            // CommonJS require: require('../lib/priceHelpers')
                            new RegExp(`require\\(['"]${this.escapeRegex(directDepRelativePathNoExt)}['"]\\)`, 'g'),
                            new RegExp(`require\\(['"]${this.escapeRegex(directDepRelativePath)}['"]\\)`, 'g'),
                            new RegExp(`require\\(['"]\\.\\.?/[^'"]*${this.escapeRegex(directDepBaseName)}['"]\\)`, 'g')
                        ];
                        // Test each pattern on RAW content first (imports are preserved)
                        let importsDirectDep = false;
                        for (const pattern of directDepImportPatterns) {
                            pattern.lastIndex = 0; // Reset regex state
                            if (pattern.test(content)) {
                                importsDirectDep = true;
                                console.log(`✅ Pattern matched for ${path.basename(potentialDep)} importing from ${path.basename(directDep)}`);
                                break;
                            }
                        }
                        // Also check if the filename appears in any import statement (fallback)
                        if (!importsDirectDep) {
                            const fallbackPattern = new RegExp(`(?:from|require)\\s+['"]\\.\\.?/[^'"]*${this.escapeRegex(directDepBaseName)}['"]`, 'g');
                            fallbackPattern.lastIndex = 0;
                            if (fallbackPattern.test(content)) {
                                importsDirectDep = true;
                                console.log(`✅ Fallback pattern matched for ${path.basename(potentialDep)} importing from ${path.basename(directDep)}`);
                            }
                        }
                        // Debug: Log the actual import statements found if not matched
                        if (!importsDirectDep) {
                            const importLines = content.split('\n').filter((line) => line.includes('import') && (line.includes(directDepBaseName) || line.includes(directDepRelativePathNoExt)));
                            if (importLines.length > 0) {
                                console.log(`⚠️ DEBUG: Found import lines in ${path.basename(potentialDep)} that mention ${directDepBaseName}:`, importLines);
                                console.log(`   Expected path pattern: ${directDepRelativePathNoExt}`);
                            }
                        }
                        if (importsDirectDep) {
                            console.log(`Found indirect dependency: ${potentialDep} imports from ${directDep}`);
                            indirectDependencies.push(potentialDep);
                        }
                    }
                    catch (error) {
                        console.error(`Error checking indirect dependency ${potentialDep}:`, error);
                    }
                }
            }
            return [...new Set(indirectDependencies)]; // Remove duplicates
        }
        catch (error) {
            console.error('Error finding indirect dependencies:', error);
            return [];
        }
    }
    async detectBreakingChanges(changedFunctions, changedClasses) {
        const breakingChanges = [];
        // This would compare with previous version to detect breaking changes
        // For now, we'll implement basic heuristics
        for (const func of changedFunctions) {
            if (func.isExported) {
                breakingChanges.push({
                    type: 'signature',
                    description: `Exported function '${func.name}' signature changed`,
                    severity: 'high',
                    affectedConsumers: [] // Would be populated by reference analysis
                });
            }
        }
        for (const cls of changedClasses) {
            if (cls.isExported) {
                breakingChanges.push({
                    type: 'signature',
                    description: `Exported class '${cls.name}' changed`,
                    severity: 'high',
                    affectedConsumers: [] // Would be populated by reference analysis
                });
            }
        }
        return breakingChanges;
    }
    async analyzeTypeChanges(sourceFile, changedLines) {
        const typeChanges = [];
        // Analyze interfaces
        const interfaces = sourceFile.getInterfaces();
        for (const intf of interfaces) {
            const line = intf.getStartLineNumber();
            if (this.isInChangedLines(line, changedLines)) {
                typeChanges.push({
                    type: 'interface',
                    name: intf.getName(),
                    change: 'modified',
                    affectedFiles: [] // Would be populated by reference analysis
                });
            }
        }
        // Analyze type aliases
        const typeAliases = sourceFile.getTypeAliases();
        for (const typeAlias of typeAliases) {
            const line = typeAlias.getStartLineNumber();
            if (this.isInChangedLines(line, changedLines)) {
                typeChanges.push({
                    type: 'type-alias',
                    name: typeAlias.getName(),
                    change: 'modified',
                    affectedFiles: [] // Would be populated by reference analysis
                });
            }
        }
        return typeChanges;
    }
    // Helper methods
    getFunctionSignature(func) {
        const name = func.getName() || 'anonymous';
        const params = func.getParameters().map(p => {
            const paramName = p.getName();
            const paramType = p.getTypeNode()?.getText() || 'any';
            const isOptional = p.hasQuestionToken();
            const defaultValue = p.getInitializer()?.getText();
            let signature = paramName;
            if (isOptional)
                signature += '?';
            signature += `: ${paramType}`;
            if (defaultValue)
                signature += ` = ${defaultValue}`;
            return signature;
        }).join(', ');
        return `${name}(${params})`;
    }
    getReturnType(func) {
        return func.getReturnTypeNode()?.getText() || 'any';
    }
    getParameters(func) {
        return func.getParameters().map(p => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || 'any',
            optional: p.hasQuestionToken(),
            defaultValue: p.getInitializer()?.getText()
        }));
    }
    isInChangedLines(line, changedLines) {
        if (changedLines.length === 0) {
            console.log(`No changed lines, function at line ${line} not considered changed`);
            return false;
        }
        // Check if the line is within 2 lines of any changed line
        const isChanged = changedLines.some(changedLine => {
            const distance = Math.abs(line - changedLine);
            const withinRange = distance <= 2;
            console.log(`Function at line ${line}, changed line ${changedLine}, distance ${distance}, within range: ${withinRange}`);
            return withinRange;
        });
        console.log(`Function at line ${line} is in changed lines: ${isChanged}`);
        return isChanged;
    }
    async getGitDiff(filePath) {
        if (!this.gitRoot)
            return '';
        try {
            const relativePath = path.relative(this.gitRoot, filePath);
            const result = (0, child_process_1.execSync)(`git diff HEAD -- "${relativePath}"`, {
                encoding: 'utf8',
                cwd: this.gitRoot
            });
            return result;
        }
        catch (error) {
            console.log('No git diff available for file:', filePath);
            return '';
        }
    }
    parseChangedLines(diff) {
        const changedLines = new Set();
        const lines = diff.split('\n');
        let currentOldLine = 0;
        let currentNewLine = 0;
        const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
        for (const line of lines) {
            if (line.startsWith('@@')) {
                const match = line.match(hunkRegex);
                if (match) {
                    currentOldLine = parseInt(match[1], 10);
                    currentNewLine = parseInt(match[3], 10);
                }
                continue;
            }
            if (line.startsWith('+') && !line.startsWith('+++')) {
                changedLines.add(currentNewLine);
                currentNewLine += 1;
                continue;
            }
            if (line.startsWith('-') && !line.startsWith('---')) {
                // For removed lines, record the surrounding new line if possible,
                // otherwise fall back to the old line number.
                const targetLine = currentNewLine > 0 ? currentNewLine : currentOldLine;
                changedLines.add(targetLine);
                currentOldLine += 1;
                continue;
            }
            // Context line
            currentOldLine += 1;
            currentNewLine += 1;
        }
        const result = Array.from(changedLines).filter(line => Number.isFinite(line) && line > 0);
        result.sort((a, b) => a - b);
        console.log('Parsed changed lines:', result);
        return result;
    }
    async findReferences(symbolName) {
        // This would use TypeScript's findReferences API
        // For now, return empty array
        return [];
    }
    async findTestFilesInWorkspace() {
        const testFiles = [];
        const testPatterns = [
            '**/*.test.js',
            '**/*.test.ts',
            '**/*.test.jsx',
            '**/*.test.tsx',
            '**/*.spec.js',
            '**/*.spec.ts',
            '**/*.spec.jsx',
            '**/*.spec.tsx',
            '**/*.test.py',
            '**/*.spec.py',
            '**/__tests__/**/*.js',
            '**/__tests__/**/*.ts',
            '**/__tests__/**/*.py',
            '**/test/**/*.js',
            '**/test/**/*.ts',
            '**/test/**/*.py',
            '**/tests/**/*.js',
            '**/tests/**/*.ts',
            '**/tests/**/*.py'
        ];
        try {
            const vscode = require('vscode');
            for (const pattern of testPatterns) {
                const matches = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
                testFiles.push(...matches.map((uri) => uri.fsPath));
            }
        }
        catch (error) {
            console.error('Error finding test files:', error);
        }
        return [...new Set(testFiles)]; // Remove duplicates
    }
    async findSourceFilesInWorkspace() {
        const sourceFiles = [];
        const sourcePatterns = [
            '**/*.js',
            '**/*.jsx',
            '**/*.ts',
            '**/*.tsx',
            '**/*.py',
            '**/*.java',
            '**/*.cs',
            '**/*.go',
            '**/*.rs'
        ];
        try {
            const vscodeModule = require('vscode');
            for (const pattern of sourcePatterns) {
                const matches = await vscodeModule.workspace.findFiles(pattern, '**/node_modules/**');
                sourceFiles.push(...matches.map((uri) => uri.fsPath));
            }
        }
        catch (error) {
            console.error('Error finding source files:', error);
        }
        return [...new Set(sourceFiles)]; // Remove duplicates
    }
    getFileLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (['.js', '.jsx'].includes(ext))
            return 'javascript';
        if (['.ts', '.tsx'].includes(ext))
            return 'typescript';
        if (ext === '.py')
            return 'python';
        if (ext === '.java')
            return 'java';
        if (ext === '.cs')
            return 'csharp';
        if (ext === '.go')
            return 'go';
        if (ext === '.rs')
            return 'rust';
        return 'unknown';
    }
    isLanguageCompatible(sourceLang, targetLang) {
        // Same language is always compatible
        if (sourceLang === targetLang)
            return true;
        // JavaScript and TypeScript are compatible
        if ((sourceLang === 'javascript' || sourceLang === 'typescript') &&
            (targetLang === 'javascript' || targetLang === 'typescript')) {
            return true;
        }
        // Otherwise, not compatible
        return false;
    }
    normalizePath(filePath) {
        // Normalize path for comparison (handle Windows vs Unix paths)
        return path.normalize(filePath).replace(/\\/g, '/');
    }
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    /**
     * Remove comments and strings from code to avoid false matches
     * BUT preserve import/require paths (they are needed for dependency detection)
     */
    removeCommentsAndStrings(content, language) {
        let cleaned = content;
        if (language === 'javascript' || language === 'typescript') {
            // Remove single-line comments (but preserve import statements)
            cleaned = cleaned.replace(/\/\/(?!.*import|.*from|.*require).*$/gm, '');
            // Remove multi-line comments
            cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
            // Remove template literals (simplified - just remove content)
            cleaned = cleaned.replace(/`[^`]*`/g, '');
            // Remove strings, BUT preserve those in import/require statements
            // First, protect import/require paths by replacing them with placeholders
            const importPathPlaceholders = [];
            let placeholderIndex = 0;
            // Protect paths in import statements: import ... from 'path' or require('path')
            cleaned = cleaned.replace(/(?:import|from|require)\s*\(?\s*['"]([^'"]+)['"]/g, (match, path) => {
                const placeholder = `__IMPORT_PATH_${placeholderIndex}__`;
                importPathPlaceholders[placeholderIndex] = path;
                placeholderIndex++;
                return match.replace(path, placeholder);
            });
            // Now remove remaining single-quoted strings (not in imports)
            cleaned = cleaned.replace(/'[^']*'/g, '');
            // Remove remaining double-quoted strings (not in imports)
            cleaned = cleaned.replace(/"[^"]*"/g, '');
            // Restore import paths
            importPathPlaceholders.forEach((path, index) => {
                cleaned = cleaned.replace(`__IMPORT_PATH_${index}__`, path);
            });
        }
        else if (language === 'python') {
            // Remove single-line comments
            cleaned = cleaned.replace(/#.*$/gm, '');
            // Remove multi-line strings (triple quotes)
            cleaned = cleaned.replace(/"""[^"]*"""/g, '');
            cleaned = cleaned.replace(/'''[^']*'''/g, '');
            // Remove single-quoted strings (but preserve import paths)
            const importPathPlaceholders = [];
            let placeholderIndex = 0;
            // Protect paths in import statements
            cleaned = cleaned.replace(/(?:import|from)\s+['"]([^'"]+)['"]/g, (match, path) => {
                const placeholder = `__IMPORT_PATH_${placeholderIndex}__`;
                importPathPlaceholders[placeholderIndex] = path;
                placeholderIndex++;
                return match.replace(path, placeholder);
            });
            cleaned = cleaned.replace(/'[^']*'/g, '');
            cleaned = cleaned.replace(/"[^"]*"/g, '');
            // Restore import paths
            importPathPlaceholders.forEach((path, index) => {
                cleaned = cleaned.replace(`__IMPORT_PATH_${index}__`, path);
            });
        }
        return cleaned;
    }
    isFunctionUsedInFile(content, functionName, sourceLang, targetLang) {
        // Skip common module/package names that are often imported but not actual functions
        // These are likely false positives from import statement removals
        const commonModuleNames = ['jwt', 'axios', 'express', 'react', 'vue', 'lodash', 'moment', 'fs', 'path', 'http', 'https', 'util', 'crypto'];
        if (commonModuleNames.includes(functionName.toLowerCase())) {
            // Only match if it's actually an import or require, not just the word appearing anywhere
            const importPattern = new RegExp(`(?:import|require|from)\\s+.*['"]${this.escapeRegex(functionName)}['"]`, 'g');
            return importPattern.test(content);
        }
        const escapedName = this.escapeRegex(functionName);
        // Remove comments and strings from content to avoid false matches
        const cleanedContent = this.removeCommentsAndStrings(content, targetLang);
        // Language-specific patterns
        if (targetLang === 'python') {
            // Python patterns: import, from, function call
            const patterns = [
                new RegExp(`^import\\s+${escapedName}\\b`, 'm'),
                new RegExp(`^from\\s+.*import\\s+.*${escapedName}\\b`, 'm'),
                new RegExp(`\\b${escapedName}\\s*\\(`, 'g') // functionName(
            ];
            return patterns.some(pattern => pattern.test(cleanedContent));
        }
        else if (targetLang === 'javascript' || targetLang === 'typescript') {
            // JavaScript/TypeScript patterns - more precise matching
            const patterns = [
                // Named import: import { functionName } from '...' or import { other, functionName } from '...'
                new RegExp(`import\\s+\\{[^}]*\\b${escapedName}\\b[^}]*\\}\\s+from\\s+['"]`, 'g'),
                // Named import with line breaks: import { functionName,\n  other } from '...'
                new RegExp(`import\\s+\\{[^}]*\\b${escapedName}\\b[^}]*\\}\\s+from\\s+['"]`, 'gs'),
                // Default import: import functionName from '...'
                new RegExp(`import\\s+${escapedName}\\s+from\\s+['"]`, 'g'),
                // Namespace import: import * as functionName from '...'
                new RegExp(`import\\s+\\*\\s+as\\s+${escapedName}\\s+from\\s+['"]`, 'g'),
                // Require: const functionName = require('...')
                new RegExp(`(?:const|let|var)\\s+${escapedName}\\s*=\\s*require\\(['"]`, 'g'),
                // Destructuring require: const { functionName } = require('...')
                new RegExp(`(?:const|let|var)\\s+\\{[^}]*\\b${escapedName}\\b[^}]*\\}\\s*=\\s*require\\(['"]`, 'g'),
                // Function call: functionName( (but not in comments/strings)
                new RegExp(`\\b${escapedName}\\s*\\(`, 'g'),
                // Method call: obj.functionName( or obj['functionName'](
                new RegExp(`\\.${escapedName}\\s*\\(|\\['${escapedName}'\\]\\s*\\(|\\["${escapedName}"\\]\\s*\\(`, 'g')
            ];
            return patterns.some(pattern => pattern.test(cleanedContent));
        }
        else if (targetLang === 'java') {
            // Java patterns
            const patterns = [
                new RegExp(`^import\\s+.*\\b${escapedName}\\b`, 'm'),
                new RegExp(`new\\s+${escapedName}\\s*\\(`, 'g'),
                new RegExp(`\\b${escapedName}\\s*\\(`, 'g') // methodName(
            ];
            return patterns.some(pattern => pattern.test(cleanedContent));
        }
        // Fallback: generic pattern (but only if languages are compatible)
        if (this.isLanguageCompatible(sourceLang, targetLang)) {
            return new RegExp(`\\b${escapedName}\\s*\\(`, 'g').test(cleanedContent);
        }
        return false;
    }
    isClassUsedInFile(content, className, sourceLang, targetLang) {
        // Skip common module/package names
        const commonModuleNames = ['jwt', 'axios', 'express', 'react', 'vue', 'lodash', 'moment', 'fs', 'path', 'http', 'https', 'util', 'crypto'];
        if (commonModuleNames.includes(className.toLowerCase())) {
            // Only match if it's actually an import or require
            const importPattern = new RegExp(`(?:import|require|from)\\s+.*['"]${this.escapeRegex(className)}['"]`, 'g');
            return importPattern.test(content);
        }
        const escapedName = this.escapeRegex(className);
        // Remove comments and strings from content to avoid false matches
        const cleanedContent = this.removeCommentsAndStrings(content, targetLang);
        // Language-specific patterns
        if (targetLang === 'python') {
            // Python patterns: import, from, class instantiation
            const patterns = [
                new RegExp(`^import\\s+${escapedName}\\b`, 'm'),
                new RegExp(`^from\\s+.*import\\s+.*${escapedName}\\b`, 'm'),
                new RegExp(`\\b${escapedName}\\s*\\(`, 'g'),
                new RegExp(`class\\s+\\w+\\s*\\(\\s*${escapedName}\\b`, 'g') // class X(ClassName
            ];
            return patterns.some(pattern => pattern.test(cleanedContent));
        }
        else if (targetLang === 'javascript' || targetLang === 'typescript') {
            // JavaScript/TypeScript patterns - more precise
            const patterns = [
                // Named import: import { ClassName } from '...'
                new RegExp(`import\\s+\\{[^}]*\\b${escapedName}\\b[^}]*\\}\\s+from\\s+['"]`, 'g'),
                // Default import: import ClassName from '...'
                new RegExp(`import\\s+${escapedName}\\s+from\\s+['"]`, 'g'),
                // Require: const ClassName = require('...')
                new RegExp(`(?:const|let|var)\\s+${escapedName}\\s*=\\s*require\\(['"]`, 'g'),
                // Class instantiation: new ClassName(
                new RegExp(`new\\s+${escapedName}\\s*\\(`, 'g'),
                // Class extension: extends ClassName
                new RegExp(`extends\\s+${escapedName}\\b`, 'g'),
                // Interface implementation: implements ... ClassName
                new RegExp(`implements\\s+.*\\b${escapedName}\\b`, 'g')
            ];
            return patterns.some(pattern => pattern.test(cleanedContent));
        }
        else if (targetLang === 'java') {
            // Java patterns
            const patterns = [
                new RegExp(`^import\\s+.*\\b${escapedName}\\b`, 'm'),
                new RegExp(`new\\s+${escapedName}\\s*\\(`, 'g'),
                new RegExp(`extends\\s+${escapedName}\\b`, 'g'),
                new RegExp(`implements\\s+.*\\b${escapedName}\\b`, 'g') // implements ... ClassName
            ];
            return patterns.some(pattern => pattern.test(cleanedContent));
        }
        // Fallback: generic pattern (but only if languages are compatible)
        if (this.isLanguageCompatible(sourceLang, targetLang)) {
            return new RegExp(`\\b${escapedName}\\b`, 'g').test(cleanedContent);
        }
        return false;
    }
    isTestFile(filePath) {
        const testPatterns = [
            /\.test\./,
            /\.spec\./,
            /\/__tests__\//,
            /\/test\//,
            /\/tests\//
        ];
        return testPatterns.some(pattern => pattern.test(filePath));
    }
    async findTestFilesThatImport() {
        // This would find test files that import the current module
        return [];
    }
    calculateConfidence(changedFunctions, changedClasses, affectedTests) {
        if (changedFunctions.length === 0 && changedClasses.length === 0) {
            return 0;
        }
        if (affectedTests.length === 0) {
            return 0.3;
        }
        return Math.min(0.9, 0.5 + (affectedTests.length * 0.1));
    }
    estimateTestTime(affectedTests) {
        return affectedTests.length * 2; // 2 seconds per test file
    }
    calculateCoverageImpact(changedFunctions, changedClasses) {
        const totalChanges = changedFunctions.length + changedClasses.length;
        return Math.min(1.0, totalChanges * 0.1);
    }
    calculateRiskLevel(breakingChanges, downstreamComponents) {
        if (breakingChanges.length > 0)
            return 'high';
        if (downstreamComponents.length > 5)
            return 'medium';
        return 'low';
    }
    /**
     * Analyze Python files using regex-based parsing (since ts-morph doesn't support Python)
     */
    async analyzePythonFile(filePath) {
        try {
            console.log(`Analyzing Python file: ${filePath}`);
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            // Get changed lines from Git diff (same as TypeScript analysis)
            const gitDiff = await this.getGitDiff(filePath);
            const changedLines = this.parseChangedLines(gitDiff);
            console.log(`Changed lines for Python file: ${changedLines.length}`);
            const changedFunctions = [];
            const changedClasses = [];
            // Parse Python functions and classes using regex
            const functionRegex = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*[\w\[\],\s\.]+)?:/;
            const classRegex = /^(\s*)class\s+(\w+)\s*(\([^)]*\))?:/;
            const methodRegex = /^(\s+)def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*[\w\[\],\s\.]+)?:/;
            let currentClass = null;
            const allClasses = [];
            // First pass: Find all classes
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const classMatch = line.match(classRegex);
                if (classMatch) {
                    const indent = classMatch[1].length;
                    allClasses.push({
                        name: classMatch[2],
                        startLine: i + 1,
                        indent: indent
                    });
                }
            }
            // Second pass: Find functions and methods
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineNum = i + 1;
                // Check if we're entering a class
                const classMatch = line.match(classRegex);
                if (classMatch) {
                    currentClass = {
                        name: classMatch[2],
                        startLine: lineNum,
                        indent: classMatch[1].length
                    };
                }
                // Check if we're leaving a class (next line has less or equal indent, or is empty)
                if (currentClass && i + 1 < lines.length) {
                    const nextLine = lines[i + 1];
                    if (nextLine.trim() && nextLine.length > 0) {
                        const nextIndent = nextLine.match(/^(\s*)/)?.[1].length || 0;
                        if (nextIndent <= currentClass.indent && nextLine.trim()) {
                            currentClass = null;
                        }
                    }
                }
                // Check for function or method
                const funcMatch = line.match(functionRegex);
                const methodMatch = line.match(methodRegex);
                if (funcMatch || methodMatch) {
                    const match = funcMatch || methodMatch;
                    if (!match)
                        continue;
                    const funcName = match[2];
                    const params = match[3] || '';
                    const returnType = match[4] ? match[4].replace('->', '').trim() : 'Any';
                    const indent = (match[1] || '').length;
                    // Find function end (next line with same or less indent that's not empty)
                    let funcEndLine = lineNum;
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j];
                        if (nextLine.trim()) {
                            const nextIndent = nextLine.match(/^(\s*)/)?.[1].length || 0;
                            if (nextIndent <= indent) {
                                funcEndLine = j; // End at previous line
                                break;
                            }
                        }
                        funcEndLine = j + 1; // Update end line
                    }
                    // Check if function/method is in changed lines
                    const isInChangedLines = changedLines.some((changedLine) => changedLine >= lineNum && changedLine <= funcEndLine);
                    if (isInChangedLines) {
                        // Parse parameters
                        const parameters = [];
                        if (params.trim()) {
                            const paramList = params.split(',').map(p => p.trim());
                            for (const param of paramList) {
                                if (param && param !== 'self') {
                                    const paramMatch = param.match(/^(\w+)(?::\s*([^=]+))?(?:\s*=\s*(.+))?$/);
                                    if (paramMatch) {
                                        parameters.push({
                                            name: paramMatch[1],
                                            type: paramMatch[2] || 'Any',
                                            optional: paramMatch[3] !== undefined,
                                            defaultValue: paramMatch[3]
                                        });
                                    }
                                }
                            }
                        }
                        const changedFunction = {
                            name: currentClass ? `${currentClass.name}.${funcName}` : funcName,
                            line: lineNum,
                            signature: `${funcName}(${params})`,
                            returnType: returnType,
                            parameters: parameters,
                            isExported: indent === 0,
                            isAsync: false // Would need to check for 'async def'
                        };
                        changedFunctions.push(changedFunction);
                        console.log(`Python ${currentClass ? 'method' : 'function'} ${changedFunction.name} detected as changed (lines ${lineNum}-${funcEndLine})`);
                    }
                }
            }
            // Find changed classes
            for (const cls of allClasses) {
                // Check if class declaration or any method is in changed lines
                const isClassChanged = changedLines.some((changedLine) => changedLine === cls.startLine ||
                    changedFunctions.some(func => func.name.startsWith(`${cls.name}.`)));
                if (isClassChanged) {
                    // Find all methods in this class
                    const classMethods = changedFunctions.filter(f => f.name.startsWith(`${cls.name}.`));
                    const changedClass = {
                        name: cls.name,
                        line: cls.startLine,
                        methods: classMethods.map(m => ({
                            name: m.name.split('.').pop() || m.name,
                            line: m.line,
                            signature: m.signature,
                            returnType: m.returnType,
                            parameters: m.parameters,
                            isExported: m.isExported,
                            isAsync: m.isAsync
                        })),
                        properties: [],
                        isExported: cls.indent === 0,
                        extends: undefined,
                        implements: []
                    };
                    changedClasses.push(changedClass);
                }
            }
            console.log(`Found ${changedFunctions.length} changed Python functions/methods`);
            console.log(`Found ${changedClasses.length} changed Python classes`);
            // Find affected tests and downstream components
            const affectedTests = await this.findAffectedTestsTypeAware(changedFunctions, changedClasses, filePath);
            const downstreamComponents = await this.findDownstreamComponentsTypeAware(changedFunctions, changedClasses, filePath);
            const breakingChanges = await this.detectBreakingChanges(changedFunctions, changedClasses);
            const confidence = this.calculateConfidence(changedFunctions, changedClasses, affectedTests);
            const estimatedTestTime = this.estimateTestTime(affectedTests);
            const coverageImpact = this.calculateCoverageImpact(changedFunctions, changedClasses);
            const riskLevel = this.calculateRiskLevel(breakingChanges, downstreamComponents);
            return {
                filePath,
                changedFunctions,
                changedClasses,
                affectedTests,
                downstreamComponents,
                confidence,
                estimatedTestTime,
                coverageImpact,
                riskLevel,
                breakingChanges,
                typeChanges: []
            };
        }
        catch (error) {
            console.error('Error analyzing Python file:', error);
            return this.getEmptyResult(filePath);
        }
    }
    getEmptyResult(filePath) {
        return {
            filePath,
            changedFunctions: [],
            changedClasses: [],
            affectedTests: [],
            downstreamComponents: [],
            confidence: 0,
            estimatedTestTime: 0,
            coverageImpact: 0,
            riskLevel: 'low',
            breakingChanges: [],
            typeChanges: []
        };
    }
}
exports.ProfessionalImpactAnalyzer = ProfessionalImpactAnalyzer;
//# sourceMappingURL=ProfessionalImpactAnalyzer.js.map