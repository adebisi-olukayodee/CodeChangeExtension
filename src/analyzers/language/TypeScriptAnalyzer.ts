/**
 * TypeScript-specific analyzer using TypeScript AST + Type Checker.
 * This analyzer properly leverages TypeScript's compiler API for type-aware analysis.
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { Project, SourceFile, Node, FunctionDeclaration, ClassDeclaration, MethodDeclaration, ArrowFunction, InterfaceDeclaration, TypeAliasDeclaration, EnumDeclaration } from 'ts-morph';
import {
    ILanguageAnalyzer,
    LanguageAnalysisResult,
    CodeElement,
    ClassElement,
    Parameter,
    Property
} from '../ILanguageAnalyzer';
import {
    SymbolSnapshot,
    SymbolInfo,
    ParameterInfo,
    ExportInfo,
    ImportInfo,
    TypeInfo,
    SymbolChange,
    SnapshotDiff,
    ExportChange
} from './SymbolSnapshot';

export class TypeScriptAnalyzer implements ILanguageAnalyzer {
    private project: Project;
    private program: ts.Program | null = null;
    private checker: ts.TypeChecker | null = null;
    private projectRoot: string | null = null;

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot || null;
        
        // Initialize ts-morph project
        this.project = new Project({
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

    private initializeTypeChecker(): void {
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
        } catch (error) {
            console.error('Failed to initialize TypeScript type checker:', error);
            this.checker = null;
        }
    }

    getLanguage(): string {
        return 'typescript';
    }

    getSupportedExtensions(): string[] {
        return ['.ts', '.tsx'];
    }

    async analyze(filePath: string, content: string): Promise<LanguageAnalysisResult> {
        try {
            console.log(`[TypeScriptAnalyzer] Analyzing file: ${filePath}`);
            console.log(`[TypeScriptAnalyzer] Type checker available: ${this.checker !== null}`);
            
            // Add or update file in ts-morph project
            let sourceFile: SourceFile;
            if (this.project.getSourceFile(filePath)) {
                sourceFile = this.project.getSourceFile(filePath)!;
                sourceFile.replaceWithText(content);
                console.log(`[TypeScriptAnalyzer] Updated existing source file in project`);
            } else {
                sourceFile = this.project.createSourceFile(filePath, content);
                console.log(`[TypeScriptAnalyzer] Created new source file in project`);
            }

            // Update TypeScript program to include this file
            this.updateTypeScriptProgram();
            console.log(`[TypeScriptAnalyzer] TypeScript program updated, type checker: ${this.checker !== null}`);

            const functions: CodeElement[] = [];
            const classes: ClassElement[] = [];
            const imports: string[] = [];
            const exports: string[] = [];
            const modules: string[] = [];

            // Extract functions
            const functionDeclarations = sourceFile.getFunctions();
            for (const func of functionDeclarations) {
                const element: CodeElement = {
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
                        const element: CodeElement = {
                            name,
                            line: varDecl.getStartLineNumber(),
                            column: varDecl.getStartLineNumber(true),
                            signature: `${name}()`, // Simplified signature
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
                const methods: CodeElement[] = [];
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

                const properties: Property[] = [];
                const classProperties = cls.getProperties();
                for (const prop of classProperties) {
                    properties.push({
                        name: prop.getName(),
                        type: prop.getTypeNode()?.getText() || 'any',
                        isOptional: prop.hasQuestionToken(),
                        isReadonly: prop.isReadonly()
                    });
                }

                const classElement: ClassElement = {
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
                .filter((spec): spec is string => !!spec);
            modules.push(...moduleSpecifiers);

            return {
                functions,
                classes,
                imports,
                exports,
                modules
            };
        } catch (error) {
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

    async findReferences(
        symbolName: string,
        filePath: string,
        projectRoot: string
    ): Promise<string[]> {
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
            const references: string[] = [];
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
                            if (sf.getFilePath() === filePath) continue;
                            
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
            } catch (error) {
                console.error('Error using type checker for references:', error);
            }

            return [...new Set(references)];
        } catch (error) {
            console.error(`Error finding references for ${symbolName}:`, error);
            return this.findReferencesFallback(symbolName, projectRoot);
        }
    }

    async fileUsesSymbol(
        filePath: string,
        symbolName: string,
        projectRoot: string
    ): Promise<boolean> {
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
                new RegExp(`\\b${this.escapeRegex(symbolName)}\\s*\\(`, 'g'), // Function call
                new RegExp(`new\\s+${this.escapeRegex(symbolName)}\\s*\\(`, 'g'), // Constructor call
                new RegExp(`extends\\s+${this.escapeRegex(symbolName)}`, 'g'), // Class extension
                new RegExp(`implements\\s+.*\\b${this.escapeRegex(symbolName)}\\b`, 'g') // Interface implementation
            ];

            return patterns.some(pattern => pattern.test(content));
        } catch (error) {
            console.error(`Error checking if file uses symbol:`, error);
            return false;
        }
    }

    async findChangedElements(
        beforeContent: string,
        afterContent: string,
        filePath: string
    ): Promise<{ changedFunctions: string[]; changedClasses: string[] }> {
        const beforeAnalysis = await this.analyze(filePath, beforeContent);
        const afterAnalysis = await this.analyze(filePath, afterContent);

        const changedFunctions: string[] = [];
        const changedClasses: string[] = [];

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
            } else {
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

    private updateTypeScriptProgram(): void {
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
        } catch (error) {
            console.error('Error updating TypeScript program:', error);
        }
    }

    private findSymbolInFile(sourceFile: SourceFile, symbolName: string): Node | null {
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

    private findReferencesFallback(symbolName: string, projectRoot: string): string[] {
        const references: string[] = [];
        const escapedName = this.escapeRegex(symbolName);

        // Simple regex-based search
        function walkDir(dir: string): void {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    if (entry.isDirectory()) {
                        if (!['node_modules', '.git', 'dist', 'build', 'out'].includes(entry.name)) {
                            walkDir(fullPath);
                        }
                    } else if (entry.isFile()) {
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

        if (projectRoot && fs.existsSync(projectRoot)) {
            walkDir(projectRoot);
        }

        return [...new Set(references)];
    }

    private getFunctionSignature(func: FunctionDeclaration | MethodDeclaration): string {
        const name = func.getName() || 'anonymous';
        const params = func.getParameters().map(p => {
            const paramName = p.getName();
            const paramType = p.getTypeNode()?.getText() || 'any';
            const isOptional = p.hasQuestionToken();
            const defaultValue = p.getInitializer()?.getText();
            
            let signature = paramName;
            if (isOptional) signature += '?';
            signature += `: ${paramType}`;
            if (defaultValue) signature += ` = ${defaultValue}`;
            
            return signature;
        }).join(', ');

        return `${name}(${params})`;
    }

    private getArrowFunctionSignature(varDecl: any, arrowFunc: any): string {
        const name = varDecl.getName();
        const params = arrowFunc.getParameters().map((p: any) => {
            const paramName = p.getName();
            const paramType = p.getTypeNode()?.getText() || 'any';
            return `${paramName}: ${paramType}`;
        }).join(', ');
        return `${name}(${params})`;
    }

    private getReturnType(func: FunctionDeclaration | MethodDeclaration): string {
        return func.getReturnTypeNode()?.getText() || 'any';
    }

    private getArrowFunctionReturnType(arrowFunc: any): string {
        return arrowFunc.getReturnTypeNode()?.getText() || 'any';
    }

    private getParameters(func: FunctionDeclaration | MethodDeclaration): Parameter[] {
        return func.getParameters().map(p => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || 'any',
            optional: p.hasQuestionToken(),
            defaultValue: p.getInitializer()?.getText()
        }));
    }

    private getArrowFunctionParameters(arrowFunc: any): Parameter[] {
        return arrowFunc.getParameters().map((p: any) => ({
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
    async buildSnapshot(filePath: string, content: string): Promise<SymbolSnapshot> {
        console.log(`[TypeScriptAnalyzer] Building snapshot for: ${filePath}`);
        console.log(`[TypeScriptAnalyzer] Content length: ${content.length} chars`);
        console.log(`[TypeScriptAnalyzer] Content preview (first 200 chars): ${content.substring(0, 200).replace(/\n/g, '\\n')}`);
        
        try {
            // Normalize file path to absolute
            const normalizedPath = path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(filePath);
            console.log(`[TypeScriptAnalyzer] Normalized path: ${normalizedPath}`);
            
            // Add or update file in ts-morph project
            let sourceFile: SourceFile;
            const existingFile = this.project.getSourceFile(normalizedPath);
            if (existingFile) {
                console.log(`[TypeScriptAnalyzer] Updating existing source file`);
                sourceFile = existingFile;
                sourceFile.replaceWithText(content);
            } else {
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
            } else {
                console.log(`[TypeScriptAnalyzer] No syntax errors detected`);
            }

            // Update TypeScript program to include this file
            this.updateTypeScriptProgram();

            const functions: SymbolInfo[] = [];
            const classes: SymbolInfo[] = [];
            const interfaces: SymbolInfo[] = [];
            const typeAliases: SymbolInfo[] = [];
            const enums: SymbolInfo[] = [];
            const exports: ExportInfo[] = [];
            const imports: ImportInfo[] = [];
            const typeInfo = new Map<string, TypeInfo>();

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
                        const tsNode = func.compilerNode as unknown as ts.Node;
                        const symbolTypeInfo = this.getSymbolTypeInfo(tsNode);
                        if (symbolTypeInfo) {
                            typeInfo.set(symbolInfo.qualifiedName, symbolTypeInfo);
                        }
                    } catch {
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

            // Extract exports (but skip re-exports - they'll be handled separately)
            // getExportedDeclarations() can return re-exports as "variable" declarations, so we need to filter them out
            const exportDeclarations = sourceFile.getExportedDeclarations();
            const defaultExport = sourceFile.getDefaultExportSymbol();
            
            // First, collect all re-exported names to filter them out from getExportedDeclarations()
            const reExportedNames = new Set<string>();
            const allExportStatements = sourceFile.getExportDeclarations();
            for (const exportStmt of allExportStatements) {
                if (exportStmt.getModuleSpecifierValue()) {
                    // This is a re-export - collect all exported names
                    for (const namedExport of exportStmt.getNamedExports()) {
                        // Use compilerNode.name.text for the public name (after 'as')
                        const publicName = namedExport.compilerNode.name.text;
                        reExportedNames.add(publicName);
                    }
                }
            }
            
            console.log(`[TypeScriptAnalyzer] Found ${exportDeclarations.size} exported declaration groups (excluding ${reExportedNames.size} re-exports)`);
            for (const [name, declarations] of exportDeclarations) {
                // Skip if this is a re-export (will be handled separately)
                if (reExportedNames.has(name)) {
                    console.log(`[TypeScriptAnalyzer]   - Skipping re-export '${name}' from getExportedDeclarations()`);
                    continue;
                }
                console.log(`[TypeScriptAnalyzer]   - Export: ${name} (${declarations.length} declarations)`);
                for (const decl of declarations) {
                    const isDefault = defaultExport?.getName() === name;
                    const exportInfo: ExportInfo = {
                        name,
                        type: isDefault ? 'default' : 'named',
                        kind: this.getDeclarationKind(decl),
                        line: decl.getStartLineNumber()
                    };
                    exports.push(exportInfo);
                }
            }
            
            // Extract re-exports (export { x } from './module' or export { y as x } from './module')
            // In ts-morph: spec.name is the public name (after 'as'), spec.getAliasNode() gets the alias
            // But we need the propertyName (before 'as') which is the source name
            const exportStatements = sourceFile.getExportDeclarations();
            console.log(`[TypeScriptAnalyzer] Found ${exportStatements.length} export declarations`);
            for (const exportStmt of exportStatements) {
                const moduleSpecifier = exportStmt.getModuleSpecifierValue();
                console.log(`[TypeScriptAnalyzer]   Export declaration: hasModuleSpecifier=${!!moduleSpecifier}, moduleSpecifier='${moduleSpecifier}'`);
                if (moduleSpecifier) {
                    // This is a re-export
                    const namedExports = exportStmt.getNamedExports();
                    console.log(`[TypeScriptAnalyzer]   Re-export found: ${namedExports.length} named exports from '${moduleSpecifier}'`);
                    for (const namedExport of namedExports) {
                        // IMPORTANT: Use compilerNode.name.text for the public name (after 'as')
                        // getName() can return the wrong value in some cases
                        const compilerNode = namedExport.compilerNode;
                        const exportedName = compilerNode.name.text; // Public API name: 'x' in both "export { x }" and "export { y as x }"
                        
                        // Get the source name (propertyName - the name before 'as')
                        // propertyName exists when there's an alias: export { y as x } → propertyName='y', name='x'
                        // If no propertyName, it's export { x } → name='x', so sourceName='x'
                        const hasPropertyName = !!compilerNode.propertyName;
                        const sourceName = compilerNode.propertyName 
                            ? compilerNode.propertyName.text 
                            : compilerNode.name.text; // If no propertyName, use name (export { x } means sourceName = x)
                        
                        console.log(`[TypeScriptAnalyzer]   Re-export spec: exportedName='${exportedName}' (from compilerNode.name), hasPropertyName=${hasPropertyName}, sourceName='${sourceName}', getName()='${namedExport.getName()}'`);
                        
                        const exportInfo: ExportInfo = {
                            name: exportedName, // Public API name (what consumers see - 'x')
                            type: 'named',
                            kind: 're-export',
                            line: exportStmt.getStartLineNumber(),
                            sourceModule: moduleSpecifier,
                            sourceName: sourceName, // The actual name from source module ('x' or 'y')
                            // Keep deprecated fields for backward compatibility
                            exportedName: exportedName,
                            localName: sourceName !== exportedName ? sourceName : undefined
                        };
                        exports.push(exportInfo);
                        console.log(`[TypeScriptAnalyzer]   ✅ Re-export entry created: name='${exportInfo.name}', sourceModule='${exportInfo.sourceModule}', sourceName='${exportInfo.sourceName}'`);
                    }
                }
            }
            
            // Handle default export separately if exists
            if (defaultExport) {
                const defaultExportDecl = sourceFile.getDefaultExportSymbol()?.getValueDeclaration();
                if (defaultExportDecl) {
                    const node = this.project.getSourceFile(normalizedPath)?.getDefaultExportSymbol()?.getValueDeclaration();
                    if (node) {
                        const exportInfo: ExportInfo = {
                            name: 'default',
                            type: 'default',
                            kind: this.getDeclarationKind(node as Node),
                            line: (node as any).getStartLineNumber?.() || 0
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

                    const importInfo: ImportInfo = {
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
            
            // Sanity check: Log all exports, especially re-exports
            console.log(`[TypeScriptAnalyzer] Export entries captured:`);
            for (const exp of exports) {
                if (exp.kind === 're-export') {
                    console.log(`[TypeScriptAnalyzer]   ✅ Re-export: name='${exp.name}', sourceModule='${exp.sourceModule}', sourceName='${exp.sourceName}'`);
                } else {
                    console.log(`[TypeScriptAnalyzer]   - Export: name='${exp.name}', kind='${exp.kind}'`);
                }
            }
            
            // Specific check for common test symbols (for debugging S04)
            const xExport = exports.find(e => e.name === 'x');
            if (xExport) {
                console.log(`[TypeScriptAnalyzer] 🔍 Found export 'x': ${JSON.stringify({ name: xExport.name, kind: xExport.kind, sourceModule: xExport.sourceModule, sourceName: xExport.sourceName })}`);
            }
            
            // Debug: Log all exports for debugging
            console.log('[TypeScriptAnalyzer] Exports summary:', exports.map(v => ({
                name: v.name,
                kind: v.kind,
                from: v.sourceModule,
                source: v.sourceName,
            })));
            
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
        } catch (error) {
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
    async diffSnapshots(beforeSnapshot: SymbolSnapshot, afterSnapshot: SymbolSnapshot): Promise<SnapshotDiff> {
        console.log(`[TypeScriptAnalyzer] Diffing snapshots for: ${beforeSnapshot.filePath}`);
        
        const changedSymbols: SymbolChange[] = [];
        const added: SymbolInfo[] = [];
        const removed: SymbolInfo[] = [];
        const modified: SymbolChange[] = [];

        // Helper to create a map by qualified name
        const createSymbolMap = (symbols: SymbolInfo[]): Map<string, SymbolInfo> => {
            return new Map(symbols.map(s => [s.qualifiedName, s]));
        };

        // Build suppression set: removed exports (beforeExportNames - afterExportNames)
        // These symbols should only emit TSAPI-EXP-001, not function/class/type removal rules
        const beforeExportNames = new Set(beforeSnapshot.exports.map(e => e.name));
        const afterExportNames = new Set(afterSnapshot.exports.map(e => e.name));
        const removedExports = new Set<string>();
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
            exportChanges
        };
    }

    private compareSymbols(
        beforeMap: Map<string, SymbolInfo>,
        afterMap: Map<string, SymbolInfo>,
        kind: SymbolInfo['kind'],
        changedSymbols: SymbolChange[],
        added: SymbolInfo[],
        removed: SymbolInfo[],
        modified: SymbolChange[],
        suppressedSymbols: Set<string> = new Set()
    ): void {
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
                        
                        const change: SymbolChange = {
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
                        const change: SymbolChange = {
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
                        const methodSymbol: SymbolInfo = {
                            ...afterSymbol,
                            name: methodNameOnly,
                            qualifiedName: removedMethodQualifiedName || afterSymbol.qualifiedName,
                            kind: 'method', // Important: use 'method' not 'class' for proper grouping/UI
                            // Store container class name for reference
                            metadata: {
                                ...afterSymbol.metadata,
                                containerName: afterSymbol.name,
                                containerQualifiedName: afterSymbol.qualifiedName
                            }
                        };
                        
                        const change: SymbolChange = {
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
                        const change: SymbolChange = {
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
                        const beforeTypeText = beforeSymbol.metadata?.typeText as string | undefined;
                        const afterTypeText = afterSymbol.metadata?.typeText as string | undefined;
                        if (beforeTypeText && afterTypeText) {
                            // Use normalized comparison to handle formatting differences
                            const beforeNormalized = this.normalizeTypeText(beforeTypeText);
                            const afterNormalized = this.normalizeTypeText(afterTypeText);
                            if (beforeNormalized !== afterNormalized) {
                                const change: SymbolChange = {
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
                    const change: SymbolChange = {
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
                    const change: SymbolChange = {
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
    private detectParameterBreakingChange(
        before: SymbolInfo,
        after: SymbolInfo
    ): { changeType: SymbolChange['changeType']; isBreaking: boolean; ruleId: string; message: string } | null {
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
    private detectPropertyBreakingChange(
        before: SymbolInfo,
        after: SymbolInfo
    ): { changeType: SymbolChange['changeType']; isBreaking: boolean; ruleId: string; message: string } | null {
        // Determine if this is an interface or type alias to use the correct rule ID
        const isTypeAlias = before.kind === 'type' || after.kind === 'type';
        const beforeProps = before.metadata?.properties as Array<{ name: string; type: string; isOptional?: boolean }> | undefined;
        const afterProps = after.metadata?.properties as Array<{ name: string; type: string; isOptional?: boolean }> | undefined;

        // Check index signatures first (they affect all properties)
        const beforeIndexSigs = before.metadata?.indexSignatures as Array<{ keyType: string; valueType: string }> | undefined;
        const afterIndexSigs = after.metadata?.indexSignatures as Array<{ keyType: string; valueType: string }> | undefined;
        
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
            } else if (beforeSig && !afterSig) {
                // Index signature removed
                return {
                    changeType: 'signature-changed',
                    isBreaking: true,
                    ruleId: isTypeAlias ? 'TSAPI-TYPE-001' : 'TSAPI-IF-001',
                    message: `Index signature [${beforeSig.keyType}]: ${beforeSig.valueType} was removed`
                };
            } else if (!beforeSig && afterSig) {
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
    private detectClassMethodChange(
        before: SymbolInfo,
        after: SymbolInfo
    ): { changeType: SymbolChange['changeType']; isBreaking: boolean; ruleId: string; message: string; removedMethodName?: string } | null {
        const beforeMethods = (before.metadata?.methods as string[] | undefined) || [];
        const afterMethods = (after.metadata?.methods as string[] | undefined) || [];

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
    private getExportSignature(exp: ExportInfo): string {
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

    private compareExports(beforeExports: ExportInfo[], afterExports: ExportInfo[]): SnapshotDiff['exportChanges'] {
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
        const beforeMap = new Map<string, ExportInfo[]>();
        const afterMap = new Map<string, ExportInfo[]>();
        
        for (const exp of beforeExports) {
            if (!beforeMap.has(exp.name)) {
                beforeMap.set(exp.name, []);
            }
            beforeMap.get(exp.name)!.push(exp);
            const sig = this.getExportSignature(exp);
            console.log(`[TypeScriptAnalyzer] Before export '${exp.name}': signature='${sig}'`);
        }
        
        for (const exp of afterExports) {
            if (!afterMap.has(exp.name)) {
                afterMap.set(exp.name, []);
            }
            afterMap.get(exp.name)!.push(exp);
            const sig = this.getExportSignature(exp);
            console.log(`[TypeScriptAnalyzer] After export '${exp.name}': signature='${sig}'`);
        }
        
        console.log(`[TypeScriptAnalyzer] Maps built: before has ${beforeMap.size} unique names, after has ${afterMap.size} unique names`);

        const added: ExportInfo[] = [];
        const removed: ExportInfo[] = [];
        const modified: Array<ExportInfo | { before: ExportInfo; after: ExportInfo }> = [];

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
                    } else {
                        console.log(`[TypeScriptAnalyzer] Re-export '${name}' unchanged (signatures match)`);
                    }
                } else if (!beforeReexport && !afterReexport) {
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
                } else {
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
                const change = mod as { before: ExportInfo; after: ExportInfo };
                console.log(`[TypeScriptAnalyzer]   ✅ Modified (re-export): '${change.after.name}' (${change.before.sourceName} → ${change.after.sourceName})`);
            } else {
                const exp = mod as ExportInfo;
                console.log(`[TypeScriptAnalyzer]   Modified: '${exp.name}'`);
            }
        }
        
        console.log(`[TypeScriptAnalyzer] ========== compareExports END ==========`);

        return { 
            added, 
            removed, 
            modified: modified as SnapshotDiff['exportChanges']['modified'] // Type assertion for union type
        };
    }

    private createFunctionSymbolInfo(func: FunctionDeclaration | MethodDeclaration, parentClass: ClassDeclaration | null): SymbolInfo {
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
        const isExported = func instanceof FunctionDeclaration ? func.isExported() : false;

        // Extract overload signatures (for functions with overloads)
        // Use type checker for accurate call signature detection
        const overloads: string[] = [];
        if (func instanceof FunctionDeclaration) {
            // Try to use type checker for accurate call signatures
            if (this.checker && func.compilerNode) {
                try {
                    const symbol = this.checker.getSymbolAtLocation(func.compilerNode as unknown as ts.Node);
                    if (symbol) {
                        const type = this.checker.getTypeOfSymbolAtLocation(symbol, func.compilerNode as unknown as ts.Node);
                        const callSignatures = type.getCallSignatures();
                        
                        // Normalize each call signature into a stable key
                        for (const sig of callSignatures) {
                            const normalizedSig = this.normalizeCallSignature(sig);
                            if (normalizedSig) {
                                overloads.push(normalizedSig);
                            }
                        }
                    }
                } catch (error) {
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

    private createArrowFunctionSymbolInfo(varDecl: any, initializer: any): SymbolInfo {
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

    private createClassSymbolInfo(cls: ClassDeclaration): SymbolInfo {
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

    private createInterfaceSymbolInfo(intf: InterfaceDeclaration): SymbolInfo {
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

    private createTypeAliasSymbolInfo(typeAlias: TypeAliasDeclaration): SymbolInfo {
        const name = typeAlias.getName();
        const typeNode = typeAlias.getTypeNode();
        const typeText = this.normalizeTypeText(typeNode?.getText() || 'unknown');
        
        // Extract properties if this is an object type literal or intersection with object literals
        const properties: Array<{ name: string; type: string; isOptional?: boolean }> = [];
        const indexSignatures: Array<{ keyType: string; valueType: string }> = [];
        
        if (typeNode) {
            try {
                const compilerNode = typeNode.compilerNode as unknown as ts.Node;
                
                // Handle direct object type literal: type X = { a?: string }
                if (ts.isTypeLiteralNode(compilerNode)) {
                    this.extractPropertiesFromTypeLiteral(compilerNode, properties, indexSignatures);
                }
                // Handle intersection types: type X = A & { a?: string }
                else if (ts.isIntersectionTypeNode(compilerNode)) {
                    for (const type of compilerNode.types) {
                        if (ts.isTypeLiteralNode(type)) {
                            this.extractPropertiesFromTypeLiteral(type, properties, indexSignatures);
                        } else if (ts.isTypeReferenceNode(type)) {
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
            } catch (error) {
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
                properties: properties.length > 0 ? properties : undefined, // Store properties for comparison
                indexSignatures: indexSignatures.length > 0 ? indexSignatures : undefined // Store index signatures
            }
        };
    }

    /**
     * Extract properties from a TypeScript TypeLiteralNode
     * Handles PropertySignature members, index signatures, and extracts name, type, and optional flag
     * Also handles nested object types recursively
     */
    private extractPropertiesFromTypeLiteral(
        typeLiteral: ts.TypeLiteralNode,
        properties: Array<{ name: string; type: string; isOptional?: boolean }>,
        indexSignatures: Array<{ keyType: string; valueType: string }>
    ): void {
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
    private extractPropertySignature(
        member: ts.PropertySignature
    ): { name: string; type: string; isOptional?: boolean } | null {
        const propName = member.name;
        let propNameText: string | undefined;
        
        // Handle different property name types
        if (ts.isIdentifier(propName)) {
            propNameText = propName.text;
        } else if (ts.isStringLiteral(propName)) {
            propNameText = propName.text;
        } else if (ts.isNumericLiteral(propName)) {
            propNameText = propName.text;
        } else if (ts.isComputedPropertyName(propName)) {
            // Computed property names - extract expression text
            const expression = propName.expression;
            if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) {
                propNameText = expression.text;
            } else {
                // For complex computed names, use the text representation
                try {
                    propNameText = propName.getText();
                } catch (error) {
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
            } catch (error) {
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
    private extractIndexSignature(
        member: ts.IndexSignatureDeclaration
    ): { keyType: string; valueType: string } | null {
        try {
            const keyTypeNode = member.parameters[0]?.type;
            const valueTypeNode = member.type;
            
            if (!keyTypeNode || !valueTypeNode) {
                return null;
            }
            
            const keyType = this.normalizeTypeText(keyTypeNode.getText());
            const valueType = this.normalizeTypeText(valueTypeNode.getText());
            
            return { keyType, valueType };
        } catch (error) {
            console.log(`[TypeScriptAnalyzer] Failed to extract index signature: ${error}`);
            return null;
        }
    }

    /**
     * Normalize type text to handle formatting differences
     * - Removes extra whitespace
     * - Normalizes type alias references vs inline types (best effort)
     */
    private normalizeTypeText(typeText: string): string {
        if (!typeText) return 'any';
        
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

    private createEnumSymbolInfo(enumDecl: EnumDeclaration): SymbolInfo {
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

    private getDeclarationKind(decl: Node): string {
        if (decl.getKindName() === 'FunctionDeclaration') return 'function';
        if (decl.getKindName() === 'ClassDeclaration') return 'class';
        if (decl.getKindName() === 'InterfaceDeclaration') return 'interface';
        if (decl.getKindName() === 'TypeAliasDeclaration') return 'type';
        if (decl.getKindName() === 'EnumDeclaration') return 'enum';
        if (decl.getKindName() === 'VariableDeclaration') return 'variable';
        return 'unknown';
    }

    /**
     * Normalize a TypeScript call signature into a stable key for comparison
     * Format: paramCount:param1Type:param2Type:...:returnType
     * Handles optional parameters and complex types
     * Uses TypeScript's type checker for accurate type resolution
     */
    private normalizeCallSignature(signature: ts.Signature): string {
        if (!this.checker) return '';
        
        const params: string[] = [];
        const declaration = signature.declaration;
        if (!declaration) return '';
        
        // Get parameter types using the type checker
        for (let i = 0; i < signature.parameters.length; i++) {
            const param = signature.parameters[i];
            const paramDecl = param.valueDeclaration || declaration;
            if (!paramDecl) continue;
            
            try {
                const paramType = this.checker.getTypeOfSymbolAtLocation(param, paramDecl);
                const paramTypeString = this.checker.typeToString(paramType);
                
                // Check if parameter is optional
                let isOptional = false;
                if (param.valueDeclaration && ts.isParameter(param.valueDeclaration)) {
                    isOptional = param.valueDeclaration.questionToken !== undefined;
                }
                
                params.push(`${paramTypeString}${isOptional ? '?' : ''}`);
            } catch (error) {
                // Fallback: use parameter name if type resolution fails
                const paramName = param.getName();
                params.push(`${paramName}:any`);
            }
        }
        
        // Get return type from signature
        try {
            // Access the return type from the signature's type property
            // Signature has a 'type' property that contains the return type
            const signatureType = (signature as any).type;
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
        } catch (error) {
            // Fallback to 'any' if return type resolution fails
        }
        return `${params.length}:${params.join(':')}:any`;
    }

    private getSymbolTypeInfo(node: ts.Node): TypeInfo | null {
        if (!this.checker) return null;

        try {
            const type = this.checker.getTypeAtLocation(node);
            const typeString = this.checker.typeToString(type);
            
            // Check for type parameters (for generic types)
            let typeParameters: string[] | undefined;
            if (type.symbol && (type.symbol as any).typeParameters) {
                typeParameters = (type.symbol as any).typeParameters.map((tp: ts.TypeParameter) => 
                    tp.symbol ? tp.symbol.getName() : 'unknown'
                );
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
        } catch {
            return null;
        }
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

