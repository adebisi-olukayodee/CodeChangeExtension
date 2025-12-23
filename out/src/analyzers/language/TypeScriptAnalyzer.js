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
        this.projectRoot = projectRoot || null;
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
        // Initialize TypeScript program and type checker
        this.initializeTypeChecker();
    }
    initializeTypeChecker() {
        try {
            // Create a TypeScript program with empty files initially
            // It will be populated as files are analyzed
            this.program = ts.createProgram([], {
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.CommonJS,
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true
            });
            this.checker = this.program.getTypeChecker();
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
            // Create new TypeScript program with all files
            if (filePaths.length > 0) {
                this.program = ts.createProgram(filePaths, {
                    target: ts.ScriptTarget.ES2020,
                    module: ts.ModuleKind.CommonJS,
                    strict: true,
                    esModuleInterop: true,
                    skipLibCheck: true
                });
                this.checker = this.program.getTypeChecker();
            }
        }
        catch (error) {
            console.error('Error updating TypeScript program:', error);
        }
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
            // Extract exports
            const exportDeclarations = sourceFile.getExportedDeclarations();
            const defaultExport = sourceFile.getDefaultExportSymbol();
            console.log(`[TypeScriptAnalyzer] Found ${exportDeclarations.size} exported declaration groups`);
            for (const [name, declarations] of exportDeclarations) {
                console.log(`[TypeScriptAnalyzer]   - Export: ${name} (${declarations.length} declarations)`);
                for (const decl of declarations) {
                    const isDefault = defaultExport?.getName() === name;
                    const exportInfo = {
                        name,
                        type: isDefault ? 'default' : 'named',
                        kind: this.getDeclarationKind(decl),
                        line: decl.getStartLineNumber()
                    };
                    exports.push(exportInfo);
                }
            }
            // Extract re-exports (export { x } from './module' or export { x as y } from './module')
            const exportStatements = sourceFile.getExportDeclarations();
            for (const exportStmt of exportStatements) {
                const moduleSpecifier = exportStmt.getModuleSpecifierValue();
                if (moduleSpecifier) {
                    // This is a re-export
                    const namedExports = exportStmt.getNamedExports();
                    for (const namedExport of namedExports) {
                        const exportedName = namedExport.getName();
                        const alias = namedExport.getAliasNode()?.getText();
                        const exportInfo = {
                            name: alias || exportedName,
                            type: 'named',
                            kind: 're-export',
                            line: exportStmt.getStartLineNumber(),
                            sourceModule: moduleSpecifier,
                            exportedName: exportedName,
                            localName: alias || undefined // Local alias if exists
                        };
                        exports.push(exportInfo);
                    }
                }
            }
            // Handle default export separately if exists
            if (defaultExport) {
                const defaultExportDecl = sourceFile.getDefaultExportSymbol()?.getValueDeclaration();
                if (defaultExportDecl) {
                    const node = this.project.getSourceFile(normalizedPath)?.getDefaultExportSymbol()?.getValueDeclaration();
                    if (node) {
                        const exportInfo = {
                            name: 'default',
                            type: 'default',
                            kind: this.getDeclarationKind(node),
                            line: node.getStartLineNumber?.() || 0
                        };
                        exports.push(exportInfo);
                    }
                }
            }
            // Extract imports
            const importDeclarations = sourceFile.getImportDeclarations();
            console.log(`[TypeScriptAnalyzer] Found ${importDeclarations.length} import declarations`);
            for (const importDecl of importDeclarations) {
                const moduleSpecifier = importDecl.getModuleSpecifierValue();
                if (moduleSpecifier) {
                    console.log(`[TypeScriptAnalyzer]   - Import from: ${moduleSpecifier}`);
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
            console.log(`[TypeScriptAnalyzer] Snapshot summary:`);
            console.log(`[TypeScriptAnalyzer]   - Functions: ${functions.length}`);
            console.log(`[TypeScriptAnalyzer]   - Classes: ${classes.length}`);
            console.log(`[TypeScriptAnalyzer]   - Interfaces: ${interfaces.length}`);
            console.log(`[TypeScriptAnalyzer]   - Type aliases: ${typeAliases.length}`);
            console.log(`[TypeScriptAnalyzer]   - Enums: ${enums.length}`);
            console.log(`[TypeScriptAnalyzer]   - Exports: ${exports.length}`);
            console.log(`[TypeScriptAnalyzer]   - Imports: ${imports.length}`);
            if (functions.length > 0) {
                console.log(`[TypeScriptAnalyzer] Function details:`);
                functions.forEach(f => {
                    console.log(`[TypeScriptAnalyzer]   - ${f.qualifiedName} (${f.kind}) at line ${f.line}, signature: ${f.signature}`);
                });
            }
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
        // Compare functions
        const beforeFuncs = createSymbolMap(beforeSnapshot.functions);
        const afterFuncs = createSymbolMap(afterSnapshot.functions);
        this.compareSymbols(beforeFuncs, afterFuncs, 'function', changedSymbols, added, removed, modified);
        // Compare classes
        const beforeClasses = createSymbolMap(beforeSnapshot.classes);
        const afterClasses = createSymbolMap(afterSnapshot.classes);
        this.compareSymbols(beforeClasses, afterClasses, 'class', changedSymbols, added, removed, modified);
        // Compare interfaces
        const beforeInterfaces = createSymbolMap(beforeSnapshot.interfaces);
        const afterInterfaces = createSymbolMap(afterSnapshot.interfaces);
        this.compareSymbols(beforeInterfaces, afterInterfaces, 'interface', changedSymbols, added, removed, modified);
        // Compare type aliases
        const beforeTypes = createSymbolMap(beforeSnapshot.typeAliases);
        const afterTypes = createSymbolMap(afterSnapshot.typeAliases);
        this.compareSymbols(beforeTypes, afterTypes, 'type', changedSymbols, added, removed, modified);
        // Compare enums
        const beforeEnums = createSymbolMap(beforeSnapshot.enums);
        const afterEnums = createSymbolMap(afterSnapshot.enums);
        this.compareSymbols(beforeEnums, afterEnums, 'enum', changedSymbols, added, removed, modified);
        // Compare exports
        const exportChanges = this.compareExports(beforeSnapshot.exports, afterSnapshot.exports);
        return {
            changedSymbols,
            added,
            removed,
            modified,
            exportChanges
        };
    }
    compareSymbols(beforeMap, afterMap, kind, changedSymbols, added, removed, modified) {
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
        for (const [name, beforeSymbol] of beforeMap) {
            if (!afterMap.has(name)) {
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
                if ((kind === 'function' || kind === 'method') && (beforeSymbol.overloads || afterSymbol.overloads)) {
                    const beforeOverloads = new Set(beforeSymbol.overloads || []);
                    const afterOverloads = new Set(afterSymbol.overloads || []);
                    // Check if overload set changed
                    if (beforeOverloads.size !== afterOverloads.size ||
                        ![...beforeOverloads].every(ov => afterOverloads.has(ov))) {
                        const change = {
                            symbol: afterSymbol,
                            changeType: 'signature-changed',
                            before: beforeSymbol,
                            after: afterSymbol,
                            severity: afterSymbol.isExported ? 'high' : 'medium',
                            isBreaking: afterSymbol.isExported,
                            metadata: {
                                ruleId: 'TSAPI-FN-007',
                                message: `Function overload set changed (${beforeOverloads.size} → ${afterOverloads.size} overloads)`
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
        const beforeProps = before.metadata?.properties;
        const afterProps = after.metadata?.properties;
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
                    ruleId: 'TSAPI-IF-001',
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
                        ruleId: 'TSAPI-IF-002',
                        message: `Property '${propName}' changed from optional to required`
                    };
                }
                // Type changed
                if (beforeProp.type !== afterProp.type) {
                    return {
                        changeType: 'type-changed',
                        isBreaking: true,
                        ruleId: 'TSAPI-IF-003',
                        message: `Property '${propName}' type changed from '${beforeProp.type}' to '${afterProp.type}'`
                    };
                }
            }
        }
        return null;
    }
    compareExports(beforeExports, afterExports) {
        // Create map using name + sourceModule for re-exports to handle re-export changes
        const createExportKey = (e) => e.sourceModule ? `${e.name}:${e.sourceModule}` : e.name;
        const beforeMap = new Map(beforeExports.map(e => [createExportKey(e), e]));
        const afterMap = new Map(afterExports.map(e => [createExportKey(e), e]));
        const added = [];
        const removed = [];
        const modified = [];
        for (const [key, afterExport] of afterMap) {
            if (!beforeMap.has(key)) {
                added.push(afterExport);
            }
            else {
                const beforeExport = beforeMap.get(key);
                // Check for re-export changes (sourceModule, exportedName, localName)
                if (beforeExport.sourceModule !== afterExport.sourceModule ||
                    beforeExport.exportedName !== afterExport.exportedName ||
                    beforeExport.localName !== afterExport.localName ||
                    beforeExport.type !== afterExport.type ||
                    beforeExport.kind !== afterExport.kind) {
                    modified.push(afterExport);
                }
            }
        }
        for (const [key, beforeExport] of beforeMap) {
            if (!afterMap.has(key)) {
                removed.push(beforeExport);
            }
        }
        return { added, removed, modified };
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
        const overloads = [];
        if (func instanceof ts_morph_1.FunctionDeclaration) {
            // Get all overload signatures (excluding the implementation)
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
                properties: properties.map(p => p.name)
            }
        };
    }
    createTypeAliasSymbolInfo(typeAlias) {
        const name = typeAlias.getName();
        const typeNode = typeAlias.getTypeNode();
        return {
            name,
            qualifiedName: name,
            line: typeAlias.getStartLineNumber(),
            column: typeAlias.getStartLineNumber(true),
            signature: `type ${name} = ${typeNode?.getText() || 'unknown'}`,
            isExported: typeAlias.isExported(),
            kind: 'type',
            metadata: {
                typeText: typeNode?.getText()
            }
        };
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
        if (decl.getKindName() === 'FunctionDeclaration')
            return 'function';
        if (decl.getKindName() === 'ClassDeclaration')
            return 'class';
        if (decl.getKindName() === 'InterfaceDeclaration')
            return 'interface';
        if (decl.getKindName() === 'TypeAliasDeclaration')
            return 'type';
        if (decl.getKindName() === 'EnumDeclaration')
            return 'enum';
        if (decl.getKindName() === 'VariableDeclaration')
            return 'variable';
        return 'unknown';
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
}
exports.TypeScriptAnalyzer = TypeScriptAnalyzer;
//# sourceMappingURL=TypeScriptAnalyzer.js.map