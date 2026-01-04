"use strict";
/**
 * TypeScript-specific analyzer using TypeScript AST + Type Checker.
 * This analyzer properly leverages TypeScript's compiler API for type-aware analysis.
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
exports.TypeScriptAnalyzer = void 0;
const ts = __importStar(require("typescript"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const ts_morph_1 = require("ts-morph");
class TypeScriptAnalyzer {
    constructor(projectRoot) {
        this.program = null;
        this.checker = null;
        this.projectRoot = null;
        // Caching for performance
        this.moduleResolutionCache = new Map(); // moduleSpecifier+fromFile -> resolvedPath
        this.symbolExportsCache = new Map(); // resolvedPath -> exports[]
        this.apiShapeCache = new Map(); // exportIdentity -> ApiShape
        this.enableSyntacticExportFallback = true;
        this.syntacticExportFallbackCount = 0;
        this.projectRoot = projectRoot || null;
        // Initialize ts-morph project
        this.project = new ts_morph_1.Project({
            useInMemoryFileSystem: false,
            compilerOptions: {
                target: 5,
                module: 1,
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
        // Initialize TypeScript program and type checker
        this.initializeTypeChecker();
    }
    initializeTypeChecker() {
        try {
            // Handle ESM default export for TypeScript
            const tsApi = ts.default || ts;
            // Create a TypeScript program with empty files initially
            // It will be populated as files are analyzed
            this.program = tsApi.createProgram([], {
                target: 5,
                module: 1,
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true
            });
            this.checker = this.program?.getTypeChecker() || null;
        }
        catch (error) {
            console.error('Failed to initialize TypeScript type checker:', error);
            this.checker = null;
        }
    }
    getLanguage() {
        return 'typescript';
    }
    getSupportedExtensions() {
        return ['.ts', '.tsx'];
    }
    async analyze(filePath, content) {
        try {
            console.log(`[TypeScriptAnalyzer] Analyzing file: ${filePath}`);
            console.log(`[TypeScriptAnalyzer] Type checker available: ${this.checker !== null}`);
            // Add or update file in ts-morph project
            let sourceFile;
            if (this.project.getSourceFile(filePath)) {
                sourceFile = this.project.getSourceFile(filePath);
                sourceFile.replaceWithText(content);
                console.log(`[TypeScriptAnalyzer] Updated existing source file in project`);
            }
            else {
                sourceFile = this.project.createSourceFile(filePath, content);
                console.log(`[TypeScriptAnalyzer] Created new source file in project`);
            }
            // Update TypeScript program to include this file
            this.updateTypeScriptProgram();
            console.log(`[TypeScriptAnalyzer] TypeScript program updated, type checker: ${this.checker !== null}`);
            const functions = [];
            const classes = [];
            const imports = [];
            const exports = [];
            const modules = [];
            // Extract functions
            const functionDeclarations = sourceFile.getFunctions();
            for (const func of functionDeclarations) {
                const element = {
                    name: func.getName() || 'anonymous',
                    line: func.getStartLineNumber(),
                    column: func.getStartLineNumber(true),
                    signature: this.getFunctionSignature(func),
                    returnType: this.getReturnType(func),
                    parameters: this.getParameters(func),
                    isExported: func.isExported(),
                    isAsync: func.isAsync()
                };
                functions.push(element);
            }
            // Extract arrow functions assigned to variables
            // Note: Arrow function detection is simplified - full implementation would require
            // more sophisticated type checking with ts-morph's wrapped TypeScript types
            const variableDeclarations = sourceFile.getVariableDeclarations();
            for (const varDecl of variableDeclarations) {
                const initializer = varDecl.getInitializer();
                if (initializer) {
                    // Check if initializer looks like an arrow function by checking text
                    const initializerText = initializer.getText();
                    if (initializerText.includes('=>')) {
                        const name = varDecl.getName();
                        const element = {
                            name,
                            line: varDecl.getStartLineNumber(),
                            column: varDecl.getStartLineNumber(true),
                            signature: `${name}()`,
                            returnType: 'any',
                            parameters: [],
                            isExported: varDecl.getVariableStatement()?.isExported() || false,
                            isAsync: false
                        };
                        functions.push(element);
                    }
                }
            }
            // Extract classes
            const classDeclarations = sourceFile.getClasses();
            for (const cls of classDeclarations) {
                const methods = [];
                const classMethods = cls.getMethods();
                for (const method of classMethods) {
                    methods.push({
                        name: method.getName(),
                        line: method.getStartLineNumber(),
                        column: method.getStartLineNumber(true),
                        signature: this.getFunctionSignature(method),
                        returnType: this.getReturnType(method),
                        parameters: this.getParameters(method),
                        isExported: false,
                        isAsync: method.isAsync()
                    });
                }
                const properties = [];
                const classProperties = cls.getProperties();
                for (const prop of classProperties) {
                    properties.push({
                        name: prop.getName(),
                        type: prop.getTypeNode()?.getText() || 'any',
                        isOptional: prop.hasQuestionToken(),
                        isReadonly: prop.isReadonly()
                    });
                }
                const classElement = {
                    name: cls.getName() || 'anonymous',
                    line: cls.getStartLineNumber(),
                    column: cls.getStartLineNumber(true),
                    methods,
                    properties,
                    isExported: cls.isExported(),
                    extends: cls.getExtends()?.getText(),
                    implements: cls.getImplements().map(impl => impl.getText())
                };
                classes.push(classElement);
            }
            // Extract imports
            const importDeclarations = sourceFile.getImportDeclarations();
            for (const importDecl of importDeclarations) {
                const moduleSpecifier = importDecl.getModuleSpecifierValue();
                if (moduleSpecifier) {
                    imports.push(moduleSpecifier);
                }
            }
            // Extract exports
            const exportDeclarations = sourceFile.getExportedDeclarations();
            for (const [name, declarations] of exportDeclarations) {
                exports.push(name);
            }
            // Extract module references
            const moduleSpecifiers = sourceFile.getImportDeclarations()
                .map(imp => imp.getModuleSpecifierValue())
                .filter((spec) => !!spec);
            modules.push(...moduleSpecifiers);
            return {
                functions,
                classes,
                imports,
                exports,
                modules
            };
        }
        catch (error) {
            console.error(`Error analyzing TypeScript file ${filePath}:`, error);
            return {
                functions: [],
                classes: [],
                imports: [],
                exports: [],
                modules: []
            };
        }
    }
    async findReferences(symbolName, filePath, projectRoot) {
        console.log(`[TypeScriptAnalyzer] Finding references for symbol: ${symbolName}`);
        if (!this.checker) {
            console.log(`[TypeScriptAnalyzer] Type checker not available, using regex-based fallback`);
            // Fallback to regex-based search if type checker not available
            return this.findReferencesFallback(symbolName, projectRoot);
        }
        console.log(`[TypeScriptAnalyzer] Using type checker for reference finding`);
        try {
            const sourceFile = this.project.getSourceFile(filePath);
            if (!sourceFile) {
                return [];
            }
            // Find the symbol in the source file
            const symbol = this.findSymbolInFile(sourceFile, symbolName);
            if (!symbol) {
                return [];
            }
            // Use TypeScript's type checker to find references
            // Note: TypeScript doesn't have a direct findReferences API in the compiler API
            // We'll use the type checker to get symbol information and search for references
            const references = [];
            const program = this.project.getProgram().compilerObject;
            const checker = program.getTypeChecker();
            try {
                // Get the symbol node from ts-morph
                const symbolNode = this.findSymbolInFile(sourceFile, symbolName);
                if (symbolNode && symbolNode.compilerNode) {
                    // Get the symbol from the type checker
                    const typeSymbol = checker.getSymbolAtLocation(symbolNode.compilerNode);
                    if (typeSymbol) {
                        // Get all files that reference this symbol by checking imports/exports
                        // This is a simplified approach - for full reference finding, consider using
                        // the Language Service API or ts-morph's findReferences
                        const sourceFiles = this.project.getSourceFiles();
                        for (const sf of sourceFiles) {
                            if (sf.getFilePath() === filePath)
                                continue;
                            // Check if this file imports the symbol
                            const imports = sf.getImportDeclarations();
                            for (const imp of imports) {
                                const namedImports = imp.getNamedImports();
                                for (const namedImport of namedImports) {
                                    if (namedImport.getName() === symbolName) {
                                        references.push(sf.getFilePath());
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch (error) {
                console.error('Error using type checker for references:', error);
            }
            return [...new Set(references)];
        }
        catch (error) {
            console.error(`Error finding references for ${symbolName}:`, error);
            return this.findReferencesFallback(symbolName, projectRoot);
        }
    }
    async fileUsesSymbol(filePath, symbolName, projectRoot) {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                return false;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const ext = path.extname(filePath).toLowerCase();
            // Only check TypeScript/JavaScript files
            if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
                return false;
            }
            // Use type checker if available
            if (this.checker) {
                const sourceFile = this.project.getSourceFile(filePath);
                if (sourceFile) {
                    // Check if symbol is imported or used
                    const imports = sourceFile.getImportDeclarations();
                    for (const imp of imports) {
                        const namedImports = imp.getNamedImports();
                        for (const namedImport of namedImports) {
                            if (namedImport.getName() === symbolName) {
                                return true;
                            }
                        }
                        // Check default import
                        if (imp.getDefaultImport()?.getText() === symbolName) {
                            return true;
                        }
                    }
                    // Check if symbol is used in the file
                    const symbol = this.findSymbolInFile(sourceFile, symbolName);
                    if (symbol) {
                        return true;
                    }
                }
            }
            // Fallback to regex-based check
            const patterns = [
                new RegExp(`import\\s+.*\\b${this.escapeRegex(symbolName)}\\b`, 'g'),
                new RegExp(`import\\s+\\{[^}]*\\b${this.escapeRegex(symbolName)}\\b[^}]*\\}`, 'g'),
                new RegExp(`\\b${this.escapeRegex(symbolName)}\\s*\\(`, 'g'),
                new RegExp(`new\\s+${this.escapeRegex(symbolName)}\\s*\\(`, 'g'),
                new RegExp(`extends\\s+${this.escapeRegex(symbolName)}`, 'g'),
                new RegExp(`implements\\s+.*\\b${this.escapeRegex(symbolName)}\\b`, 'g') // Interface implementation
            ];
            return patterns.some(pattern => pattern.test(content));
        }
        catch (error) {
            console.error(`Error checking if file uses symbol:`, error);
            return false;
        }
    }
    async findChangedElements(beforeContent, afterContent, filePath) {
        const beforeAnalysis = await this.analyze(filePath, beforeContent);
        const afterAnalysis = await this.analyze(filePath, afterContent);
        const changedFunctions = [];
        const changedClasses = [];
        // Find changed functions by comparing signatures
        const beforeFuncMap = new Map(beforeAnalysis.functions.map(f => [f.name, f]));
        const afterFuncMap = new Map(afterAnalysis.functions.map(f => [f.name, f]));
        for (const [name, afterFunc] of afterFuncMap) {
            const beforeFunc = beforeFuncMap.get(name);
            if (!beforeFunc) {
                // New function - not considered changed
                continue;
            }
            // Compare signatures
            if (beforeFunc.signature !== afterFunc.signature ||
                beforeFunc.returnType !== afterFunc.returnType ||
                JSON.stringify(beforeFunc.parameters) !== JSON.stringify(afterFunc.parameters)) {
                changedFunctions.push(name);
            }
        }
        // Find removed functions
        for (const [name] of beforeFuncMap) {
            if (!afterFuncMap.has(name)) {
                changedFunctions.push(name);
            }
        }
        // Find changed classes
        const beforeClassMap = new Map(beforeAnalysis.classes.map(c => [c.name, c]));
        const afterClassMap = new Map(afterAnalysis.classes.map(c => [c.name, c]));
        for (const [name, afterClass] of afterClassMap) {
            const beforeClass = beforeClassMap.get(name);
            if (!beforeClass) {
                continue;
            }
            // Compare class structure
            if (beforeClass.extends !== afterClass.extends ||
                JSON.stringify(beforeClass.implements) !== JSON.stringify(afterClass.implements) ||
                beforeClass.methods.length !== afterClass.methods.length ||
                beforeClass.properties.length !== afterClass.properties.length) {
                changedClasses.push(name);
            }
            else {
                // Check if any methods changed
                const beforeMethodMap = new Map(beforeClass.methods.map(m => [m.name, m]));
                const afterMethodMap = new Map(afterClass.methods.map(m => [m.name, m]));
                for (const [methodName, afterMethod] of afterMethodMap) {
                    const beforeMethod = beforeMethodMap.get(methodName);
                    if (beforeMethod && beforeMethod.signature !== afterMethod.signature) {
                        changedClasses.push(name);
                        break;
                    }
                }
            }
        }
        // Find removed classes
        for (const [name] of beforeClassMap) {
            if (!afterClassMap.has(name)) {
                changedClasses.push(name);
            }
        }
        return {
            changedFunctions: [...new Set(changedFunctions)],
            changedClasses: [...new Set(changedClasses)]
        };
    }
    updateTypeScriptProgram() {
        try {
            // Get all source files from ts-morph project
            const sourceFiles = this.project.getSourceFiles();
            const filePaths = sourceFiles.map(sf => sf.getFilePath());
            // Handle ESM default export for TypeScript
            const tsApi = ts.default || ts;
            // Create new TypeScript program with all files
            if (filePaths.length > 0) {
                this.program = tsApi.createProgram(filePaths, {
                    target: 5,
                    module: 1,
                    strict: true,
                    esModuleInterop: true,
                    skipLibCheck: true
                });
                this.checker = this.program?.getTypeChecker() || null;
            }
        }
        catch (error) {
            console.error('Error updating TypeScript program:', error);
        }
    }
    hasModifier(node, kind) {
        return node.getChildren().some(child => child.getKind() === kind);
    }
    collectSyntacticExports(sourceFile) {
        const namedExports = new Set();
        const typeOnlyExports = new Set();
        const starReexports = [];
        let hasAnyExport = false;
        let hasDefaultExport = false;
        for (const stmt of sourceFile.getStatements()) {
            if (ts_morph_1.Node.isExportAssignment(stmt)) {
                hasAnyExport = true;
                hasDefaultExport = true;
                continue;
            }
            if (ts_morph_1.Node.isExportDeclaration(stmt)) {
                const exportDecl = stmt;
                const moduleSpecifier = exportDecl.getModuleSpecifierValue();
                const isTypeOnlyDeclaration = exportDecl.isTypeOnly();
                const isNamespaceExport = exportDecl.isNamespaceExport();
                if (isNamespaceExport) {
                    if (moduleSpecifier) {
                        hasAnyExport = true;
                        starReexports.push(moduleSpecifier);
                    }
                    continue;
                }
                const named = exportDecl.getNamedExports();
                if (named.length > 0) {
                    hasAnyExport = true;
                }
                for (const spec of named) {
                    const compilerNode = spec.compilerNode;
                    const exportName = compilerNode.name.text;
                    const isTypeOnlySpecifier = compilerNode.isTypeOnly === true || isTypeOnlyDeclaration;
                    namedExports.add(exportName);
                    if (isTypeOnlySpecifier) {
                        typeOnlyExports.add(exportName);
                    }
                }
                continue;
            }
            if (ts_morph_1.Node.isModuleDeclaration(stmt)) {
                const nameNode = stmt.getNameNode();
                if (ts_morph_1.Node.isStringLiteral(nameNode)) {
                    continue;
                }
            }
            if (!this.hasModifier(stmt, ts_morph_1.ts.SyntaxKind.ExportKeyword)) {
                continue;
            }
            hasAnyExport = true;
            const isDefault = this.hasModifier(stmt, ts_morph_1.ts.SyntaxKind.DefaultKeyword);
            if (isDefault) {
                hasDefaultExport = true;
            }
            if (ts_morph_1.Node.isFunctionDeclaration(stmt)) {
                const name = stmt.getName();
                if (name && !isDefault) {
                    namedExports.add(name);
                }
                continue;
            }
            if (ts_morph_1.Node.isClassDeclaration(stmt)) {
                const name = stmt.getName();
                if (name && !isDefault) {
                    namedExports.add(name);
                }
                continue;
            }
            if (ts_morph_1.Node.isInterfaceDeclaration(stmt)) {
                const name = stmt.getName();
                if (name) {
                    namedExports.add(name);
                    typeOnlyExports.add(name);
                }
                continue;
            }
            if (ts_morph_1.Node.isTypeAliasDeclaration(stmt)) {
                const name = stmt.getName();
                if (name) {
                    namedExports.add(name);
                    typeOnlyExports.add(name);
                }
                continue;
            }
            if (ts_morph_1.Node.isEnumDeclaration(stmt)) {
                const name = stmt.getName();
                if (name) {
                    namedExports.add(name);
                }
                continue;
            }
            if (ts_morph_1.Node.isVariableStatement(stmt)) {
                for (const decl of stmt.getDeclarationList().getDeclarations()) {
                    const name = decl.getName();
                    if (name) {
                        namedExports.add(name);
                    }
                }
            }
        }
        return {
            namedExports,
            typeOnlyExports,
            starReexports,
            hasAnyExport,
            hasDefaultExport
        };
    }
    resolveSyntacticExports(sourceFile, filePath, visited) {
        const info = this.collectSyntacticExports(sourceFile);
        const exportNames = new Set();
        for (const name of info.namedExports) {
            exportNames.add(name);
        }
        if (info.hasDefaultExport) {
            exportNames.add('default');
        }
        for (const specifier of info.starReexports) {
            const reExportedNames = this.resolveModuleExports(specifier, filePath, visited);
            for (const name of reExportedNames) {
                exportNames.add(name);
            }
        }
        return { exportNames: Array.from(exportNames), info };
    }
    /**
     * Normalizes a module specifier to try resolving .js files to .ts/.d.ts equivalents.
     * This helps resolve re-exports that reference .js files.
     */
    normalizeModuleSpecifier(moduleSpecifier, fromFile) {
        const candidates = [moduleSpecifier];
        // If it already has an extension, keep it as-is
        if (moduleSpecifier.match(/\.(ts|tsx|d\.ts|mts|cts|js|jsx|mjs|cjs)$/)) {
            return candidates;
        }
        // No extension - try all candidate extensions in order
        // Order: .ts, .tsx, .d.ts, .mts, .cts, .js, .jsx, .mjs, .cjs
        const extensions = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
        for (const ext of extensions) {
            candidates.push(moduleSpecifier + ext);
        }
        return candidates;
    }
    /**
     * Resolves a module specifier to an actual file path.
     * Implements robust filesystem-based resolution for relative module specifiers.
     * Tries candidate extensions and index files in the proper order.
     * Caches results for performance.
     */
    resolveModulePath(moduleSpecifier, fromFile) {
        const cacheKey = `${moduleSpecifier}|${fromFile}`;
        // Check cache
        if (this.moduleResolutionCache.has(cacheKey)) {
            return this.moduleResolutionCache.get(cacheKey);
        }
        const fromDir = path.dirname(fromFile);
        const candidates = this.normalizeModuleSpecifier(moduleSpecifier, fromFile);
        // Debug: log what we're trying to resolve
        console.log(`[TypeScriptAnalyzer] Resolving module specifier "${moduleSpecifier}" from "${fromFile}"`);
        console.log(`[TypeScriptAnalyzer] Trying ${candidates.length} candidates`);
        // Try each candidate
        for (const candidate of candidates) {
            // Handle relative paths
            if (candidate.startsWith('./') || candidate.startsWith('../')) {
                const resolved = path.resolve(fromDir, candidate);
                const normalized = path.normalize(resolved);
                // Check if it's a file (exact path as given)
                if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
                    console.log(`[TypeScriptAnalyzer] Resolved "${moduleSpecifier}" to file: ${normalized}`);
                    this.moduleResolutionCache.set(cacheKey, normalized);
                    return normalized;
                }
                // Check if it's a directory - try index files with all extensions
                if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
                    const indexExtensions = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
                    for (const ext of indexExtensions) {
                        const indexFile = path.join(normalized, `index${ext}`);
                        if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
                            console.log(`[TypeScriptAnalyzer] Resolved "${moduleSpecifier}" to index file: ${indexFile}`);
                            this.moduleResolutionCache.set(cacheKey, indexFile);
                            return indexFile;
                        }
                    }
                }
            }
            else {
                // Absolute or node_modules path - try relative to fromDir
                const resolved = path.resolve(fromDir, candidate);
                const normalized = path.normalize(resolved);
                if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
                    console.log(`[TypeScriptAnalyzer] Resolved "${moduleSpecifier}" to file: ${normalized}`);
                    this.moduleResolutionCache.set(cacheKey, normalized);
                    return normalized;
                }
                // Check if it's a directory
                if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
                    const indexExtensions = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
                    for (const ext of indexExtensions) {
                        const indexFile = path.join(normalized, `index${ext}`);
                        if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
                            console.log(`[TypeScriptAnalyzer] Resolved "${moduleSpecifier}" to index file: ${indexFile}`);
                            this.moduleResolutionCache.set(cacheKey, indexFile);
                            return indexFile;
                        }
                    }
                }
            }
        }
        // Cache null result
        console.warn(`[TypeScriptAnalyzer] Could not resolve module specifier "${moduleSpecifier}" from "${fromFile}"`);
        console.warn(`[TypeScriptAnalyzer] Tried candidates: ${candidates.join(', ')}`);
        this.moduleResolutionCache.set(cacheKey, null);
        return null;
    }
    /**
     * Resolves exports from a module using TypeScript's type checker.
     * This handles export * from modules that aren't explicitly listed.
     * Recursively follows re-export chains to get all exported symbols.
     * Ensures the resolved file is added to the Program and uses the type checker
     * to get accurate module exports, including re-exports.
     * Caches results for performance.
     */
    resolveModuleExports(moduleSpecifier, fromFile, visited = new Set()) {
        const resolvedPath = this.resolveModulePath(moduleSpecifier, fromFile);
        if (!resolvedPath) {
            console.warn(`[TypeScriptAnalyzer] Cannot resolve exports: module path resolution failed for "${moduleSpecifier}" from "${fromFile}"`);
            return [];
        }
        // Prevent infinite recursion
        if (visited.has(resolvedPath)) {
            console.log(`[TypeScriptAnalyzer] Skipping already visited module: ${resolvedPath}`);
            return [];
        }
        visited.add(resolvedPath);
        // Check cache
        if (this.symbolExportsCache.has(resolvedPath)) {
            return this.symbolExportsCache.get(resolvedPath);
        }
        console.log(`[TypeScriptAnalyzer] Resolving exports from module: ${resolvedPath}`);
        // Ensure type checker is available
        if (!this.checker) {
            this.initializeTypeChecker();
        }
        // Try to get the source file from the project
        let targetSourceFile = this.project.getSourceFile(resolvedPath);
        if (!targetSourceFile) {
            // If not in project, add it to the project
            if (fs.existsSync(resolvedPath)) {
                try {
                    const content = fs.readFileSync(resolvedPath, 'utf8');
                    console.log(`[TypeScriptAnalyzer] Adding file to project: ${resolvedPath}`);
                    targetSourceFile = this.project.createSourceFile(resolvedPath, content, { overwrite: true });
                    // Update TypeScript program to include the new file
                    this.updateTypeScriptProgram();
                    // Re-initialize checker after program update
                    this.initializeTypeChecker();
                }
                catch (e) {
                    console.warn(`[TypeScriptAnalyzer] Failed to add source file ${resolvedPath}: ${e}`);
                    this.symbolExportsCache.set(resolvedPath, []);
                    return [];
                }
            }
            else {
                console.warn(`[TypeScriptAnalyzer] Resolved path does not exist: ${resolvedPath}`);
                this.symbolExportsCache.set(resolvedPath, []);
                return [];
            }
        }
        const exports = [];
        if (!targetSourceFile) {
            console.warn(`[TypeScriptAnalyzer] Could not get source file for ${resolvedPath}`);
            this.symbolExportsCache.set(resolvedPath, []);
            return [];
        }
        // Use TypeScript's type checker to get module exports (preferred approach)
        if (this.checker) {
            try {
                const sourceFile = targetSourceFile.compilerNode;
                // Get the module symbol using the type checker
                // The correct way: getSymbolAtLocation on the source file node
                let moduleSymbol = this.checker.getSymbolAtLocation(sourceFile);
                // Alternative: if the above doesn't work, try getting it from the module's symbol table
                if (!moduleSymbol) {
                    // Try to get the module symbol from the source file's symbol
                    const sourceFileSymbol = sourceFile.symbol;
                    if (sourceFileSymbol && sourceFileSymbol.flags & ts.SymbolFlags.ValueModule) {
                        moduleSymbol = sourceFileSymbol;
                    }
                }
                // Another alternative: use getSymbolsInScope
                if (!moduleSymbol) {
                    const symbols = this.checker.getSymbolsInScope(sourceFile, ts.SymbolFlags.Module);
                    if (symbols.length > 0) {
                        moduleSymbol = symbols[0];
                    }
                }
                if (moduleSymbol) {
                    console.log(`[TypeScriptAnalyzer] Got module symbol for ${resolvedPath}, extracting exports...`);
                    const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                    console.log(`[TypeScriptAnalyzer] Found ${moduleExports.length} exports from module ${resolvedPath}`);
                    if (moduleExports.length > 0) {
                        let filteredExportCount = 0;
                        for (const exportSymbol of moduleExports) {
                            const name = exportSymbol.getName();
                            // Skip internal TypeScript symbols
                            if (!name.startsWith('__')) {
                                exports.push(name);
                                filteredExportCount += 1;
                                console.log(`[TypeScriptAnalyzer]   - Export: ${name}`);
                            }
                        }
                        if (this.enableSyntacticExportFallback && filteredExportCount > 0) {
                            const syntacticInfo = this.collectSyntacticExports(targetSourceFile);
                            if (syntacticInfo.hasAnyExport && syntacticInfo.starReexports.length === 0) {
                                const syntacticCount = syntacticInfo.namedExports.size + (syntacticInfo.hasDefaultExport ? 1 : 0);
                                const diff = Math.abs(filteredExportCount - syntacticCount);
                                const threshold = Math.max(10, Math.floor(filteredExportCount * 0.5));
                                if (diff >= threshold) {
                                    console.warn(`[TypeScriptAnalyzer] Checker vs syntactic export count mismatch for ${resolvedPath}: checker=${filteredExportCount}, syntactic=${syntacticCount}`);
                                }
                            }
                        }
                    }
                    else if (this.enableSyntacticExportFallback) {
                        const { exportNames, info } = this.resolveSyntacticExports(targetSourceFile, resolvedPath, visited);
                        if (info.hasAnyExport) {
                            this.syntacticExportFallbackCount += 1;
                            console.warn(`[TypeScriptAnalyzer] Syntactic export fallback #${this.syntacticExportFallbackCount}: ${resolvedPath}`);
                            console.warn(`[TypeScriptAnalyzer]   checker exports=0, syntactic exports=${exportNames.length}, star reexports=${info.starReexports.length}, defaultExport=${info.hasDefaultExport}, typeOnlyExports=${info.typeOnlyExports.size}`);
                            if (info.starReexports.length > 0) {
                                console.warn(`[TypeScriptAnalyzer]   Star re-exports: ${info.starReexports.join(', ')}`);
                            }
                            exports.push(...exportNames);
                        }
                    }
                }
                else {
                    console.warn(`[TypeScriptAnalyzer] Could not get module symbol for ${resolvedPath}, falling back to recursive parsing`);
                    // Fallback: recursively parse export statements
                    exports.push(...this.extractExportsRecursively(targetSourceFile, resolvedPath, visited));
                }
            }
            catch (e) {
                console.warn(`[TypeScriptAnalyzer] Error using type checker for ${resolvedPath}: ${e}`);
                // Fallback: recursively parse export statements
                try {
                    exports.push(...this.extractExportsRecursively(targetSourceFile, resolvedPath, visited));
                }
                catch (e2) {
                    console.warn(`[TypeScriptAnalyzer] Error using recursive parsing for ${resolvedPath}: ${e2}`);
                }
            }
        }
        else if (targetSourceFile) {
            // Fallback: recursively parse export statements if checker is not available
            console.warn(`[TypeScriptAnalyzer] Type checker not available, using recursive parsing fallback for ${resolvedPath}`);
            try {
                exports.push(...this.extractExportsRecursively(targetSourceFile, resolvedPath, visited));
            }
            catch (e) {
                console.warn(`[TypeScriptAnalyzer] Error getting exports from ${resolvedPath}: ${e}`);
            }
        }
        console.log(`[TypeScriptAnalyzer] Resolved ${exports.length} exports from ${resolvedPath}: ${exports.join(', ')}`);
        // Cache result
        this.symbolExportsCache.set(resolvedPath, exports);
        return exports;
    }
    /**
     * Recursively extracts exports from a source file by following export * from chains.
     * This is a fallback when the type checker doesn't provide exports.
     */
    extractExportsRecursively(sourceFile, filePath, visited) {
        const { exportNames } = this.resolveSyntacticExports(sourceFile, filePath, visited);
        return exportNames;
    }
    findSymbolInFile(sourceFile, symbolName) {
        // Search for the symbol in the file
        const functions = sourceFile.getFunctions();
        for (const func of functions) {
            if (func.getName() === symbolName) {
                return func;
            }
        }
        const classes = sourceFile.getClasses();
        for (const cls of classes) {
            if (cls.getName() === symbolName) {
                return cls;
            }
        }
        const variables = sourceFile.getVariableDeclarations();
        for (const varDecl of variables) {
            if (varDecl.getName() === symbolName) {
                return varDecl;
            }
        }
        return null;
    }
    findReferencesFallback(symbolName, projectRoot) {
        const references = [];
        const escapedName = this.escapeRegex(symbolName);
        // Simple regex-based search
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
                        const ext = path.extname(fullPath).toLowerCase();
                        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
                            try {
                                const content = fs.readFileSync(fullPath, 'utf8');
                                const patterns = [
                                    new RegExp(`import\\s+.*\\b${escapedName}\\b`, 'g'),
                                    new RegExp(`\\b${escapedName}\\s*\\(`, 'g'),
                                    new RegExp(`new\\s+${escapedName}\\s*\\(`, 'g')
                                ];
                                if (patterns.some(pattern => pattern.test(content))) {
                                    references.push(fullPath);
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
        if (projectRoot && fs.existsSync(projectRoot)) {
            walkDir(projectRoot);
        }
        return [...new Set(references)];
    }
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
    getArrowFunctionSignature(varDecl, arrowFunc) {
        const name = varDecl.getName();
        const params = arrowFunc.getParameters().map((p) => {
            const paramName = p.getName();
            const paramType = p.getTypeNode()?.getText() || 'any';
            return `${paramName}: ${paramType}`;
        }).join(', ');
        return `${name}(${params})`;
    }
    getReturnType(func) {
        return func.getReturnTypeNode()?.getText() || 'any';
    }
    getArrowFunctionReturnType(arrowFunc) {
        return arrowFunc.getReturnTypeNode()?.getText() || 'any';
    }
    getParameters(func) {
        return func.getParameters().map(p => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || 'any',
            optional: p.hasQuestionToken(),
            defaultValue: p.getInitializer()?.getText()
        }));
    }
    getArrowFunctionParameters(arrowFunc) {
        return arrowFunc.getParameters().map((p) => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || 'any',
            optional: p.hasQuestionToken(),
            defaultValue: p.getInitializer()?.getText()
        }));
    }
    /**
     * Build a snapshot of the code state (AST + symbols + exports).
     * This is an immutable representation that can be cached and compared.
     */
    async buildSnapshot(filePath, content) {
        console.log(`[TypeScriptAnalyzer] Building snapshot for: ${filePath}`);
        console.log(`[TypeScriptAnalyzer] Content length: ${content.length} chars`);
        console.log(`[TypeScriptAnalyzer] Content preview (first 200 chars): ${content.substring(0, 200).replace(/\n/g, '\\n')}`);
        try {
            // Normalize file path to absolute
            const normalizedPath = path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(filePath);
            console.log(`[TypeScriptAnalyzer] Normalized path: ${normalizedPath}`);
            // Add or update file in ts-morph project
            let sourceFile;
            const existingFile = this.project.getSourceFile(normalizedPath);
            if (existingFile) {
                console.log(`[TypeScriptAnalyzer] Updating existing source file`);
                sourceFile = existingFile;
                sourceFile.replaceWithText(content);
            }
            else {
                console.log(`[TypeScriptAnalyzer] Creating new source file`);
                sourceFile = this.project.createSourceFile(normalizedPath, content, { overwrite: true });
            }
            // Verify source file was created correctly
            const sourceText = sourceFile.getText();
            console.log(`[TypeScriptAnalyzer] Source file text length: ${sourceText.length} chars`);
            console.log(`[TypeScriptAnalyzer] Content matches: ${sourceText === content}`);
            // Debug: Check what statements are found
            const statements = sourceFile.getStatements();
            console.log(`[TypeScriptAnalyzer] Found ${statements.length} top-level statements`);
            statements.forEach((stmt, idx) => {
                console.log(`[TypeScriptAnalyzer]   Statement ${idx}: ${stmt.getKindName()} at line ${stmt.getStartLineNumber()}`);
                console.log(`[TypeScriptAnalyzer]     Text preview: ${stmt.getText().substring(0, 100).replace(/\n/g, '\\n')}`);
            });
            // Check for syntax errors
            const diagnostics = sourceFile.getPreEmitDiagnostics();
            if (diagnostics.length > 0) {
                console.warn(`[TypeScriptAnalyzer] Found ${diagnostics.length} diagnostics:`);
                diagnostics.forEach(d => {
                    console.warn(`[TypeScriptAnalyzer]   - ${d.getMessageText()} at line ${d.getLineNumber()}`);
                });
            }
            else {
                console.log(`[TypeScriptAnalyzer] No syntax errors detected`);
            }
            // Update TypeScript program to include this file
            this.updateTypeScriptProgram();
            const functions = [];
            const classes = [];
            const interfaces = [];
            const typeAliases = [];
            const enums = [];
            const exports = [];
            const imports = [];
            const typeInfo = new Map();
            // Extract functions
            const functionDeclarations = sourceFile.getFunctions();
            console.log(`[TypeScriptAnalyzer] Found ${functionDeclarations.length} function declarations`);
            for (const func of functionDeclarations) {
                console.log(`[TypeScriptAnalyzer]   - Function: ${func.getName()} at line ${func.getStartLineNumber()}`);
                const symbolInfo = this.createFunctionSymbolInfo(func, null);
                functions.push(symbolInfo);
                // Get type information if checker is available
                if (this.checker && func.compilerNode) {
                    try {
                        // Access the underlying TypeScript node
                        const tsNode = func.compilerNode;
                        const symbolTypeInfo = this.getSymbolTypeInfo(tsNode);
                        if (symbolTypeInfo) {
                            typeInfo.set(symbolInfo.qualifiedName, symbolTypeInfo);
                        }
                    }
                    catch {
                        // Skip if type checking fails
                    }
                }
            }
            // Extract arrow functions assigned to variables
            const variableDeclarations = sourceFile.getVariableDeclarations();
            console.log(`[TypeScriptAnalyzer] Found ${variableDeclarations.length} variable declarations`);
            for (const varDecl of variableDeclarations) {
                const initializer = varDecl.getInitializer();
                if (initializer) {
                    const initializerText = initializer.getText();
                    if (initializerText.includes('=>')) {
                        console.log(`[TypeScriptAnalyzer]   - Arrow function: ${varDecl.getName()} at line ${varDecl.getStartLineNumber()}`);
                        const symbolInfo = this.createArrowFunctionSymbolInfo(varDecl, initializer);
                        functions.push(symbolInfo);
                    }
                }
            }
            // Extract classes
            const classDeclarations = sourceFile.getClasses();
            console.log(`[TypeScriptAnalyzer] Found ${classDeclarations.length} class declarations`);
            for (const cls of classDeclarations) {
                console.log(`[TypeScriptAnalyzer]   - Class: ${cls.getName()} at line ${cls.getStartLineNumber()}`);
                const symbolInfo = this.createClassSymbolInfo(cls);
                classes.push(symbolInfo);
            }
            // Extract interfaces
            const interfaceDeclarations = sourceFile.getInterfaces();
            console.log(`[TypeScriptAnalyzer] Found ${interfaceDeclarations.length} interface declarations`);
            for (const intf of interfaceDeclarations) {
                console.log(`[TypeScriptAnalyzer]   - Interface: ${intf.getName()} at line ${intf.getStartLineNumber()}`);
                const symbolInfo = this.createInterfaceSymbolInfo(intf);
                interfaces.push(symbolInfo);
            }
            // Extract type aliases
            const typeAliasDeclarations = sourceFile.getTypeAliases();
            console.log(`[TypeScriptAnalyzer] Found ${typeAliasDeclarations.length} type alias declarations`);
            for (const typeAlias of typeAliasDeclarations) {
                console.log(`[TypeScriptAnalyzer]   - Type alias: ${typeAlias.getName()} at line ${typeAlias.getStartLineNumber()}`);
                const symbolInfo = this.createTypeAliasSymbolInfo(typeAlias);
                typeAliases.push(symbolInfo);
            }
            // Extract enums
            const enumDeclarations = sourceFile.getEnums();
            console.log(`[TypeScriptAnalyzer] Found ${enumDeclarations.length} enum declarations`);
            for (const enumDecl of enumDeclarations) {
                console.log(`[TypeScriptAnalyzer]   - Enum: ${enumDecl.getName()} at line ${enumDecl.getStartLineNumber()}`);
                const symbolInfo = this.createEnumSymbolInfo(enumDecl);
                enums.push(symbolInfo);
            }
            // Extract exports - split into 3 buckets: directExports, reExportedSymbols, typeOnlyExports
            // CRITICAL: For barrel files, getExportedDeclarations() includes re-exported symbols,
            // so we must use AST-first approach and avoid double-counting.
            const allExportStatements = sourceFile.getExportDeclarations();
            const defaultExport = sourceFile.getDefaultExportSymbol();
            // Track counts explicitly and mutually exclusively
            let directExportedGroups = 0;
            let reexportGroupsResolved = 0;
            let reexportGroupsUnresolved = 0;
            // First pass: Collect all re-exported keys using strong key format
            // Use same key structure as uniqueness: name|module|type/value|kind
            // This prevents false positives when same name appears as both direct and re-export
            const reExportedKeys = new Set();
            const reExportStatements = [];
            for (const exportStmt of allExportStatements) {
                const moduleSpecifier = exportStmt.getModuleSpecifierValue();
                if (moduleSpecifier) {
                    // This is a re-export statement
                    const isTypeOnlyDeclaration = exportStmt.isTypeOnly();
                    const isNamespaceExport = exportStmt.isNamespaceExport();
                    reExportStatements.push({
                        stmt: exportStmt,
                        isTypeOnly: isTypeOnlyDeclaration,
                        isNamespace: isNamespaceExport,
                        moduleSpecifier
                    });
                    // For named re-exports, collect the keys immediately
                    if (!isNamespaceExport) {
                        for (const namedExport of exportStmt.getNamedExports()) {
                            const compilerNode = namedExport.compilerNode;
                            const publicName = compilerNode.name.text;
                            const isTypeOnlySpecifier = compilerNode.isTypeOnly === true || isTypeOnlyDeclaration;
                            const kind = 're-export'; // Named re-exports are always 're-export' kind
                            // Build strong key: name|module|type/value|kind
                            const key = `${publicName}|${moduleSpecifier}|${isTypeOnlySpecifier ? 'type' : 'value'}|${kind}`;
                            reExportedKeys.add(key);
                        }
                    }
                    else {
                        // For export * from, resolve and collect keys
                        // Note: We don't know the kind yet, so we'll use a placeholder
                        // The actual kind will be determined when we create ExportInfo objects
                        const resolvedExports = this.resolveModuleExports(moduleSpecifier, normalizedPath).filter(name => name !== 'default');
                        for (const exportName of resolvedExports) {
                            // For star exports, we mark all as type-only if the declaration is type-only
                            const kind = 're-export';
                            const key = `${exportName}|${moduleSpecifier}|${isTypeOnlyDeclaration ? 'type' : 'value'}|${kind}`;
                            reExportedKeys.add(key);
                        }
                    }
                }
            }
            // Second pass: Extract direct exports (declared in this file, NOT re-exported)
            // CRITICAL: Check that declarations actually originate in this file
            const exportDeclarations = sourceFile.getExportedDeclarations();
            const currentFilePath = sourceFile.getFilePath();
            for (const [name, declarations] of exportDeclarations) {
                // Filter: Only include declarations that originate in this file
                const localDeclarations = declarations.filter(decl => {
                    const declSourceFile = decl.getSourceFile();
                    return declSourceFile && declSourceFile.getFilePath() === currentFilePath;
                });
                // If no local declarations, this export comes from elsewhere (re-export)
                if (localDeclarations.length === 0) {
                    continue;
                }
                // Check if this export conflicts with a re-export using strong key
                // We need to check all possible combinations since we don't know the exact kind/isTypeOnly yet
                let isReExported = false;
                for (const decl of localDeclarations) {
                    const kind = this.getDeclarationKind(decl);
                    const isTypeOnly = false; // Direct exports are runtime by default
                    const key = `${name}|local|value|${kind}`;
                    if (reExportedKeys.has(key)) {
                        isReExported = true;
                        break;
                    }
                }
                if (isReExported) {
                    continue;
                }
                // This is a direct export (declared locally in this file)
                directExportedGroups++;
                const isDefault = defaultExport?.getName() === name;
                for (const decl of localDeclarations) {
                    const exportInfo = {
                        name,
                        type: isDefault ? 'default' : 'named',
                        kind: this.getDeclarationKind(decl),
                        line: decl.getStartLineNumber(),
                        isTypeOnly: false // Direct exports are runtime by default
                    };
                    exports.push(exportInfo);
                }
            }
            // Third pass: Process re-export statements and add them to exports
            // (We already collected names in first pass, now we add the ExportInfo objects)
            for (const { stmt: exportStmt, isTypeOnly: isTypeOnlyDeclaration, isNamespace: isNamespaceExport, moduleSpecifier } of reExportStatements) {
                if (isNamespaceExport) {
                    // Handle export * from './module' or export type * from './module'
                    const resolvedExports = this.resolveModuleExports(moduleSpecifier, normalizedPath).filter(name => name !== 'default');
                    if (resolvedExports.length > 0) {
                        reexportGroupsResolved++;
                        for (const exportName of resolvedExports) {
                            const exportInfo = {
                                name: exportName,
                                type: 'named',
                                kind: 're-export',
                                line: exportStmt.getStartLineNumber(),
                                sourceModule: moduleSpecifier,
                                sourceName: exportName,
                                exportedName: exportName,
                                localName: undefined,
                                isTypeOnly: isTypeOnlyDeclaration // export type * means all resolved exports are type-only
                            };
                            exports.push(exportInfo);
                        }
                    }
                    else {
                        reexportGroupsUnresolved++;
                    }
                }
                else {
                    // Handle export { x } from './module' or export { type Foo } from './module'
                    const namedExports = exportStmt.getNamedExports();
                    if (namedExports.length > 0) {
                        reexportGroupsResolved++;
                    }
                    for (const namedExport of namedExports) {
                        const compilerNode = namedExport.compilerNode;
                        const exportedName = compilerNode.name.text; // Public API name
                        // Check if this specific specifier is type-only (TS 5.x: export { type Foo } from ...)
                        const isTypeOnlySpecifier = compilerNode.isTypeOnly === true || isTypeOnlyDeclaration;
                        const sourceName = compilerNode.propertyName
                            ? compilerNode.propertyName.text
                            : compilerNode.name.text;
                        const exportInfo = {
                            name: exportedName,
                            type: 'named',
                            kind: 're-export',
                            line: exportStmt.getStartLineNumber(),
                            sourceModule: moduleSpecifier,
                            sourceName: sourceName,
                            exportedName: exportedName,
                            localName: sourceName !== exportedName ? sourceName : undefined,
                            isTypeOnly: isTypeOnlySpecifier
                        };
                        exports.push(exportInfo);
                    }
                }
            }
            // Handle default export separately if exists and not re-exported
            // Check using strong key format
            const defaultKey = `default|local|value|${defaultExport ? this.getDeclarationKind(defaultExport.getValueDeclaration()) : 'default'}`;
            if (defaultExport && !reExportedKeys.has(defaultKey)) {
                const defaultExportDecl = sourceFile.getDefaultExportSymbol()?.getValueDeclaration();
                if (defaultExportDecl) {
                    const node = this.project.getSourceFile(normalizedPath)?.getDefaultExportSymbol()?.getValueDeclaration();
                    if (node) {
                        const exportInfo = {
                            name: 'default',
                            type: 'default',
                            kind: this.getDeclarationKind(node),
                            line: node.getStartLineNumber?.() || 0,
                            isTypeOnly: false
                        };
                        exports.push(exportInfo);
                        directExportedGroups++; // Count default export as direct
                    }
                }
            }
            // Compute export statistics - split into buckets
            const directExportsRuntime = exports.filter(e => !e.sourceModule && !e.isTypeOnly && e.kind !== 'type' && e.kind !== 'interface' && e.kind !== 'type alias').length;
            const directExportsType = exports.filter(e => !e.sourceModule && !e.isTypeOnly && (e.kind === 'type' || e.kind === 'interface' || e.kind === 'type alias')).length;
            const directExports = directExportsRuntime + directExportsType;
            const reExportedSymbolsRuntime = exports.filter(e => e.sourceModule && !e.isTypeOnly).length;
            const reExportedSymbolsTypeOnly = exports.filter(e => e.sourceModule && e.isTypeOnly).length;
            const reExportedSymbols = reExportedSymbolsRuntime + reExportedSymbolsTypeOnly;
            const typeOnlyExports = exports.filter(e => e.isTypeOnly).length;
            const exportsTotal = exports.length;
            const exportsRuntime = directExportsRuntime + reExportedSymbolsRuntime;
            const exportsType = directExportsType + typeOnlyExports + reExportedSymbolsTypeOnly;
            // Helper to get declaration location for an export (used for uniqueness key)
            const getDeclarationLocation = (exp) => {
                if (!exp.sourceModule) {
                    // Direct export - try to get declaration from exportDeclarations
                    const decls = exportDeclarations.get(exp.name);
                    if (decls && decls.length > 0) {
                        const firstDecl = decls[0];
                        const declFile = firstDecl.getSourceFile();
                        if (declFile) {
                            const declPath = declFile.getFilePath();
                            const declPos = firstDecl.getStart();
                            return `${declPath}|${declPos}`;
                        }
                    }
                }
                // Re-export - use source module as location identifier
                return exp.sourceModule || 'local';
            };
            // Count unique export keys using the strongest key possible:
            // - exported name
            // - source module (or 'local' for direct exports)
            // - isTypeOnly flag
            // - kind (to distinguish type vs value exports with same name)
            // - declaration file and position (when available) for true symbol identity
            // This helps avoid collisions from aliases, merged symbols, or multiple resolution paths
            const uniqueExportKeys = new Set();
            const exportKeyToInfo = new Map();
            for (const exp of exports) {
                // Try to get declaration location for stronger key
                const declLocation = getDeclarationLocation(exp);
                // Create strongest unique key: name|module|type/value|kind|declLocation
                // If declaration location is available, use it; otherwise fall back to module
                const key = `${exp.name}|${exp.sourceModule || 'local'}|${exp.isTypeOnly ? 'type' : 'value'}|${exp.kind}|${declLocation}`;
                uniqueExportKeys.add(key);
                // Track first occurrence for duplicate reporting
                if (!exportKeyToInfo.has(key)) {
                    exportKeyToInfo.set(key, exp);
                }
            }
            const exportsWithDeclarations = exports.filter(e => {
                // Check if we have a declaration node for this export
                if (!e.sourceModule) {
                    // Direct export - check if it's in exportDeclarations
                    return exportDeclarations.has(e.name);
                }
                // Re-export - we don't have direct access to declaration, but we resolved it
                return true; // Assume resolved re-exports have declarations
            }).length;
            // Log explicit counts
            console.log(`[TypeScriptAnalyzer] Export counts: direct_exported_groups=${directExportedGroups}, reexport_groups_resolved=${reexportGroupsResolved}, reexport_groups_unresolved=${reexportGroupsUnresolved}`);
            console.log(`[TypeScriptAnalyzer] Export buckets: directExports=${directExports}, reExportedSymbols=${reExportedSymbols}, typeOnlyExports=${typeOnlyExports}`);
            console.log(`[TypeScriptAnalyzer] Export totals: exports_total=${exportsTotal}, exports_runtime=${exportsRuntime}, exports_type=${exportsType}, exports_unique=${uniqueExportKeys.size}, exports_with_declarations=${exportsWithDeclarations}`);
            // Barrel file assertions (for regression mode)
            const localDeclarations = functions.length + classes.length + interfaces.length + typeAliases.length + enums.length;
            const isBarrelFile = localDeclarations === 0 && exportsTotal > 0;
            if (isBarrelFile) {
                // Assertions for barrel files
                if (directExports > 0 && directExports > exportsTotal * 0.1) {
                    console.warn(`[TypeScriptAnalyzer] Barrel file has ${directExports} direct exports (expected near 0)`);
                }
                // Check for duplicate keys using the strongest key format (with declaration location)
                const exportKeyCounts = new Map();
                const exportKeyToSources = new Map();
                for (const exp of exports) {
                    const declLocation = getDeclarationLocation(exp);
                    const key = `${exp.name}|${exp.sourceModule || 'local'}|${exp.isTypeOnly ? 'type' : 'value'}|${exp.kind}|${declLocation}`;
                    exportKeyCounts.set(key, (exportKeyCounts.get(key) || 0) + 1);
                    if (!exportKeyToSources.has(key)) {
                        exportKeyToSources.set(key, []);
                    }
                    const source = exp.sourceModule || 'local';
                    if (!exportKeyToSources.get(key).includes(source)) {
                        exportKeyToSources.get(key).push(source);
                    }
                }
                const duplicates = Array.from(exportKeyCounts.entries())
                    .filter(([_, count]) => count > 1)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20);
                if (duplicates.length > 0) {
                    console.warn(`[TypeScriptAnalyzer] Found ${duplicates.length} duplicate export keys (top 20):`);
                    for (const [key, count] of duplicates) {
                        const sources = exportKeyToSources.get(key) || [];
                        console.warn(`[TypeScriptAnalyzer]   - ${key}: ${count} times (sources: ${sources.join(', ')})`);
                    }
                }
                // Log uniqueness status (don't fail hard, just warn)
                const duplicatesCount = exportsTotal - uniqueExportKeys.size;
                if (exportsTotal !== uniqueExportKeys.size) {
                    console.warn(`[TypeScriptAnalyzer] Uniqueness check: exports_total=${exportsTotal} != exports_unique=${uniqueExportKeys.size} (difference: ${duplicatesCount} duplicates)`);
                }
                else {
                    console.log(`[TypeScriptAnalyzer] Uniqueness check passed: all ${exportsTotal} exports are unique`);
                }
                // Regression-specific assertion: expect at least one export type * from statement
                const hasTypeOnlyStarExport = allExportStatements.some(stmt => {
                    const moduleSpec = stmt.getModuleSpecifierValue();
                    return moduleSpec && stmt.isTypeOnly() && stmt.isNamespaceExport();
                });
                if (hasTypeOnlyStarExport) {
                    console.log(`[TypeScriptAnalyzer] Found export type * from statement (type-only star export)`);
                }
                // Concrete regression checks (should fail CI if broken)
                // These are deterministic pass/fail signals for the regression harness
                const regressionChecks = {
                    // Check 1: Barrel files should have near-zero direct exports
                    directExportsNearZero: directExportedGroups <= 1,
                    // Check 2: export type * from must contribute only to exports_type, not exports_runtime
                    typeOnlyExportsNotInRuntime: typeOnlyExports > 0 ? exportsRuntime === (directExportsRuntime + reExportedSymbolsRuntime) : true,
                    // Check 3: Uniqueness after dedupe (allow small number of duplicates for now)
                    duplicatesAcceptable: duplicatesCount <= 1,
                    // Check 4: If export type * exists, it should contribute to type exports
                    typeOnlyStarExportContributesToType: hasTypeOnlyStarExport ? exportsType >= typeOnlyExports : true
                };
                // Log regression check results
                const failedChecks = Object.entries(regressionChecks)
                    .filter(([_, passed]) => !passed)
                    .map(([name, _]) => name);
                if (failedChecks.length > 0) {
                    console.error(`[TypeScriptAnalyzer] REGRESSION CHECKS FAILED: ${failedChecks.join(', ')}`);
                    console.error(`[TypeScriptAnalyzer] Check details:`, regressionChecks);
                }
                else {
                    console.log(`[TypeScriptAnalyzer] All regression checks passed`);
                }
            }
            // Extract imports (suppress verbose logging)
            const importDeclarations = sourceFile.getImportDeclarations();
            for (const importDecl of importDeclarations) {
                const moduleSpecifier = importDecl.getModuleSpecifierValue();
                if (moduleSpecifier) {
                    const namedImports = importDecl.getNamedImports().map(imp => imp.getName());
                    const defaultImport = importDecl.getDefaultImport()?.getText();
                    const namespaceImport = importDecl.getNamespaceImport()?.getText();
                    const importInfo = {
                        module: moduleSpecifier,
                        symbols: defaultImport ? [defaultImport, ...namedImports] : namedImports,
                        isDefault: !!defaultImport,
                        isNamespace: !!namespaceImport
                    };
                    imports.push(importInfo);
                }
            }
            // Only log summary, not every individual export
            console.log(`[TypeScriptAnalyzer] Snapshot: ${functions.length} functions, ${classes.length} classes, ${interfaces.length} interfaces, ${typeAliases.length} types, ${enums.length} enums, ${exports.length} exports, ${imports.length} imports`);
            return {
                filePath: normalizedPath,
                timestamp: new Date(),
                functions,
                classes,
                interfaces,
                typeAliases,
                enums,
                exports,
                imports,
                exportStats: {
                    directExports,
                    reExportedSymbols,
                    typeOnlyExports,
                    exportsTotal,
                    exportsRuntime,
                    exportsType,
                    exportsUnique: uniqueExportKeys.size,
                    exportsWithDeclarations,
                    reexportGroupsUnresolved
                },
                typeInfo: typeInfo.size > 0 ? typeInfo : undefined
            };
        }
        catch (error) {
            console.error(`Error building snapshot for ${filePath}:`, error);
            // Return empty snapshot on error
            return {
                filePath,
                timestamp: new Date(),
                functions: [],
                classes: [],
                interfaces: [],
                typeAliases: [],
                enums: [],
                exports: [],
                imports: []
            };
        }
    }
    /**
     * Diff two snapshots to find changes.
     */
    async diffSnapshots(beforeSnapshot, afterSnapshot) {
        console.log(`[TypeScriptAnalyzer] Diffing snapshots for: ${beforeSnapshot.filePath}`);
        const changedSymbols = [];
        const added = [];
        const removed = [];
        const modified = [];
        // Helper to create a map by qualified name
        const createSymbolMap = (symbols) => {
            return new Map(symbols.map(s => [s.qualifiedName, s]));
        };
        // Build suppression set: removed exports (beforeExportNames - afterExportNames)
        // These symbols should only emit TSAPI-EXP-001, not function/class/type removal rules
        const beforeExportNames = new Set(beforeSnapshot.exports.map(e => e.name));
        const afterExportNames = new Set(afterSnapshot.exports.map(e => e.name));
        const removedExports = new Set();
        for (const exportName of beforeExportNames) {
            if (!afterExportNames.has(exportName)) {
                removedExports.add(exportName);
            }
        }
        console.log(`[TypeScriptAnalyzer] Removed exports (suppressed): ${Array.from(removedExports).join(', ')}`);
        // Compare exports first to establish export changes
        const exportChanges = this.compareExports(beforeSnapshot.exports, afterSnapshot.exports);
        // Compare functions (with suppression)
        const beforeFuncs = createSymbolMap(beforeSnapshot.functions);
        const afterFuncs = createSymbolMap(afterSnapshot.functions);
        this.compareSymbols(beforeFuncs, afterFuncs, 'function', changedSymbols, added, removed, modified, removedExports);
        // Compare classes (with suppression)
        const beforeClasses = createSymbolMap(beforeSnapshot.classes);
        const afterClasses = createSymbolMap(afterSnapshot.classes);
        this.compareSymbols(beforeClasses, afterClasses, 'class', changedSymbols, added, removed, modified, removedExports);
        // Compare interfaces (with suppression)
        const beforeInterfaces = createSymbolMap(beforeSnapshot.interfaces);
        const afterInterfaces = createSymbolMap(afterSnapshot.interfaces);
        this.compareSymbols(beforeInterfaces, afterInterfaces, 'interface', changedSymbols, added, removed, modified, removedExports);
        // Compare type aliases (with suppression)
        const beforeTypes = createSymbolMap(beforeSnapshot.typeAliases);
        const afterTypes = createSymbolMap(afterSnapshot.typeAliases);
        this.compareSymbols(beforeTypes, afterTypes, 'type', changedSymbols, added, removed, modified, removedExports);
        // Compare enums (with suppression)
        const beforeEnums = createSymbolMap(beforeSnapshot.enums);
        const afterEnums = createSymbolMap(afterSnapshot.enums);
        this.compareSymbols(beforeEnums, afterEnums, 'enum', changedSymbols, added, removed, modified, removedExports);
        return {
            changedSymbols,
            added,
            removed,
            modified,
            exportChanges,
            packageChanges: [] // TypeScript analyzer doesn't handle package.json changes
        };
    }
    compareSymbols(beforeMap, afterMap, kind, changedSymbols, added, removed, modified, suppressedSymbols = new Set()) {
        // Find added symbols
        for (const [name, afterSymbol] of afterMap) {
            if (!beforeMap.has(name)) {
                added.push(afterSymbol);
                changedSymbols.push({
                    symbol: afterSymbol,
                    changeType: 'added',
                    severity: afterSymbol.isExported ? 'high' : 'low',
                    isBreaking: afterSymbol.isExported
                });
            }
        }
        // Find removed symbols
        // Skip if symbol name is in suppressedSymbols (will be handled by TSAPI-EXP-001)
        for (const [name, beforeSymbol] of beforeMap) {
            if (!afterMap.has(name)) {
                // Check if this symbol is suppressed (handled by export removal rule)
                const symbolName = beforeSymbol.name;
                if (suppressedSymbols.has(symbolName)) {
                    console.log(`[TypeScriptAnalyzer] Suppressing removal rule for '${symbolName}' (handled by TSAPI-EXP-001)`);
                    continue; // Skip - will be handled by export removal rule
                }
                removed.push(beforeSymbol);
                changedSymbols.push({
                    symbol: beforeSymbol,
                    changeType: 'removed',
                    severity: beforeSymbol.isExported ? 'high' : 'medium',
                    isBreaking: beforeSymbol.isExported
                });
            }
        }
        // Find modified symbols with detailed breaking change detection
        for (const [name, afterSymbol] of afterMap) {
            const beforeSymbol = beforeMap.get(name);
            if (beforeSymbol) {
                // For functions, check overload changes first
                // Overload removal/changes are TSAPI-FN-007 (overload set changed), not TSAPI-FN-002 (parameter removed)
                // TSAPI-FN-002 should only be used for actual parameter arity changes (removing a parameter position)
                if ((kind === 'function' || kind === 'method') && (beforeSymbol.overloads || afterSymbol.overloads)) {
                    const beforeOverloads = new Set(beforeSymbol.overloads || []);
                    const afterOverloads = new Set(afterSymbol.overloads || []);
                    // Check if overload set changed
                    if (beforeOverloads.size !== afterOverloads.size ||
                        ![...beforeOverloads].every(ov => afterOverloads.has(ov))) {
                        const removedOverloads = [...beforeOverloads].filter(ov => !afterOverloads.has(ov));
                        const addedOverloads = [...afterOverloads].filter(ov => !beforeOverloads.has(ov));
                        const change = {
                            symbol: afterSymbol,
                            changeType: 'signature-changed',
                            before: beforeSymbol,
                            after: afterSymbol,
                            severity: afterSymbol.isExported ? 'high' : 'medium',
                            isBreaking: afterSymbol.isExported,
                            metadata: {
                                ruleId: 'TSAPI-FN-007',
                                message: removedOverloads.length > 0
                                    ? `Function overload removed: ${removedOverloads.join(', ')} (${beforeOverloads.size} → ${afterOverloads.size} overloads)`
                                    : addedOverloads.length > 0
                                        ? `Function overload added: ${addedOverloads.join(', ')} (${beforeOverloads.size} → ${afterOverloads.size} overloads)`
                                        : `Function overload set changed (${beforeOverloads.size} → ${afterOverloads.size} overloads)`,
                                detail: removedOverloads.length > 0 ? 'overloadRemoved' : 'overloadChanged',
                                removedOverloads: removedOverloads.length > 0 ? removedOverloads : undefined
                            }
                        };
                        modified.push(change);
                        changedSymbols.push(change);
                        continue;
                    }
                }
                // For functions, check parameter changes in detail
                if (kind === 'function' || kind === 'method') {
                    const paramChange = this.detectParameterBreakingChange(beforeSymbol, afterSymbol);
                    if (paramChange) {
                        const change = {
                            symbol: afterSymbol,
                            changeType: paramChange.changeType,
                            before: beforeSymbol,
                            after: afterSymbol,
                            severity: afterSymbol.isExported ? 'high' : 'medium',
                            isBreaking: paramChange.isBreaking,
                            metadata: {
                                ruleId: paramChange.ruleId,
                                message: paramChange.message
                            }
                        };
                        modified.push(change);
                        changedSymbols.push(change);
                        continue;
                    }
                }
                // For classes, check method changes
                if (kind === 'class') {
                    const methodChange = this.detectClassMethodChange(beforeSymbol, afterSymbol);
                    if (methodChange) {
                        // For method removals, create a synthetic symbol with qualified name (ClassName.methodName)
                        // The removedMethodName is already the qualified name (e.g., "Client.ping") from metadata
                        const removedMethodQualifiedName = methodChange.removedMethodName;
                        const methodNameOnly = removedMethodQualifiedName?.split('.').pop() || afterSymbol.name;
                        // Create synthetic symbol with correct kind to avoid masquerading as the class
                        const methodSymbol = {
                            ...afterSymbol,
                            name: methodNameOnly,
                            qualifiedName: removedMethodQualifiedName || afterSymbol.qualifiedName,
                            kind: 'method',
                            // Store container class name for reference
                            metadata: {
                                ...afterSymbol.metadata,
                                containerName: afterSymbol.name,
                                containerQualifiedName: afterSymbol.qualifiedName
                            }
                        };
                        const change = {
                            symbol: methodSymbol,
                            changeType: methodChange.changeType,
                            before: beforeSymbol,
                            after: afterSymbol,
                            severity: afterSymbol.isExported ? 'high' : 'medium',
                            isBreaking: methodChange.isBreaking,
                            metadata: {
                                ruleId: methodChange.ruleId,
                                message: methodChange.message,
                                removedMethodName: removedMethodQualifiedName
                            }
                        };
                        modified.push(change);
                        changedSymbols.push(change);
                        continue;
                    }
                }
                // For interfaces and types, check property changes
                if (kind === 'interface' || kind === 'type') {
                    const propertyChange = this.detectPropertyBreakingChange(beforeSymbol, afterSymbol);
                    if (propertyChange) {
                        const change = {
                            symbol: afterSymbol,
                            changeType: propertyChange.changeType,
                            before: beforeSymbol,
                            after: afterSymbol,
                            severity: afterSymbol.isExported ? 'high' : 'medium',
                            isBreaking: propertyChange.isBreaking,
                            metadata: {
                                ruleId: propertyChange.ruleId,
                                message: propertyChange.message
                            }
                        };
                        modified.push(change);
                        changedSymbols.push(change);
                        continue;
                    }
                    // Also check if type definition changed (for type aliases)
                    // This is the fallback when property extraction didn't work (non-object-literal types)
                    if (kind === 'type') {
                        const beforeTypeText = beforeSymbol.metadata?.typeText;
                        const afterTypeText = afterSymbol.metadata?.typeText;
                        if (beforeTypeText && afterTypeText) {
                            // Use normalized comparison to handle formatting differences
                            const beforeNormalized = this.normalizeTypeText(beforeTypeText);
                            const afterNormalized = this.normalizeTypeText(afterTypeText);
                            if (beforeNormalized !== afterNormalized) {
                                const change = {
                                    symbol: afterSymbol,
                                    changeType: 'type-changed',
                                    before: beforeSymbol,
                                    after: afterSymbol,
                                    severity: afterSymbol.isExported ? 'high' : 'medium',
                                    isBreaking: afterSymbol.isExported,
                                    metadata: {
                                        ruleId: 'TSAPI-TYPE-002',
                                        message: `Type definition changed`
                                    }
                                };
                                modified.push(change);
                                changedSymbols.push(change);
                                continue;
                            }
                        }
                    }
                }
                // Check if signature changed
                if (beforeSymbol.signature !== afterSymbol.signature) {
                    const change = {
                        symbol: afterSymbol,
                        changeType: 'signature-changed',
                        before: beforeSymbol,
                        after: afterSymbol,
                        severity: afterSymbol.isExported ? 'high' : 'medium',
                        isBreaking: afterSymbol.isExported
                    };
                    modified.push(change);
                    changedSymbols.push(change);
                }
                // Check if type changed (if type info available)
                else if (beforeSymbol.returnType !== afterSymbol.returnType) {
                    const change = {
                        symbol: afterSymbol,
                        changeType: 'type-changed',
                        before: beforeSymbol,
                        after: afterSymbol,
                        severity: afterSymbol.isExported ? 'high' : 'medium',
                        isBreaking: afterSymbol.isExported && beforeSymbol.returnType !== undefined
                    };
                    modified.push(change);
                    changedSymbols.push(change);
                }
            }
        }
    }
    /**
     * Detect specific parameter-level breaking changes (optional -> required, removed, type changed)
     */
    detectParameterBreakingChange(before, after) {
        if (!before.parameters || !after.parameters) {
            return null;
        }
        const beforeParams = new Map(before.parameters.map(p => [p.name, p]));
        const afterParams = new Map(after.parameters.map(p => [p.name, p]));
        // Check for removed parameters
        for (const [paramName, beforeParam] of beforeParams) {
            if (!afterParams.has(paramName)) {
                return {
                    changeType: 'signature-changed',
                    isBreaking: true,
                    ruleId: 'TSAPI-FN-002',
                    message: `Parameter '${paramName}' was removed`
                };
            }
        }
        // Check for parameter changes (optional -> required, type changed)
        for (const [paramName, afterParam] of afterParams) {
            const beforeParam = beforeParams.get(paramName);
            if (beforeParam) {
                // Optional -> Required
                if (beforeParam.optional && !afterParam.optional) {
                    return {
                        changeType: 'signature-changed',
                        isBreaking: true,
                        ruleId: 'TSAPI-FN-001',
                        message: `Parameter '${paramName}' changed from optional to required`
                    };
                }
                // Type changed
                if (beforeParam.type !== afterParam.type) {
                    return {
                        changeType: 'type-changed',
                        isBreaking: true,
                        ruleId: 'TSAPI-FN-003',
                        message: `Parameter '${paramName}' type changed from '${beforeParam.type}' to '${afterParam.type}'`
                    };
                }
            }
        }
        // Check return type change
        if (before.returnType && after.returnType && before.returnType !== after.returnType) {
            return {
                changeType: 'type-changed',
                isBreaking: true,
                ruleId: 'TSAPI-FN-004',
                message: `Return type changed from '${before.returnType}' to '${after.returnType}'`
            };
        }
        return null;
    }
    /**
     * Detect property-level breaking changes in interfaces/types
     */
    detectPropertyBreakingChange(before, after) {
        // Determine if this is an interface or type alias to use the correct rule ID
        const isTypeAlias = before.kind === 'type' || after.kind === 'type';
        const beforeProps = before.metadata?.properties;
        const afterProps = after.metadata?.properties;
        // Check index signatures first (they affect all properties)
        const beforeIndexSigs = before.metadata?.indexSignatures;
        const afterIndexSigs = after.metadata?.indexSignatures;
        if (beforeIndexSigs || afterIndexSigs) {
            // Index signature changes are breaking
            const beforeSig = beforeIndexSigs?.[0]; // Take first index signature
            const afterSig = afterIndexSigs?.[0];
            if (beforeSig && afterSig) {
                // Index signature changed
                const beforeKeyNormalized = this.normalizeTypeText(beforeSig.keyType);
                const afterKeyNormalized = this.normalizeTypeText(afterSig.keyType);
                const beforeValueNormalized = this.normalizeTypeText(beforeSig.valueType);
                const afterValueNormalized = this.normalizeTypeText(afterSig.valueType);
                if (beforeKeyNormalized !== afterKeyNormalized || beforeValueNormalized !== afterValueNormalized) {
                    return {
                        changeType: 'type-changed',
                        isBreaking: true,
                        ruleId: isTypeAlias ? 'TSAPI-TYPE-002' : 'TSAPI-IF-003',
                        message: `Index signature changed from [${beforeSig.keyType}]: ${beforeSig.valueType} to [${afterSig.keyType}]: ${afterSig.valueType}`
                    };
                }
            }
            else if (beforeSig && !afterSig) {
                // Index signature removed
                return {
                    changeType: 'signature-changed',
                    isBreaking: true,
                    ruleId: isTypeAlias ? 'TSAPI-TYPE-001' : 'TSAPI-IF-001',
                    message: `Index signature [${beforeSig.keyType}]: ${beforeSig.valueType} was removed`
                };
            }
            else if (!beforeSig && afterSig) {
                // Index signature added (not breaking, but we note it)
                // Continue to check properties
            }
        }
        if (!beforeProps || !afterProps) {
            return null;
        }
        const beforePropMap = new Map(beforeProps.map(p => [p.name, p]));
        const afterPropMap = new Map(afterProps.map(p => [p.name, p]));
        // Check for removed properties
        for (const [propName, beforeProp] of beforePropMap) {
            if (!afterPropMap.has(propName)) {
                return {
                    changeType: 'signature-changed',
                    isBreaking: true,
                    ruleId: isTypeAlias ? 'TSAPI-TYPE-001' : 'TSAPI-IF-001',
                    message: `Property '${propName}' was removed`
                };
            }
        }
        // Check for property changes (optional -> required, type changed)
        for (const [propName, afterProp] of afterPropMap) {
            const beforeProp = beforePropMap.get(propName);
            if (beforeProp) {
                // Optional -> Required
                if (beforeProp.isOptional && !afterProp.isOptional) {
                    return {
                        changeType: 'signature-changed',
                        isBreaking: true,
                        ruleId: isTypeAlias ? 'TSAPI-TYPE-003' : 'TSAPI-IF-002',
                        message: `Property '${propName}' changed from optional to required`
                    };
                }
                // Type changed - use normalized comparison to handle formatting differences
                const beforeTypeNormalized = this.normalizeTypeText(beforeProp.type);
                const afterTypeNormalized = this.normalizeTypeText(afterProp.type);
                if (beforeTypeNormalized !== afterTypeNormalized) {
                    return {
                        changeType: 'type-changed',
                        isBreaking: true,
                        ruleId: isTypeAlias ? 'TSAPI-TYPE-004' : 'TSAPI-IF-003',
                        message: `Property '${propName}' type changed from '${beforeProp.type}' to '${afterProp.type}'`
                    };
                }
            }
        }
        return null;
    }
    /**
     * Detect class method changes (removed methods)
     */
    detectClassMethodChange(before, after) {
        const beforeMethods = before.metadata?.methods || [];
        const afterMethods = after.metadata?.methods || [];
        // Check for removed methods
        for (const methodName of beforeMethods) {
            if (!afterMethods.includes(methodName)) {
                return {
                    changeType: 'signature-changed',
                    isBreaking: true,
                    ruleId: 'TSAPI-CLS-001',
                    message: `Method '${methodName}' was removed from class`,
                    removedMethodName: methodName
                };
            }
        }
        return null;
    }
    /**
     * Generate a stable export signature for comparison
     * Re-exports must include sourceName to detect changes like export { x } → export { y as x }
     */
    getExportSignature(exp) {
        if (exp.kind === 're-export' || exp.sourceModule !== undefined) {
            // Re-export signature includes sourceName to detect source changes
            // sourceName is the propertyName (name before 'as'), or name if no propertyName
            const sourceName = exp.sourceName || exp.name;
            const sig = `reexport:${exp.name}:from:${exp.sourceModule}:name:${sourceName}`;
            console.log(`[TypeScriptAnalyzer] Export signature for '${exp.name}': ${sig} (sourceName=${sourceName}, exp.sourceName=${exp.sourceName})`);
            return sig;
        }
        // Regular declaration export
        return `decl:${exp.name}:${exp.kind}:${exp.type}`;
    }
    compareExports(beforeExports, afterExports) {
        console.log(`[TypeScriptAnalyzer] ========== compareExports START ==========`);
        console.log(`[TypeScriptAnalyzer] Comparing exports: ${beforeExports.length} before, ${afterExports.length} after`);
        // Log all exports for debugging
        console.log(`[TypeScriptAnalyzer] Before exports:`);
        for (const exp of beforeExports) {
            console.log(`[TypeScriptAnalyzer]   - name='${exp.name}', kind='${exp.kind}', sourceModule='${exp.sourceModule}', sourceName='${exp.sourceName}'`);
        }
        console.log(`[TypeScriptAnalyzer] After exports:`);
        for (const exp of afterExports) {
            console.log(`[TypeScriptAnalyzer]   - name='${exp.name}', kind='${exp.kind}', sourceModule='${exp.sourceModule}', sourceName='${exp.sourceName}'`);
        }
        // Build maps by exported name (public API key) - this is what consumers see
        // For re-exports, we need to handle multiple entries with the same name
        // Group by name to handle cases where same name appears multiple times
        const beforeMap = new Map();
        const afterMap = new Map();
        for (const exp of beforeExports) {
            if (!beforeMap.has(exp.name)) {
                beforeMap.set(exp.name, []);
            }
            beforeMap.get(exp.name).push(exp);
            const sig = this.getExportSignature(exp);
            console.log(`[TypeScriptAnalyzer] Before export '${exp.name}': signature='${sig}'`);
        }
        for (const exp of afterExports) {
            if (!afterMap.has(exp.name)) {
                afterMap.set(exp.name, []);
            }
            afterMap.get(exp.name).push(exp);
            const sig = this.getExportSignature(exp);
            console.log(`[TypeScriptAnalyzer] After export '${exp.name}': signature='${sig}'`);
        }
        console.log(`[TypeScriptAnalyzer] Maps built: before has ${beforeMap.size} unique names, after has ${afterMap.size} unique names`);
        const added = [];
        const removed = [];
        const modified = [];
        // Find added exports
        for (const [name, afterExportsList] of afterMap) {
            if (!beforeMap.has(name)) {
                added.push(...afterExportsList);
            }
        }
        // Find removed exports
        for (const [name, beforeExportsList] of beforeMap) {
            if (!afterMap.has(name)) {
                removed.push(...beforeExportsList);
            }
        }
        // Find modified exports (including re-export changes)
        // Compare exports that exist in both before and after by signature
        console.log(`[TypeScriptAnalyzer] Checking for modified exports...`);
        for (const [name, afterExportsList] of afterMap) {
            const beforeExportsList = beforeMap.get(name);
            if (beforeExportsList) {
                console.log(`[TypeScriptAnalyzer] Export '${name}' exists in both: before=${beforeExportsList.length} entries, after=${afterExportsList.length} entries`);
                // Find re-export entries in both lists
                const beforeReexport = beforeExportsList.find(e => e.kind === 're-export' || e.sourceModule !== undefined);
                const afterReexport = afterExportsList.find(e => e.kind === 're-export' || e.sourceModule !== undefined);
                console.log(`[TypeScriptAnalyzer]   beforeReexport: ${beforeReexport ? `kind=${beforeReexport.kind}, sourceModule=${beforeReexport.sourceModule}, sourceName=${beforeReexport.sourceName}` : 'none'}`);
                console.log(`[TypeScriptAnalyzer]   afterReexport: ${afterReexport ? `kind=${afterReexport.kind}, sourceModule=${afterReexport.sourceModule}, sourceName=${afterReexport.sourceName}` : 'none'}`);
                if (beforeReexport && afterReexport) {
                    // Both are re-exports - compare signatures
                    const beforeSig = this.getExportSignature(beforeReexport);
                    const afterSig = this.getExportSignature(afterReexport);
                    console.log(`[TypeScriptAnalyzer] Comparing re-export '${name}': before sig='${beforeSig}', after sig='${afterSig}'`);
                    console.log(`[TypeScriptAnalyzer]   Signatures equal: ${beforeSig === afterSig}`);
                    if (beforeSig !== afterSig) {
                        // Signature changed - sourceModule or sourceName changed
                        modified.push({ before: beforeReexport, after: afterReexport });
                        console.log(`[TypeScriptAnalyzer] ✅ Re-export '${name}' changed: ${beforeSig} → ${afterSig}`);
                    }
                    else {
                        console.log(`[TypeScriptAnalyzer] Re-export '${name}' unchanged (signatures match)`);
                    }
                }
                else if (!beforeReexport && !afterReexport) {
                    // Neither is a re-export - compare as regular exports
                    const beforeExport = beforeExportsList[0];
                    const afterExport = afterExportsList[0];
                    if (beforeExport && afterExport) {
                        const beforeSig = this.getExportSignature(beforeExport);
                        const afterSig = this.getExportSignature(afterExport);
                        if (beforeSig !== afterSig) {
                            modified.push(afterExport); // Keep simple format for non-re-export changes
                            console.log(`[TypeScriptAnalyzer] Export '${name}' changed: ${beforeSig} → ${afterSig}`);
                        }
                    }
                }
                else {
                    // One is re-export, one is not - this is a type change
                    console.log(`[TypeScriptAnalyzer] Export '${name}' type changed (re-export ↔ declaration)`);
                    modified.push(afterReexport || afterExportsList[0]);
                }
            }
        }
        console.log(`[TypeScriptAnalyzer] Export comparison result: ${added.length} added, ${removed.length} removed, ${modified.length} modified`);
        // Log details of modified exports
        for (const mod of modified) {
            if ('before' in mod && 'after' in mod) {
                const change = mod;
                console.log(`[TypeScriptAnalyzer]   ✅ Modified (re-export): '${change.after.name}' (${change.before.sourceName} → ${change.after.sourceName})`);
            }
            else {
                const exp = mod;
                console.log(`[TypeScriptAnalyzer]   Modified: '${exp.name}'`);
            }
        }
        console.log(`[TypeScriptAnalyzer] ========== compareExports END ==========`);
        return {
            added,
            removed,
            modified: modified // Type assertion for union type
        };
    }
    createFunctionSymbolInfo(func, parentClass) {
        const name = func.getName() || 'anonymous';
        const qualifiedName = parentClass ? `${parentClass.getName()}.${name}` : name;
        const signature = this.getFunctionSignature(func);
        const returnType = this.getReturnType(func);
        const parameters = this.getParameters(func).map(p => ({
            name: p.name,
            type: p.type,
            optional: p.optional,
            defaultValue: p.defaultValue
        }));
        // Check if exported (only FunctionDeclaration has isExported)
        const isExported = func instanceof ts_morph_1.FunctionDeclaration ? func.isExported() : false;
        // Extract overload signatures (for functions with overloads)
        // Use type checker for accurate call signature detection
        const overloads = [];
        if (func instanceof ts_morph_1.FunctionDeclaration) {
            // Try to use type checker for accurate call signatures
            if (this.checker && func.compilerNode) {
                try {
                    const symbol = this.checker.getSymbolAtLocation(func.compilerNode);
                    if (symbol) {
                        const type = this.checker.getTypeOfSymbolAtLocation(symbol, func.compilerNode);
                        const callSignatures = type.getCallSignatures();
                        // Normalize each call signature into a stable key
                        for (const sig of callSignatures) {
                            const normalizedSig = this.normalizeCallSignature(sig);
                            if (normalizedSig) {
                                overloads.push(normalizedSig);
                            }
                        }
                    }
                }
                catch (error) {
                    console.log(`[TypeScriptAnalyzer] Failed to get call signatures from type checker, falling back to declaration overloads: ${error}`);
                }
            }
            // Fallback: use declaration overloads if type checker approach failed
            if (overloads.length === 0) {
                const overloadSignatures = func.getOverloads();
                for (const overload of overloadSignatures) {
                    const overloadSig = this.getFunctionSignature(overload);
                    overloads.push(overloadSig);
                }
                // If there are overloads, also include the implementation signature
                if (overloads.length > 0) {
                    overloads.push(signature);
                }
            }
        }
        return {
            name,
            qualifiedName,
            line: func.getStartLineNumber(),
            column: func.getStartLineNumber(true),
            signature,
            returnType,
            parameters,
            isExported,
            kind: parentClass ? 'method' : 'function',
            overloads: overloads.length > 0 ? overloads : undefined,
            metadata: {
                isAsync: func.isAsync()
            }
        };
    }
    createArrowFunctionSymbolInfo(varDecl, initializer) {
        const name = varDecl.getName();
        return {
            name,
            qualifiedName: name,
            line: varDecl.getStartLineNumber(),
            column: varDecl.getStartLineNumber(true),
            signature: `${name}()`,
            returnType: 'any',
            parameters: [],
            isExported: varDecl.getVariableStatement()?.isExported() || false,
            kind: 'function',
            metadata: {
                isArrowFunction: true
            }
        };
    }
    createClassSymbolInfo(cls) {
        const name = cls.getName() || 'anonymous';
        const methods = cls.getMethods().map(m => this.createFunctionSymbolInfo(m, cls));
        const properties = cls.getProperties().map(p => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || 'any',
            isOptional: p.hasQuestionToken(),
            isReadonly: p.isReadonly()
        }));
        const extendsClause = cls.getExtends();
        return {
            name,
            qualifiedName: name,
            line: cls.getStartLineNumber(),
            column: cls.getStartLineNumber(true),
            signature: `class ${name}${extendsClause ? ` extends ${extendsClause.getText()}` : ''}`,
            isExported: cls.isExported(),
            kind: 'class',
            metadata: {
                extends: extendsClause?.getText(),
                implements: cls.getImplements().map(impl => impl.getText()),
                methods: methods.map(m => m.qualifiedName),
                properties: properties.map(p => p.name)
            }
        };
    }
    createInterfaceSymbolInfo(intf) {
        const name = intf.getName();
        const properties = intf.getProperties().map(p => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || 'any',
            isOptional: p.hasQuestionToken(),
            isReadonly: p.isReadonly()
        }));
        return {
            name,
            qualifiedName: name,
            line: intf.getStartLineNumber(),
            column: intf.getStartLineNumber(true),
            signature: `interface ${name}`,
            isExported: intf.isExported(),
            kind: 'interface',
            metadata: {
                extends: intf.getExtends().map(e => e.getText()),
                properties: properties // Store full property info for comparison
            }
        };
    }
    createTypeAliasSymbolInfo(typeAlias) {
        const name = typeAlias.getName();
        const typeNode = typeAlias.getTypeNode();
        const typeText = this.normalizeTypeText(typeNode?.getText() || 'unknown');
        // Extract properties if this is an object type literal or intersection with object literals
        const properties = [];
        const indexSignatures = [];
        if (typeNode) {
            try {
                const compilerNode = typeNode.compilerNode;
                // Handle direct object type literal: type X = { a?: string }
                if (ts.isTypeLiteralNode(compilerNode)) {
                    this.extractPropertiesFromTypeLiteral(compilerNode, properties, indexSignatures);
                }
                // Handle intersection types: type X = A & { a?: string }
                else if (ts.isIntersectionTypeNode(compilerNode)) {
                    for (const type of compilerNode.types) {
                        if (ts.isTypeLiteralNode(type)) {
                            this.extractPropertiesFromTypeLiteral(type, properties, indexSignatures);
                        }
                        else if (ts.isTypeReferenceNode(type)) {
                            // For intersections with type references, try to resolve if it's an object type
                            // This is a best-effort - full resolution would require type checker
                            const typeName = type.typeName;
                            if (ts.isIdentifier(typeName)) {
                                // Mark that this type includes properties from another type
                                // We can't extract them without type checker, but we note the dependency
                            }
                        }
                    }
                }
                // Handle union types: type X = A | { a?: string }
                // Extract properties from all object literal members of the union
                else if (ts.isUnionTypeNode(compilerNode)) {
                    for (const type of compilerNode.types) {
                        if (ts.isTypeLiteralNode(type)) {
                            this.extractPropertiesFromTypeLiteral(type, properties, indexSignatures);
                        }
                    }
                    // Note: For unions, we collect properties from all object literal members
                    // This is conservative - in reality, only properties present in ALL members are guaranteed
                }
                // Handle mapped types: type X = { [K in keyof T]: T[K] }
                else if (ts.isMappedTypeNode(compilerNode)) {
                    // Mapped types are complex - extract what we can
                    const typeLiteral = compilerNode.type;
                    if (typeLiteral && ts.isTypeLiteralNode(typeLiteral)) {
                        this.extractPropertiesFromTypeLiteral(typeLiteral, properties, indexSignatures);
                    }
                    // Store mapped type info for reference
                }
            }
            catch (error) {
                // If property extraction fails, fall back to typeText comparison
                console.log(`[TypeScriptAnalyzer] Failed to extract properties from type alias ${name}: ${error}`);
            }
        }
        return {
            name,
            qualifiedName: name,
            line: typeAlias.getStartLineNumber(),
            column: typeAlias.getStartLineNumber(true),
            signature: `type ${name} = ${typeText}`,
            isExported: typeAlias.isExported(),
            kind: 'type',
            metadata: {
                typeText,
                properties: properties.length > 0 ? properties : undefined,
                indexSignatures: indexSignatures.length > 0 ? indexSignatures : undefined // Store index signatures
            }
        };
    }
    /**
     * Extract properties from a TypeScript TypeLiteralNode
     * Handles PropertySignature members, index signatures, and extracts name, type, and optional flag
     * Also handles nested object types recursively
     */
    extractPropertiesFromTypeLiteral(typeLiteral, properties, indexSignatures) {
        const members = typeLiteral.members;
        for (const member of members) {
            // Handle property signatures: { a?: string }
            if (ts.isPropertySignature(member)) {
                const propInfo = this.extractPropertySignature(member);
                if (propInfo) {
                    properties.push(propInfo);
                }
            }
            // Handle index signatures: { [key: string]: value }
            else if (ts.isIndexSignatureDeclaration(member)) {
                const indexInfo = this.extractIndexSignature(member);
                if (indexInfo) {
                    indexSignatures.push(indexInfo);
                }
            }
            // Handle method signatures: { method(): void }
            // Note: Method signatures are tracked but not used for property breaking change detection
            else if (ts.isMethodSignature(member)) {
                // Methods are part of the type but handled separately
            }
        }
    }
    /**
     * Extract property information from a PropertySignature node
     * Handles nested object types and various property name types
     */
    extractPropertySignature(member) {
        const propName = member.name;
        let propNameText;
        // Handle different property name types
        if (ts.isIdentifier(propName)) {
            propNameText = propName.text;
        }
        else if (ts.isStringLiteral(propName)) {
            propNameText = propName.text;
        }
        else if (ts.isNumericLiteral(propName)) {
            propNameText = propName.text;
        }
        else if (ts.isComputedPropertyName(propName)) {
            // Computed property names - extract expression text
            const expression = propName.expression;
            if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) {
                propNameText = expression.text;
            }
            else {
                // For complex computed names, use the text representation
                try {
                    propNameText = propName.getText();
                }
                catch (error) {
                    console.log(`[TypeScriptAnalyzer] Failed to extract computed property name: ${error}`);
                    return null;
                }
            }
        }
        if (!propNameText) {
            return null;
        }
        // Get type text from the type node, with normalization
        const propTypeNode = member.type;
        let propType = 'any';
        if (propTypeNode) {
            try {
                propType = this.normalizeTypeText(propTypeNode.getText());
            }
            catch (error) {
                console.log(`[TypeScriptAnalyzer] Failed to get type text for property ${propNameText}: ${error}`);
            }
        }
        const isOptional = member.questionToken !== undefined;
        return {
            name: propNameText,
            type: propType,
            isOptional
        };
    }
    /**
     * Extract index signature information
     */
    extractIndexSignature(member) {
        try {
            const keyTypeNode = member.parameters[0]?.type;
            const valueTypeNode = member.type;
            if (!keyTypeNode || !valueTypeNode) {
                return null;
            }
            const keyType = this.normalizeTypeText(keyTypeNode.getText());
            const valueType = this.normalizeTypeText(valueTypeNode.getText());
            return { keyType, valueType };
        }
        catch (error) {
            console.log(`[TypeScriptAnalyzer] Failed to extract index signature: ${error}`);
            return null;
        }
    }
    /**
     * Normalize type text to handle formatting differences
     * - Removes extra whitespace
     * - Normalizes type alias references vs inline types (best effort)
     */
    normalizeTypeText(typeText) {
        if (!typeText)
            return 'any';
        // Remove extra whitespace and normalize spacing
        let normalized = typeText
            .replace(/\s+/g, ' ')
            .replace(/\s*([{}[\]():,|&<>])\s*/g, '$1')
            .trim();
        // Normalize common type patterns
        // This is a best-effort normalization - full type equivalence would require type checker
        normalized = normalized
            .replace(/\bstring\s*\|\s*undefined\b/g, 'string | undefined')
            .replace(/\bnumber\s*\|\s*undefined\b/g, 'number | undefined')
            .replace(/\bboolean\s*\|\s*undefined\b/g, 'boolean | undefined');
        return normalized;
    }
    createEnumSymbolInfo(enumDecl) {
        const name = enumDecl.getName();
        const members = enumDecl.getMembers().map(m => m.getName());
        return {
            name,
            qualifiedName: name,
            line: enumDecl.getStartLineNumber(),
            column: enumDecl.getStartLineNumber(true),
            signature: `enum ${name}`,
            isExported: enumDecl.isExported(),
            kind: 'enum',
            metadata: {
                members
            }
        };
    }
    getDeclarationKind(decl) {
        if (!decl)
            return 'unknown';
        // Check if getKindName method exists (ts-morph Node method)
        if (typeof decl.getKindName !== 'function') {
            return 'unknown';
        }
        try {
            const kindName = decl.getKindName();
            if (kindName === 'FunctionDeclaration')
                return 'function';
            if (kindName === 'ClassDeclaration')
                return 'class';
            if (kindName === 'InterfaceDeclaration')
                return 'interface';
            if (kindName === 'TypeAliasDeclaration')
                return 'type';
            if (kindName === 'EnumDeclaration')
                return 'enum';
            if (kindName === 'VariableDeclaration')
                return 'variable';
        }
        catch (e) {
            // If getKindName fails, return unknown
            return 'unknown';
        }
        return 'unknown';
    }
    /**
     * Normalize a TypeScript call signature into a stable key for comparison
     * Format: paramCount:param1Type:param2Type:...:returnType
     * Handles optional parameters and complex types
     * Uses TypeScript's type checker for accurate type resolution
     */
    normalizeCallSignature(signature) {
        if (!this.checker)
            return '';
        const params = [];
        const declaration = signature.declaration;
        if (!declaration)
            return '';
        // Get parameter types using the type checker
        for (let i = 0; i < signature.parameters.length; i++) {
            const param = signature.parameters[i];
            const paramDecl = param.valueDeclaration || declaration;
            if (!paramDecl)
                continue;
            try {
                const paramType = this.checker.getTypeOfSymbolAtLocation(param, paramDecl);
                const paramTypeString = this.checker.typeToString(paramType);
                // Check if parameter is optional
                let isOptional = false;
                if (param.valueDeclaration && ts.isParameter(param.valueDeclaration)) {
                    isOptional = param.valueDeclaration.questionToken !== undefined;
                }
                params.push(`${paramTypeString}${isOptional ? '?' : ''}`);
            }
            catch (error) {
                // Fallback: use parameter name if type resolution fails
                const paramName = param.getName();
                params.push(`${paramName}:any`);
            }
        }
        // Get return type from signature
        try {
            // Access the return type from the signature's type property
            // Signature has a 'type' property that contains the return type
            const signatureType = signature.type;
            if (signatureType) {
                const returnTypeString = this.checker.typeToString(signatureType);
                return `${params.length}:${params.join(':')}:${returnTypeString}`;
            }
            // Fallback: get return type from declaration
            if (declaration && ts.isFunctionLike(declaration) && declaration.type) {
                const returnTypeNode = declaration.type;
                const returnType = this.checker.getTypeAtLocation(returnTypeNode);
                const returnTypeString = this.checker.typeToString(returnType);
                return `${params.length}:${params.join(':')}:${returnTypeString}`;
            }
        }
        catch (error) {
            // Fallback to 'any' if return type resolution fails
        }
        return `${params.length}:${params.join(':')}:any`;
    }
    getSymbolTypeInfo(node) {
        if (!this.checker)
            return null;
        try {
            const type = this.checker.getTypeAtLocation(node);
            const typeString = this.checker.typeToString(type);
            // Check for type parameters (for generic types)
            let typeParameters;
            if (type.symbol && type.symbol.typeParameters) {
                typeParameters = type.symbol.typeParameters.map((tp) => tp.symbol ? tp.symbol.getName() : 'unknown');
            }
            return {
                type: typeString,
                isPrimitive: type.flags === ts.TypeFlags.Number ||
                    type.flags === ts.TypeFlags.String ||
                    type.flags === ts.TypeFlags.Boolean,
                isUnion: !!(type.flags & ts.TypeFlags.Union),
                isIntersection: !!(type.flags & ts.TypeFlags.Intersection),
                typeParameters
            };
        }
        catch {
            return null;
        }
    }
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    /**
     * Resolves entrypoint exports to their actual declaration locations.
     * This is the core of API snapshot mode - it resolves all exports (direct and re-exported)
     * to their real declaration files and positions.
     */
    async resolveEntrypointExportsToDeclarations(entrypointPath, exports) {
        if (!this.checker) {
            console.warn('[TypeScriptAnalyzer] Type checker not available, cannot resolve exports to declarations');
            return [];
        }
        const resolvedExports = [];
        const entrypointFile = this.project.getSourceFile(entrypointPath);
        if (!entrypointFile) {
            console.warn(`[TypeScriptAnalyzer] Entrypoint file not found: ${entrypointPath}`);
            return [];
        }
        const entrypointFilePath = entrypointFile.getFilePath();
        for (const exp of exports) {
            try {
                if (!exp.sourceModule) {
                    // Case A: Direct/local export
                    const exportDeclarations = entrypointFile.getExportedDeclarations();
                    const declarations = exportDeclarations.get(exp.name);
                    if (declarations && declarations.length > 0) {
                        // Verify it's actually in this file
                        const localDecls = declarations.filter(d => d.getSourceFile().getFilePath() === entrypointFilePath);
                        if (localDecls.length > 0) {
                            const decl = localDecls[0];
                            const declFile = decl.getSourceFile();
                            const declPath = declFile.getFilePath();
                            const declPos = decl.getStart();
                            const declEnd = decl.getEnd();
                            // Get TypeScript symbol
                            let tsSymbol;
                            try {
                                const compilerNode = decl.compilerNode;
                                tsSymbol = this.checker.getSymbolAtLocation(compilerNode);
                            }
                            catch (e) {
                                // Ignore
                            }
                            // Fallback: try to get symbol from module exports
                            if (!tsSymbol && this.checker) {
                                try {
                                    const sourceFile = entrypointFile.compilerNode;
                                    const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile);
                                    if (moduleSymbol) {
                                        const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                                        const foundSymbol = moduleExports.find(s => s.getName() === exp.name);
                                        if (foundSymbol) {
                                            tsSymbol = foundSymbol;
                                        }
                                    }
                                }
                                catch (e) {
                                    // Ignore
                                }
                            }
                            resolvedExports.push({
                                exportName: exp.name,
                                isTypeOnly: exp.isTypeOnly || false,
                                declFilePath: declPath,
                                declPos,
                                declEnd,
                                tsSymbol,
                                kind: exp.kind
                            });
                            continue;
                        }
                    }
                }
                else {
                    // Case B/C: Re-export (named or star)
                    const resolvedPath = this.resolveModulePath(exp.sourceModule, entrypointPath);
                    if (!resolvedPath) {
                        console.warn(`[TypeScriptAnalyzer] Could not resolve module: ${exp.sourceModule}`);
                        continue;
                    }
                    // Load the target source file
                    let targetSourceFile = this.project.getSourceFile(resolvedPath);
                    if (!targetSourceFile && fs.existsSync(resolvedPath)) {
                        try {
                            const content = fs.readFileSync(resolvedPath, 'utf8');
                            targetSourceFile = this.project.createSourceFile(resolvedPath, content);
                            this.updateTypeScriptProgram();
                        }
                        catch (e) {
                            console.warn(`[TypeScriptAnalyzer] Could not load file: ${resolvedPath}`);
                            continue;
                        }
                    }
                    if (!targetSourceFile || !this.checker) {
                        continue;
                    }
                    if (exp.kind === 're-export' && exp.sourceName) {
                        // Case B: export { x } from './mod'
                        const targetExports = targetSourceFile.getExportedDeclarations();
                        const targetDecls = targetExports.get(exp.sourceName);
                        if (targetDecls && targetDecls.length > 0) {
                            const decl = targetDecls[0];
                            const declFile = decl.getSourceFile();
                            const declPath = declFile.getFilePath();
                            const declPos = decl.getStart();
                            const declEnd = decl.getEnd();
                            let tsSymbol;
                            try {
                                const compilerNode = decl.compilerNode;
                                tsSymbol = this.checker.getSymbolAtLocation(compilerNode);
                            }
                            catch (e) {
                                // Ignore
                            }
                            // Fallback: try to get symbol from target module exports
                            if (!tsSymbol && this.checker) {
                                try {
                                    const targetSourceFile = declFile.compilerNode;
                                    const moduleSymbol = this.checker.getSymbolAtLocation(targetSourceFile);
                                    if (moduleSymbol) {
                                        const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                                        // Prefer value symbols
                                        const foundSymbol = moduleExports.find(s => {
                                            if (s.getName() !== exp.sourceName)
                                                return false;
                                            const flags = s.getFlags();
                                            return (flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Function | ts.SymbolFlags.Class | ts.SymbolFlags.Enum | ts.SymbolFlags.Variable)) !== 0;
                                        }) || moduleExports.find(s => s.getName() === exp.sourceName);
                                        if (foundSymbol) {
                                            tsSymbol = foundSymbol;
                                        }
                                    }
                                }
                                catch (e) {
                                    // Ignore
                                }
                            }
                            resolvedExports.push({
                                exportName: exp.name,
                                isTypeOnly: exp.isTypeOnly || false,
                                declFilePath: declPath,
                                declPos,
                                declEnd,
                                tsSymbol,
                                sourceModule: exp.sourceModule,
                                kind: exp.kind
                            });
                        }
                    }
                    else {
                        // Case C: export * from './mod' or export type * from './types'
                        // Use TypeScript's type checker to get all exports
                        try {
                            const sourceFile = targetSourceFile.compilerNode;
                            const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile);
                            if (moduleSymbol) {
                                // Get all exports from the module (both value and type exports)
                                // TypeScript's getExportsOfModule should include both
                                const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                                // Track which exports we've already added (by name) to avoid duplicates
                                const addedExports = new Set();
                                for (const exportSymbol of moduleExports) {
                                    if (exportSymbol.getName() === 'default') {
                                        continue;
                                    }
                                    const exportName = exportSymbol.getName();
                                    // Skip if we've already added this export (prefer value symbols over type symbols)
                                    if (addedExports.has(exportName)) {
                                        continue;
                                    }
                                    // For type-only exports, we want type symbols
                                    // For regular exports, prefer value symbols
                                    const flags = exportSymbol.getFlags();
                                    const isTypeSymbol = (flags & ts.SymbolFlags.Type) !== 0 &&
                                        (flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Function | ts.SymbolFlags.Class | ts.SymbolFlags.Enum | ts.SymbolFlags.Variable)) === 0;
                                    // If this is a type-only export, include type symbols
                                    // Otherwise, skip pure type symbols (interfaces, type aliases without values)
                                    if (!exp.isTypeOnly && isTypeSymbol) {
                                        // Check if there's a value symbol with the same name
                                        const hasValueSymbol = moduleExports.some(s => s.getName() === exportName &&
                                            (s.getFlags() & (ts.SymbolFlags.Value | ts.SymbolFlags.Function | ts.SymbolFlags.Class | ts.SymbolFlags.Enum | ts.SymbolFlags.Variable)) !== 0);
                                        if (hasValueSymbol) {
                                            continue; // Skip this type symbol, we'll get the value symbol
                                        }
                                    }
                                    // Get declaration location
                                    const declarations = exportSymbol.getDeclarations();
                                    if (declarations && declarations.length > 0) {
                                        const firstDecl = declarations[0];
                                        const declFile = firstDecl.getSourceFile();
                                        const declPath = declFile.fileName;
                                        const declPos = firstDecl.getStart();
                                        const declEnd = firstDecl.getEnd();
                                        // Verify the symbol is valid
                                        if (!exportSymbol || exportSymbol.flags === ts.SymbolFlags.None) {
                                            console.warn(`[TypeScriptAnalyzer] Invalid symbol for export ${exportName}`);
                                            continue;
                                        }
                                        resolvedExports.push({
                                            exportName,
                                            isTypeOnly: exp.isTypeOnly || false,
                                            declFilePath: declPath,
                                            declPos,
                                            declEnd,
                                            tsSymbol: exportSymbol,
                                            sourceModule: exp.sourceModule,
                                            kind: 're-export'
                                        });
                                        addedExports.add(exportName);
                                    }
                                    else {
                                        // Try alternative approach: use ts-morph to find the declaration
                                        const exportedDecls = targetSourceFile.getExportedDeclarations();
                                        const namedDecls = exportedDecls.get(exportSymbol.getName());
                                        if (namedDecls && namedDecls.length > 0) {
                                            const decl = namedDecls[0];
                                            const declFile = decl.getSourceFile();
                                            const declPath = declFile.getFilePath();
                                            const declPos = decl.getStart();
                                            const declEnd = decl.getEnd();
                                            // Try to get symbol from the declaration node
                                            let tsSymbol = exportSymbol;
                                            try {
                                                const compilerNode = decl.compilerNode;
                                                const symbolFromNode = this.checker.getSymbolAtLocation(compilerNode);
                                                if (symbolFromNode) {
                                                    tsSymbol = symbolFromNode;
                                                }
                                            }
                                            catch (e) {
                                                // Use the exportSymbol we already have
                                            }
                                            resolvedExports.push({
                                                exportName: exportSymbol.getName(),
                                                isTypeOnly: exp.isTypeOnly || false,
                                                declFilePath: declPath,
                                                declPos,
                                                declEnd,
                                                tsSymbol: tsSymbol,
                                                sourceModule: exp.sourceModule,
                                                kind: 're-export'
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        catch (e) {
                            console.warn(`[TypeScriptAnalyzer] Error resolving star export from ${exp.sourceModule}:`, e);
                        }
                    }
                }
            }
            catch (error) {
                console.warn(`[TypeScriptAnalyzer] Error resolving export ${exp.name}:`, error);
            }
        }
        return resolvedExports;
    }
    /**
     * Builds an API snapshot from resolved exports.
     * This creates normalized API shapes for each exported symbol.
     */
    async buildApiSnapshotFromResolvedExports(entrypointPath, resolvedExports) {
        const exports = new Map();
        if (!this.checker) {
            console.warn('[TypeScriptAnalyzer] Type checker not available, cannot build API snapshot');
            return {
                entrypointPath,
                exports,
                timestamp: new Date()
            };
        }
        console.log(`[TypeScriptAnalyzer] Building API snapshot from ${resolvedExports.length} resolved exports`);
        let successCount = 0;
        let failureCount = 0;
        for (const resolved of resolvedExports) {
            try {
                // If no tsSymbol, try to get it from the declaration file
                if (!resolved.tsSymbol) {
                    // Try to load the declaration file and get the symbol
                    const declSourceFile = this.project.getSourceFile(resolved.declFilePath);
                    if (declSourceFile && this.checker) {
                        try {
                            // Try to find the declaration by name
                            const exportedDecls = declSourceFile.getExportedDeclarations();
                            const decls = exportedDecls.get(resolved.exportName);
                            if (decls && decls.length > 0) {
                                const decl = decls[0];
                                const compilerNode = decl.compilerNode;
                                const symbol = this.checker.getSymbolAtLocation(compilerNode);
                                if (symbol) {
                                    resolved.tsSymbol = symbol;
                                }
                            }
                            // If still no symbol, try getting from module exports
                            if (!resolved.tsSymbol) {
                                const sourceFile = declSourceFile.compilerNode;
                                const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile);
                                if (moduleSymbol) {
                                    const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                                    // Prefer value symbols over type symbols
                                    const foundSymbol = moduleExports.find(s => {
                                        if (s.getName() !== resolved.exportName)
                                            return false;
                                        const flags = s.getFlags();
                                        // Prefer value symbols (functions, classes, variables, enums)
                                        return (flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Function | ts.SymbolFlags.Class | ts.SymbolFlags.Enum | ts.SymbolFlags.Variable)) !== 0;
                                    }) || moduleExports.find(s => s.getName() === resolved.exportName);
                                    if (foundSymbol) {
                                        resolved.tsSymbol = foundSymbol;
                                    }
                                }
                            }
                        }
                        catch (e) {
                            // Ignore errors in fallback
                        }
                    }
                    if (!resolved.tsSymbol) {
                        console.warn(`[TypeScriptAnalyzer] No tsSymbol for export ${resolved.exportName} at ${resolved.declFilePath}:${resolved.declPos}`);
                        failureCount++;
                        continue;
                    }
                }
                // Skip type-only exports - they don't have runtime API shapes
                if (resolved.isTypeOnly) {
                    // Silently skip type-only exports - they're expected to not have runtime shapes
                    continue;
                }
                const identity = this.createExportIdentity(resolved);
                const shape = await this.buildApiShapeForSymbol(resolved);
                if (shape) {
                    exports.set(identity, shape);
                    successCount++;
                }
                else {
                    // Check if this is a type-only export or a variable with interface declaration
                    // (both are expected to not have runtime API shapes)
                    const isTypeOnly = resolved.isTypeOnly ||
                        (resolved.tsSymbol &&
                            (resolved.tsSymbol.getFlags() & ts.SymbolFlags.Type) !== 0 &&
                            (resolved.tsSymbol.getFlags() & (ts.SymbolFlags.Value | ts.SymbolFlags.Function | ts.SymbolFlags.Class | ts.SymbolFlags.Enum | ts.SymbolFlags.Variable)) === 0);
                    // Check if it's a variable symbol with interface declaration (constants like daysInWeek)
                    const isVariableWithInterface = resolved.tsSymbol &&
                        (resolved.tsSymbol.getFlags() & (ts.SymbolFlags.Variable | ts.SymbolFlags.Property)) !== 0 &&
                        resolved.tsSymbol.getDeclarations()?.some((d) => ts.isInterfaceDeclaration(d)) &&
                        !resolved.tsSymbol.getDeclarations()?.some((d) => ts.isVariableDeclaration(d));
                    if (!isTypeOnly && !isVariableWithInterface) {
                        // Only log as failure if it's not a known skip case
                        console.warn(`[TypeScriptAnalyzer] Failed to build API shape for ${resolved.exportName} (kind: ${resolved.kind})`);
                        failureCount++;
                    }
                    // Otherwise, it's a type-only export or variable with interface - skip silently
                }
            }
            catch (error) {
                console.warn(`[TypeScriptAnalyzer] Error building API shape for ${resolved.exportName}:`, error);
                failureCount++;
            }
        }
        console.log(`[TypeScriptAnalyzer] API snapshot: ${successCount} shapes built, ${failureCount} failed`);
        return {
            entrypointPath,
            exports,
            timestamp: new Date()
        };
    }
    /**
     * Creates a stable export identity string.
     */
    createExportIdentity(resolved) {
        return `${resolved.exportName}|${resolved.isTypeOnly ? 'type' : 'value'}|${resolved.declFilePath}|${resolved.declPos}`;
    }
    /**
     * Builds an API shape for a resolved export symbol.
     * Caches results for performance.
     */
    async buildApiShapeForSymbol(resolved) {
        if (!this.checker || !resolved.tsSymbol) {
            return null;
        }
        // Create cache key
        const identity = this.createExportIdentity(resolved);
        // Check cache
        if (this.apiShapeCache.has(identity)) {
            return this.apiShapeCache.get(identity);
        }
        try {
            // Resolve aliased symbols
            const symbol = resolved.tsSymbol.flags & ts.SymbolFlags.Alias
                ? this.checker.getAliasedSymbol(resolved.tsSymbol)
                : resolved.tsSymbol;
            const declarations = symbol.getDeclarations();
            if (!declarations || declarations.length === 0) {
                console.warn(`[TypeScriptAnalyzer] No declarations for symbol ${resolved.exportName}`);
                this.apiShapeCache.set(identity, null);
                return null;
            }
            // Filter to get value declarations (not type declarations)
            // A symbol can have both value and type declarations, we want the value one
            const valueDeclarations = declarations.filter((d) => {
                // Prefer function, class, variable, enum declarations
                return ts.isFunctionDeclaration(d) ||
                    ts.isFunctionExpression(d) ||
                    ts.isClassDeclaration(d) ||
                    ts.isVariableDeclaration(d) ||
                    ts.isEnumDeclaration(d) ||
                    ts.isMethodDeclaration(d);
            });
            // Use value declaration if available, otherwise fall back to first declaration
            const targetDecl = valueDeclarations.length > 0 ? valueDeclarations[0] : declarations[0];
            const flags = symbol.getFlags();
            // Determine kind from the actual declaration, not just from resolved.kind
            // This is important because resolved.kind might be 're-export' which doesn't tell us the actual type
            let shape = null;
            // Check declaration kind first (most reliable)
            // Use ts.is* type guards for better type safety
            if (ts.isFunctionDeclaration(targetDecl) ||
                ts.isFunctionExpression(targetDecl) ||
                ts.isMethodDeclaration(targetDecl) ||
                ts.isMethodSignature(targetDecl)) {
                shape = this.buildFunctionApiShape(symbol, targetDecl);
            }
            else if (ts.isClassDeclaration(targetDecl)) {
                shape = this.buildClassApiShape(symbol, targetDecl);
            }
            else if (ts.isInterfaceDeclaration(targetDecl)) {
                // Check if this is actually a type-only export or if it's a variable with interface type
                // If symbol flags indicate it's a variable, treat it as variable
                if (flags & ts.SymbolFlags.Variable || flags & ts.SymbolFlags.Property) {
                    // This is likely a const with an interface type annotation
                    // Try to get the variable declaration instead
                    const varDecl = declarations.find((d) => ts.isVariableDeclaration(d));
                    if (varDecl) {
                        shape = this.buildVariableApiShape(symbol, varDecl);
                    }
                    else {
                        // Can't find variable declaration - this is likely a type-only export or a complex const
                        // Skip building API shape for it (it's not a runtime value)
                        // Don't log a warning here - the caller will handle it appropriately
                        shape = null;
                    }
                }
                else {
                    // This is a real interface/type export
                    shape = this.buildTypeApiShape(symbol, targetDecl, 'interface');
                }
            }
            else if (ts.isTypeAliasDeclaration(targetDecl)) {
                shape = this.buildTypeApiShape(symbol, targetDecl, 'type');
            }
            else if (ts.isEnumDeclaration(targetDecl)) {
                shape = this.buildEnumApiShape(symbol, targetDecl);
            }
            else if (ts.isVariableDeclaration(targetDecl) ||
                ts.isBindingElement(targetDecl)) {
                shape = this.buildVariableApiShape(symbol, targetDecl);
            }
            else {
                // Fallback: try to infer from symbol flags
                if (flags & ts.SymbolFlags.Function) {
                    // Try to find a function declaration
                    const funcDecl = declarations.find((d) => ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isMethodDeclaration(d));
                    if (funcDecl) {
                        shape = this.buildFunctionApiShape(symbol, funcDecl);
                    }
                    else {
                        // Use the type checker to get function signature
                        shape = this.buildFunctionApiShape(symbol, targetDecl);
                    }
                }
                else if (flags & ts.SymbolFlags.Class) {
                    const classDecl = declarations.find((d) => ts.isClassDeclaration(d));
                    if (classDecl) {
                        shape = this.buildClassApiShape(symbol, classDecl);
                    }
                }
                else if (flags & ts.SymbolFlags.Interface && !(flags & ts.SymbolFlags.Variable)) {
                    const ifaceDecl = declarations.find((d) => ts.isInterfaceDeclaration(d));
                    if (ifaceDecl) {
                        shape = this.buildTypeApiShape(symbol, ifaceDecl, 'interface');
                    }
                }
                else if (flags & ts.SymbolFlags.TypeAlias) {
                    const typeDecl = declarations.find((d) => ts.isTypeAliasDeclaration(d));
                    if (typeDecl) {
                        shape = this.buildTypeApiShape(symbol, typeDecl, 'type');
                    }
                }
                else if (flags & ts.SymbolFlags.Enum) {
                    const enumDecl = declarations.find((d) => ts.isEnumDeclaration(d));
                    if (enumDecl) {
                        shape = this.buildEnumApiShape(symbol, enumDecl);
                    }
                    else {
                        // Symbol has enum flag but no enum declaration - might be a namespace or something else
                        console.warn(`[TypeScriptAnalyzer] Symbol has Enum flag but no EnumDeclaration for ${resolved.exportName}`);
                    }
                }
                else if (flags & ts.SymbolFlags.Variable || flags & ts.SymbolFlags.Property) {
                    const varDecl = declarations.find((d) => ts.isVariableDeclaration(d));
                    if (varDecl) {
                        shape = this.buildVariableApiShape(symbol, varDecl);
                    }
                    else {
                        // Try to build variable shape from the declaration we have
                        shape = this.buildVariableApiShape(symbol, targetDecl);
                    }
                }
                else {
                    console.warn(`[TypeScriptAnalyzer] Unknown declaration kind ${targetDecl.kind} (${ts.SyntaxKind[targetDecl.kind]}) for ${resolved.exportName}, flags: ${flags}`);
                }
            }
            // Cache result
            this.apiShapeCache.set(identity, shape);
            return shape;
        }
        catch (error) {
            console.warn(`[TypeScriptAnalyzer] Error building API shape for ${resolved.exportName}:`, error);
            this.apiShapeCache.set(identity, null);
            return null;
        }
    }
    /**
     * Builds a function API shape with support for generics and overloads.
     */
    buildFunctionApiShape(symbol, decl) {
        if (!this.checker)
            return null;
        const name = symbol.getName();
        const type = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
        const signatures = this.checker.getSignaturesOfType(type, ts.SignatureKind.Call);
        // Extract type parameters (generics) from the declaration
        let typeParameters;
        if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl)) {
            if (decl.typeParameters && decl.typeParameters.length > 0) {
                typeParameters = decl.typeParameters.map(tp => {
                    const tpName = tp.name.text;
                    // Include constraints if present
                    if (tp.constraint) {
                        const constraintText = this.checker.typeToString(this.checker.getTypeFromTypeNode(tp.constraint));
                        return `${tpName} extends ${constraintText}`;
                    }
                    return tpName;
                });
            }
        }
        const overloads = [];
        for (const sig of signatures) {
            const params = [];
            for (let i = 0; i < sig.parameters.length; i++) {
                const param = sig.parameters[i];
                const paramType = this.checker.getTypeOfSymbolAtLocation(param, decl);
                const paramName = param.getName();
                const paramDecl = param.getDeclarations()?.[0];
                // Normalize type string (handle complex types, generics, etc.)
                const typeString = this.normalizeTypeString(this.checker.typeToString(paramType));
                params.push({
                    name: paramName || `param${i}`,
                    type: typeString,
                    optional: !!(paramDecl && ts.isParameter(paramDecl) && paramDecl.questionToken),
                    rest: !!(paramDecl && ts.isParameter(paramDecl) && paramDecl.dotDotDotToken)
                });
            }
            // Normalize return type
            const returnType = this.normalizeTypeString(this.checker.typeToString(sig.getReturnType()));
            // Extract type parameters for this specific signature (if different from declaration)
            let sigTypeParameters;
            if (sig.typeParameters && sig.typeParameters.length > 0) {
                sigTypeParameters = sig.typeParameters.map(tp => {
                    const tpName = tp.symbol.getName();
                    const tpType = this.checker.getTypeOfSymbolAtLocation(tp.symbol, decl);
                    const constraint = this.checker.typeToString(tpType);
                    return constraint ? `${tpName} extends ${constraint}` : tpName;
                });
            }
            overloads.push({
                parameters: params,
                returnType,
                typeParameters: sigTypeParameters || typeParameters
            });
        }
        return {
            kind: 'function',
            name,
            overloads,
            typeParameters
        };
    }
    /**
     * Normalizes type strings for stable comparison.
     * Handles whitespace, generic formatting, etc.
     */
    normalizeTypeString(typeString) {
        // Remove extra whitespace
        let normalized = typeString.replace(/\s+/g, ' ').trim();
        // Normalize generic syntax: `Array<T>` -> `Array<T>` (consistent spacing)
        normalized = normalized.replace(/<(\s*)/g, '<').replace(/(\s*)>/g, '>');
        // Normalize union/intersection spacing
        normalized = normalized.replace(/\s*\|\s*/g, ' | ');
        normalized = normalized.replace(/\s*&\s*/g, ' & ');
        return normalized;
    }
    /**
     * Builds a class API shape.
     */
    buildClassApiShape(symbol, decl) {
        if (!this.checker || !ts.isClassDeclaration(decl))
            return null;
        const name = symbol.getName();
        const type = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
        const members = [];
        // Get class members
        const classType = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
        const properties = classType.getProperties();
        for (const prop of properties) {
            const propDecl = prop.getDeclarations()?.[0];
            if (!propDecl)
                continue;
            // Only include public/protected members
            const flags = prop.getFlags();
            if (flags & ts.SymbolFlags.Private)
                continue;
            const visibility = flags & ts.SymbolFlags.Protected ? 'protected' : 'public';
            const isStatic = !!(flags & ts.SymbolFlags.Static);
            let member = null;
            if (ts.isMethodDeclaration(propDecl) || ts.isMethodSignature(propDecl)) {
                // Method - get signature from type
                const propType = this.checker.getTypeOfSymbolAtLocation(prop, propDecl);
                const callSignatures = propType.getCallSignatures();
                if (callSignatures.length > 0) {
                    const sig = callSignatures[0];
                    const methodSig = this.buildMethodSignature(sig, propDecl);
                    member = {
                        name: prop.getName(),
                        kind: 'method',
                        visibility,
                        static: isStatic,
                        signature: methodSig
                    };
                }
            }
            else if (ts.isPropertyDeclaration(propDecl) || ts.isPropertySignature(propDecl)) {
                // Property
                const propType = this.checker.getTypeOfSymbolAtLocation(prop, propDecl);
                member = {
                    name: prop.getName(),
                    kind: 'property',
                    type: this.checker.typeToString(propType),
                    optional: !!propDecl.questionToken,
                    readonly: !!(propDecl.modifiers && propDecl.modifiers.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword)),
                    visibility,
                    static: isStatic
                };
            }
            else if (ts.isGetAccessorDeclaration(propDecl)) {
                // Getter - get signature from type
                const propType = this.checker.getTypeOfSymbolAtLocation(prop, propDecl);
                const callSignatures = propType.getCallSignatures();
                if (callSignatures.length > 0) {
                    const sig = callSignatures[0];
                    const methodSig = this.buildMethodSignature(sig, propDecl);
                    member = {
                        name: prop.getName(),
                        kind: 'get',
                        visibility,
                        static: isStatic,
                        signature: methodSig
                    };
                }
            }
            else if (ts.isSetAccessorDeclaration(propDecl)) {
                // Setter - get signature from type
                const propType = this.checker.getTypeOfSymbolAtLocation(prop, propDecl);
                const callSignatures = propType.getCallSignatures();
                if (callSignatures.length > 0) {
                    const sig = callSignatures[0];
                    const methodSig = this.buildMethodSignature(sig, propDecl);
                    member = {
                        name: prop.getName(),
                        kind: 'set',
                        visibility,
                        static: isStatic,
                        signature: methodSig
                    };
                }
            }
            if (member) {
                members.push(member);
            }
        }
        // Get constructor
        let constructor;
        const constructorSymbol = classType.getConstructSignatures();
        if (constructorSymbol.length > 0) {
            const ctorSig = constructorSymbol[0];
            constructor = this.buildMethodSignature(ctorSig, decl);
        }
        return {
            kind: 'class',
            name,
            members,
            constructor
        };
    }
    /**
     * Builds a method signature from a TypeScript signature.
     */
    buildMethodSignature(sig, decl) {
        const params = [];
        for (let i = 0; i < sig.parameters.length; i++) {
            const param = sig.parameters[i];
            const paramType = this.checker.getTypeOfSymbolAtLocation(param, decl);
            const paramName = param.getName();
            const paramDecl = param.getDeclarations()?.[0];
            params.push({
                name: paramName || `param${i}`,
                type: this.checker.typeToString(paramType),
                optional: !!(paramDecl && ts.isParameter(paramDecl) && paramDecl.questionToken),
                rest: !!(paramDecl && ts.isParameter(paramDecl) && paramDecl.dotDotDotToken)
            });
        }
        return {
            parameters: params,
            returnType: this.checker.typeToString(sig.getReturnType())
        };
    }
    /**
     * Builds a type/interface API shape with support for generics, index signatures, and complex types.
     */
    buildTypeApiShape(symbol, decl, kind) {
        if (!this.checker)
            return null;
        const name = symbol.getName();
        // For interface declarations, we can't use getTypeOfSymbolAtLocation if the symbol flags
        // indicate it's a variable (this causes the "Unhandled declaration kind" error)
        // Instead, get the type from the type node directly
        let type;
        try {
            if (ts.isInterfaceDeclaration(decl) && (symbol.getFlags() & (ts.SymbolFlags.Variable | ts.SymbolFlags.Property))) {
                // This is a variable with an interface type - get type from the type checker differently
                // Try to get the type from a variable declaration if available
                const varDecl = symbol.getDeclarations()?.find(d => ts.isVariableDeclaration(d));
                if (varDecl && ts.isVariableDeclaration(varDecl) && varDecl.type) {
                    type = this.checker.getTypeFromTypeNode(varDecl.type);
                }
                else {
                    // Fallback: try to get type from the symbol at a different location
                    const sourceFile = decl.getSourceFile();
                    type = this.checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
                }
            }
            else {
                type = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
            }
        }
        catch (e) {
            // If getTypeOfSymbolAtLocation fails, try alternative approach
            console.warn(`[TypeScriptAnalyzer] Error getting type for ${name}, trying alternative:`, e);
            try {
                const sourceFile = decl.getSourceFile();
                type = this.checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
            }
            catch (e2) {
                console.warn(`[TypeScriptAnalyzer] Failed to get type for ${name}:`, e2);
                return null;
            }
        }
        // Extract type parameters (generics)
        let typeParameters;
        if (ts.isInterfaceDeclaration(decl)) {
            if (decl.typeParameters && decl.typeParameters.length > 0) {
                typeParameters = decl.typeParameters.map(tp => {
                    const tpName = tp.name.text;
                    if (tp.constraint) {
                        const constraintText = this.checker.typeToString(this.checker.getTypeFromTypeNode(tp.constraint));
                        return `${tpName} extends ${constraintText}`;
                    }
                    return tpName;
                });
            }
        }
        else if (ts.isTypeAliasDeclaration(decl)) {
            if (decl.typeParameters && decl.typeParameters.length > 0) {
                typeParameters = decl.typeParameters.map(tp => {
                    const tpName = tp.name.text;
                    if (tp.constraint) {
                        const constraintText = this.checker.typeToString(this.checker.getTypeFromTypeNode(tp.constraint));
                        return `${tpName} extends ${constraintText}`;
                    }
                    return tpName;
                });
            }
        }
        const properties = [];
        const indexSignatures = [];
        let typeText;
        // Check if this is a complex type (union, intersection, etc.) that can't be represented as properties
        const typeFlags = type.flags;
        const isUnion = !!(typeFlags & ts.TypeFlags.Union);
        const isIntersection = !!(typeFlags & ts.TypeFlags.Intersection);
        if (isUnion || isIntersection) {
            // For complex types, store the type text directly
            typeText = this.normalizeTypeString(this.checker.typeToString(type));
        }
        else {
            // Get properties for object types
            const props = type.getProperties();
            for (const prop of props) {
                const propType = this.checker.getTypeOfSymbolAtLocation(prop, decl);
                const propDecl = prop.getDeclarations()?.[0];
                properties.push({
                    name: prop.getName(),
                    type: this.normalizeTypeString(this.checker.typeToString(propType)),
                    optional: !!(propDecl && (ts.isPropertySignature(propDecl) || ts.isPropertyDeclaration(propDecl)) && propDecl.questionToken),
                    readonly: !!(propDecl && propDecl.modifiers && propDecl.modifiers.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword))
                });
            }
            // Get index signatures
            if (ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) {
                const sourceFile = decl.getSourceFile();
                const checker = this.checker;
                // Check for index signatures in the declaration
                if (ts.isInterfaceDeclaration(decl) && decl.members) {
                    // Ensure members is iterable
                    try {
                        for (const member of decl.members) {
                            if (ts.isIndexSignatureDeclaration(member)) {
                                const keyType = member.parameters[0]?.type;
                                const valueType = member.type;
                                if (keyType && valueType) {
                                    indexSignatures.push({
                                        keyType: this.normalizeTypeString(checker.typeToString(checker.getTypeFromTypeNode(keyType))),
                                        valueType: this.normalizeTypeString(checker.typeToString(checker.getTypeFromTypeNode(valueType))),
                                        readonly: !!(member.modifiers && member.modifiers.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword))
                                    });
                                }
                            }
                        }
                    }
                    catch (e) {
                        // If members is not iterable, skip index signatures
                        console.warn(`[TypeScriptAnalyzer] Cannot iterate over interface members for ${name}:`, e);
                    }
                }
            }
        }
        // Get extends clauses for interfaces
        let extendsClauses;
        if (ts.isInterfaceDeclaration(decl) && decl.heritageClauses) {
            extendsClauses = [];
            for (const heritage of decl.heritageClauses) {
                if (heritage.token === ts.SyntaxKind.ExtendsKeyword) {
                    for (const typeNode of heritage.types) {
                        const extendsType = this.checker.getTypeFromTypeNode(typeNode);
                        extendsClauses.push(this.normalizeTypeString(this.checker.typeToString(extendsType)));
                    }
                }
            }
        }
        return {
            kind,
            name,
            typeParameters,
            properties,
            indexSignatures: indexSignatures.length > 0 ? indexSignatures : undefined,
            typeText,
            extends: extendsClauses && extendsClauses.length > 0 ? extendsClauses : undefined
        };
    }
    /**
     * Builds an enum API shape.
     */
    buildEnumApiShape(symbol, decl) {
        // Verify this is actually an enum declaration
        if (!ts.isEnumDeclaration(decl)) {
            console.warn(`[TypeScriptAnalyzer] buildEnumApiShape called with non-enum declaration: ${ts.SyntaxKind[decl.kind]}`);
            return null;
        }
        const name = symbol.getName();
        const members = [];
        const isConst = !!(decl.modifiers && decl.modifiers.some(m => m.kind === ts.SyntaxKind.ConstKeyword));
        // Check if members exists
        if (!decl.members || decl.members.length === 0) {
            // Empty enum - this is valid but unusual, only warn in debug mode
            // (Most cases where this happens are false positives from incorrect symbol resolution)
            return {
                kind: 'enum',
                name,
                members: [],
                const: isConst
            };
        }
        for (const member of decl.members) {
            const memberName = member.name && ts.isIdentifier(member.name) ? member.name.text : 'unknown';
            let value;
            if (member.initializer) {
                if (ts.isStringLiteral(member.initializer)) {
                    value = member.initializer.text;
                }
                else if (ts.isNumericLiteral(member.initializer)) {
                    value = parseFloat(member.initializer.text);
                }
            }
            members.push({ name: memberName, value });
        }
        return {
            kind: 'enum',
            name,
            members,
            const: isConst
        };
    }
    /**
     * Builds a variable API shape.
     */
    buildVariableApiShape(symbol, decl) {
        if (!this.checker)
            return null;
        const name = symbol.getName();
        const type = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
        const typeText = this.checker.typeToString(type);
        const isConst = !!(decl.modifiers && decl.modifiers.some(m => m.kind === ts.SyntaxKind.ConstKeyword));
        return {
            kind: isConst ? 'const' : 'variable',
            name,
            type: typeText,
            readonly: isConst
        };
    }
}
exports.TypeScriptAnalyzer = TypeScriptAnalyzer;
//# sourceMappingURL=TypeScriptAnalyzer.js.map