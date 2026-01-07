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
exports.TestFinder = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
const Logger_1 = require("../utils/Logger");
class TestFinder {
    constructor() {
        this.testPatterns = [
            /\.test\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i,
            /\.spec\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i,
            /test_.*\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i,
            /.*_test\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i
        ];
        this.testDirectories = [
            'test', 'tests', '__tests__', 'spec', 'specs',
            'test-src', 'src/test', 'src/tests'
        ];
    }
    /**
     * Find affected tests using symbol-aware detection
     * @param sourceFilePath Path to the source file that changed
     * @param codeAnalysis Analysis result for the source file
     * @param changedSymbols Optional list of specific changed symbols (functions/classes)
     * @returns Array of test file paths with match metadata
     */
    async findAffectedTests(sourceFilePath, codeAnalysis, changedSymbols) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }
        const workspacePath = workspaceFolder.uri.fsPath;
        const allTestFiles = await this.findAllTestFiles(workspacePath);
        // Use symbol-aware filtering when we have changed symbols
        if (changedSymbols && changedSymbols.length > 0) {
            return this.filterTestsBySymbols(allTestFiles, sourceFilePath, changedSymbols);
        }
        // Fallback: filter by file imports and code references
        return this.filterTestsByContent(allTestFiles, sourceFilePath, codeAnalysis);
    }
    /**
     * Find all test files in the workspace
     */
    async findAllTestFiles(workspacePath) {
        const testFiles = [];
        try {
            await this.walkDirectory(workspacePath, (filePath) => {
                if (this.isTestFile(filePath)) {
                    testFiles.push(filePath);
                }
            });
        }
        catch (error) {
            console.error('Error finding test files:', error);
        }
        return testFiles;
    }
    /**
     * Two-stage symbol-aware filtering:
     * Stage 1: Does test file import the source file?
     * Stage 2: Does test file import/use the changed symbols?
     */
    filterTestsBySymbols(testFiles, sourceFilePath, changedSymbols) {
        const matchedTests = [];
        for (const testFile of testFiles) {
            try {
                const content = fs.readFileSync(testFile, 'utf8');
                const ext = path.extname(testFile).toLowerCase();
                // Stage 1: Check if test file imports the source file
                if (!this.testFileImportsSource(content, testFile, sourceFilePath)) {
                    continue; // Skip if doesn't import source
                }
                // Stage 2: Check if test file uses the changed symbols
                let usesSymbols = false;
                let matchedSymbols = [];
                if (ext === '.ts' || ext === '.tsx') {
                    // AST-based analysis for TypeScript
                    const result = this.testFileUsesSymbolsAST(testFile, content, changedSymbols, sourceFilePath);
                    usesSymbols = result.uses;
                    matchedSymbols = result.matchedSymbols;
                }
                else {
                    // Improved regex-based analysis for JavaScript (ignores strings/comments)
                    const result = this.testFileUsesSymbolsRegex(content, changedSymbols);
                    usesSymbols = result.uses;
                    matchedSymbols = result.matchedSymbols;
                }
                if (usesSymbols) {
                    matchedTests.push(testFile);
                    (0, Logger_1.debugLog)(`[TestFinder] ✅ Symbol-aware match: ${path.basename(testFile)} (symbols: ${matchedSymbols.join(', ')})`);
                }
                else {
                    (0, Logger_1.debugLog)(`[TestFinder] ⚠️ Test imports source but doesn't use changed symbols: ${path.basename(testFile)}`);
                }
            }
            catch (error) {
                console.error(`[TestFinder] Error analyzing test file ${testFile}:`, error);
            }
        }
        return matchedTests;
    }
    /**
     * Fallback filtering when no specific symbols provided
     */
    filterTestsByContent(testFiles, sourceFilePath, codeAnalysis) {
        const matchedTests = [];
        for (const testFile of testFiles) {
            try {
                const content = fs.readFileSync(testFile, 'utf8');
                // Check if test file imports the source file
                if (this.testFileImportsSource(content, testFile, sourceFilePath)) {
                    matchedTests.push(testFile);
                    continue;
                }
                // Fallback: check if test file references functions/classes (heuristic)
                // This is less accurate but better than nothing
                if (this.testFileReferencesCodeHeuristic(content, codeAnalysis)) {
                    matchedTests.push(testFile);
                    (0, Logger_1.debugLog)(`[TestFinder] ⚠️ Heuristic match (no symbol list): ${path.basename(testFile)}`);
                }
            }
            catch (error) {
                console.error(`[TestFinder] Error filtering test file ${testFile}:`, error);
            }
        }
        return matchedTests;
    }
    /**
     * AST-based symbol usage detection for TypeScript files
     */
    testFileUsesSymbolsAST(testFilePath, content, symbolNames, sourceFilePath) {
        try {
            const sourceFile = ts.createSourceFile(testFilePath, content, ts.ScriptTarget.Latest, true);
            const matchedSymbols = new Set();
            const importedSymbols = new Set();
            // Collect imported symbols from the source file
            const visit = (node) => {
                // Check import declarations
                if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                    const importPath = node.moduleSpecifier.text;
                    // Check if this import is from the source file
                    if (this.isImportFromSource(importPath, testFilePath, sourceFilePath)) {
                        // Collect named imports
                        if (node.importClause) {
                            if (node.importClause.namedBindings) {
                                if (ts.isNamedImports(node.importClause.namedBindings)) {
                                    for (const element of node.importClause.namedBindings.elements) {
                                        const importedName = element.name ? element.name.text : element.propertyName?.text;
                                        if (importedName) {
                                            importedSymbols.add(importedName);
                                        }
                                    }
                                }
                                else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                                    // Namespace import: import * as ns from ...
                                    const namespaceName = node.importClause.namedBindings.name.text;
                                    importedSymbols.add(namespaceName);
                                }
                            }
                            // Default import
                            if (node.importClause.name) {
                                importedSymbols.add(node.importClause.name.text);
                            }
                        }
                    }
                }
                // Check identifier usage (excluding import specifiers and definitions)
                // TypeScript AST automatically excludes strings/comments, so this is safe
                if (ts.isIdentifier(node) && !this.isInImportSpecifier(node) && !this.isSymbolDefinition(node)) {
                    const identifierText = node.text;
                    // Check if this identifier matches any of our symbols
                    if (symbolNames.includes(identifierText)) {
                        // Exclude type annotations (but include value usage)
                        const parent = node.parent;
                        if (parent && !ts.isTypeReferenceNode(parent) && !ts.isTypeQueryNode(parent)) {
                            matchedSymbols.add(identifierText);
                        }
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(sourceFile);
            // Check if any imported symbols match our changed symbols
            for (const importedSymbol of importedSymbols) {
                if (symbolNames.includes(importedSymbol)) {
                    matchedSymbols.add(importedSymbol);
                }
            }
            // Also check namespace usage (e.g., ns.symbolName)
            const namespaceUsage = this.checkNamespaceUsageAST(sourceFile, symbolNames, importedSymbols);
            namespaceUsage.forEach(s => matchedSymbols.add(s));
            return {
                uses: matchedSymbols.size > 0,
                matchedSymbols: Array.from(matchedSymbols)
            };
        }
        catch (error) {
            console.error(`[TestFinder] Error parsing TypeScript AST for ${testFilePath}:`, error);
            // Fallback to regex if AST parsing fails
            return this.testFileUsesSymbolsRegex(content, symbolNames);
        }
    }
    /**
     * Check for namespace usage (e.g., ns.symbolName)
     */
    checkNamespaceUsageAST(sourceFile, symbolNames, importedNamespaces) {
        const matchedSymbols = new Set();
        const visit = (node) => {
            // Check property access: namespace.symbol
            if (ts.isPropertyAccessExpression(node)) {
                const expression = node.expression;
                if (ts.isIdentifier(expression)) {
                    const namespaceName = expression.text;
                    if (importedNamespaces.has(namespaceName)) {
                        const propertyName = node.name.text;
                        if (symbolNames.includes(propertyName)) {
                            matchedSymbols.add(propertyName);
                        }
                    }
                }
            }
            // Check element access: namespace[symbol]
            if (ts.isElementAccessExpression(node)) {
                const expression = node.expression;
                if (ts.isIdentifier(expression)) {
                    const namespaceName = expression.text;
                    if (importedNamespaces.has(namespaceName)) {
                        const argument = node.argumentExpression;
                        if (argument && ts.isStringLiteral(argument)) {
                            const symbolName = argument.text;
                            if (symbolNames.includes(symbolName)) {
                                matchedSymbols.add(symbolName);
                            }
                        }
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return matchedSymbols;
    }
    /**
     * Check if identifier is in an import specifier (should be excluded)
     */
    isInImportSpecifier(node) {
        let parent = node.parent;
        while (parent) {
            if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isImportDeclaration(parent)) {
                return true;
            }
            parent = parent.parent;
        }
        return false;
    }
    /**
     * Check if identifier is a symbol definition (function/class declaration)
     */
    isSymbolDefinition(node) {
        const parent = node.parent;
        return !!((parent && ts.isFunctionDeclaration(parent) && parent.name === node) ||
            (parent && ts.isClassDeclaration(parent) && parent.name === node) ||
            (parent && ts.isMethodDeclaration(parent) && parent.name === node) ||
            (parent && ts.isVariableDeclaration(parent) && parent.name === node) ||
            (parent && ts.isPropertyDeclaration(parent) && parent.name === node) ||
            (parent && ts.isParameter(parent) && parent.name === node));
    }
    /**
     * Improved regex-based symbol usage detection for JavaScript files
     * Attempts to ignore strings and comments
     */
    testFileUsesSymbolsRegex(content, symbolNames) {
        const matchedSymbols = new Set();
        // Remove strings and comments to reduce false positives
        const cleanedContent = this.removeStringsAndComments(content);
        for (const symbolName of symbolNames) {
            const escaped = this.escapeRegex(symbolName);
            // Check for named imports: import { symbolName } from ...
            const namedImportPattern = new RegExp(`import\\s+\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s+from`, 'g');
            if (namedImportPattern.test(content)) {
                matchedSymbols.add(symbolName);
                continue;
            }
            // Check for default import: import symbolName from ...
            const defaultImportPattern = new RegExp(`import\\s+${escaped}\\s+from`, 'g');
            if (defaultImportPattern.test(content)) {
                matchedSymbols.add(symbolName);
                continue;
            }
            // Check for namespace import: import * as symbolName from ...
            const namespaceImportPattern = new RegExp(`import\\s+\\*\\s+as\\s+${escaped}\\s+from`, 'g');
            if (namespaceImportPattern.test(content)) {
                matchedSymbols.add(symbolName);
                continue;
            }
            // Check for usage in cleaned content (ignoring strings/comments): symbolName( or symbolName. or symbolName[
            const usagePattern = new RegExp(`\\b${escaped}\\s*[\\(\.\\[]`, 'g');
            if (usagePattern.test(cleanedContent)) {
                matchedSymbols.add(symbolName);
            }
        }
        return {
            uses: matchedSymbols.size > 0,
            matchedSymbols: Array.from(matchedSymbols)
        };
    }
    /**
     * Remove strings and comments from content (simple lexer)
     * This helps reduce false positives in regex matching
     */
    removeStringsAndComments(content) {
        let result = content;
        // Remove single-line comments
        result = result.replace(/\/\/.*$/gm, '');
        // Remove multi-line comments
        result = result.replace(/\/\*[\s\S]*?\*\//g, '');
        // Remove single-quoted strings
        result = result.replace(/'([^'\\]|\\.)*'/g, '');
        // Remove double-quoted strings
        result = result.replace(/"([^"\\]|\\.)*"/g, '');
        // Remove template literals (simple - doesn't handle nested ${})
        result = result.replace(/`([^`\\]|\\.)*`/g, '');
        return result;
    }
    /**
     * Check if test file imports the source file
     * Reuses logic similar to DependencyAnalyzer.fileImportsSource
     */
    testFileImportsSource(testContent, testFilePath, sourceFilePath) {
        const testDir = path.dirname(testFilePath);
        const sourceDir = path.dirname(sourceFilePath);
        const sourceBaseName = path.basename(sourceFilePath, path.extname(sourceFilePath));
        const sourceFullName = path.basename(sourceFilePath);
        // Calculate relative path from test to source
        let relativePath = path.relative(testDir, sourceFilePath).replace(/\\/g, '/');
        const relativePathNoExt = relativePath.replace(/\.(ts|tsx|js|jsx)$/, '');
        const relativeDirPath = path.relative(testDir, sourceDir).replace(/\\/g, '/');
        // Build import patterns to match
        const importPatterns = [
            // Direct relative path imports
            new RegExp(`from\\s+['"]${this.escapeRegex(relativePathNoExt)}['"]`, 'i'),
            new RegExp(`from\\s+['"]${this.escapeRegex(relativePath)}['"]`, 'i'),
            new RegExp(`require\\(['"]${this.escapeRegex(relativePathNoExt)}['"]\\)`, 'i'),
            new RegExp(`require\\(['"]${this.escapeRegex(relativePath)}['"]\\)`, 'i'),
            // Relative directory imports
            new RegExp(`from\\s+['"]${this.escapeRegex(relativeDirPath)}['"]`, 'i'),
            // Base name imports
            new RegExp(`from\\s+['"]${this.escapeRegex(sourceBaseName)}['"]`, 'i'),
            new RegExp(`require\\(['"]${this.escapeRegex(sourceBaseName)}['"]\\)`, 'i'),
        ];
        // Check for package imports (monorepo support)
        const sourcePathSegments = sourceFilePath.replace(/\\/g, '/').split('/');
        const packageNameMatch = sourcePathSegments.find(seg => seg.startsWith('@') || (seg.includes('-') && !seg.includes('.')));
        if (packageNameMatch) {
            importPatterns.push(new RegExp(`from\\s+['"]${this.escapeRegex(packageNameMatch)}['"]`, 'i'));
        }
        return importPatterns.some(pattern => pattern.test(testContent));
    }
    /**
     * Check if import path matches the source file
     */
    isImportFromSource(importPath, testFilePath, sourceFilePath) {
        // Handle relative imports
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
            const testDir = path.dirname(testFilePath);
            const resolvedPath = path.resolve(testDir, importPath);
            const normalizedResolved = path.normalize(resolvedPath).replace(/\\/g, '/');
            const normalizedSource = path.normalize(sourceFilePath).replace(/\\/g, '/');
            // Try with and without extensions
            return normalizedResolved === normalizedSource ||
                normalizedResolved === normalizedSource.replace(/\.(ts|tsx|js|jsx)$/, '');
        }
        // Handle package imports (monorepo)
        const sourcePathSegments = sourceFilePath.replace(/\\/g, '/').split('/');
        const packageName = sourcePathSegments.find(seg => seg.startsWith('@') || (seg.includes('-') && !seg.includes('.')));
        if (packageName && importPath.includes(packageName)) {
            return true;
        }
        return false;
    }
    /**
     * Heuristic fallback: check if test file references code (less accurate)
     * Only used when no specific symbols provided
     */
    testFileReferencesCodeHeuristic(testContent, codeAnalysis) {
        // Use cleaned content to avoid false positives from strings/comments
        const cleanedContent = this.removeStringsAndComments(testContent);
        // Check for function/class references (word boundaries to avoid partial matches)
        for (const funcName of codeAnalysis.functions) {
            const pattern = new RegExp(`\\b${this.escapeRegex(funcName)}\\s*[\\(\.\\[]`, 'g');
            if (pattern.test(cleanedContent)) {
                return true;
            }
        }
        for (const className of codeAnalysis.classes) {
            const pattern = new RegExp(`\\b${this.escapeRegex(className)}\\s*[\\(\.\\[]`, 'g');
            if (pattern.test(cleanedContent)) {
                return true;
            }
        }
        return false;
    }
    async walkDirectory(dirPath, callback) {
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                    if (!this.shouldSkipDirectory(item)) {
                        await this.walkDirectory(itemPath, callback);
                    }
                }
                else if (stat.isFile()) {
                    callback(itemPath);
                }
            }
        }
        catch (error) {
            console.error(`Error walking directory ${dirPath}:`, error);
        }
    }
    isTestFile(filePath) {
        const fileName = path.basename(filePath);
        return this.testPatterns.some(pattern => pattern.test(fileName));
    }
    shouldSkipDirectory(dirName) {
        const skipDirs = [
            'node_modules', '.git', '.vscode', 'dist', 'build',
            'coverage', '.nyc_output', 'target', 'bin', 'obj',
            '.next', '.nuxt', 'vendor', '__pycache__'
        ];
        return skipDirs.includes(dirName) || dirName.startsWith('.');
    }
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
exports.TestFinder = TestFinder;
//# sourceMappingURL=TestFinder.js.map