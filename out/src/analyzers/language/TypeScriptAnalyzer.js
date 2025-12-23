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
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
exports.TypeScriptAnalyzer = TypeScriptAnalyzer;
//# sourceMappingURL=TypeScriptAnalyzer.js.map