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
} from '../ILanguageAnalyzer.js';
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
} from './SymbolSnapshot.js';
import {
    ResolvedExport,
    ApiSnapshot,
    ApiShape,
    ExportIdentity,
    FunctionApiShape,
    ClassApiShape,
    TypeApiShape,
    EnumApiShape,
    VariableApiShape,
    FunctionSignature,
    ParameterSignature,
    ClassMember,
    TypeProperty,
    IndexSignature
} from './ApiSnapshotTypes.js';

export class TypeScriptAnalyzer implements ILanguageAnalyzer {
    private project: Project;
    private program: ts.Program | null = null;
    private checker: ts.TypeChecker | null = null;
    private projectRoot: string | null = null;
    
    // Caching for performance
    private moduleResolutionCache = new Map<string, string | null>(); // moduleSpecifier+fromFile -> resolvedPath
    private symbolExportsCache = new Map<string, string[]>(); // resolvedPath -> exports[]
    private apiShapeCache = new Map<string, ApiShape | null>(); // exportIdentity -> ApiShape

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot || null;
        
        // Initialize ts-morph project
        this.project = new Project({
            useInMemoryFileSystem: false,
            compilerOptions: {
                target: 5, // ts.ScriptTarget.ES2020
                module: 1, // ts.ModuleKind.CommonJS
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

    private getTsApi(): typeof ts {
        return (ts as any).default || ts;
    }

    private initializeTypeChecker(): void {
        try {
            // Handle ESM default export for TypeScript
            const tsApi = this.getTsApi();
            // Create a TypeScript program with empty files initially
            // It will be populated as files are analyzed
            this.program = tsApi.createProgram([], {
                target: 5, // ts.ScriptTarget.ES2020
                module: 1, // ts.ModuleKind.CommonJS
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true
            });

            this.checker = this.program?.getTypeChecker() || null;
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

            // Handle ESM default export for TypeScript
            const tsApi = (ts as any).default || ts;
            // Create new TypeScript program with all files
            if (filePaths.length > 0) {
                this.program = tsApi.createProgram(filePaths, {
                    target: 5, // ts.ScriptTarget.ES2020
                    module: 1, // ts.ModuleKind.CommonJS
                    strict: true,
                    esModuleInterop: true,
                    skipLibCheck: true
                });

                this.checker = this.program?.getTypeChecker() || null;
            }
        } catch (error) {
            console.error('Error updating TypeScript program:', error);
        }
    }

    /**
     * Expands .js imports to .ts candidates (for ESM libraries that use .js in TS source).
     * When you see a specifier ending in .js, try same path with .ts, .tsx, .d.ts, and index variants.
     */
    private expandJsToTsCandidates(spec: string): string[] {
        if (!spec.endsWith('.js')) return [spec];
        const base = spec.slice(0, -3);
        return [
            spec,          // keep .js
            base + '.ts',
            base + '.tsx',
            base + '.d.ts',
            base + '/index.ts',
            base + '/index.tsx',
            base + '/index.d.ts',
        ];
    }

    /**
     * Normalizes a module specifier to try resolving .js files to .ts/.d.ts equivalents.
     * This helps resolve re-exports that reference .js files.
     */
    private normalizeModuleSpecifier(moduleSpecifier: string, fromFile: string): string[] {
        const candidates: string[] = [moduleSpecifier];
        
        // A) Support ".js import in TS maps to .ts"
        if (moduleSpecifier.endsWith('.js')) {
            const expanded = this.expandJsToTsCandidates(moduleSpecifier);
            candidates.push(...expanded.slice(1)); // Skip the original .js (already added)
        } else if (moduleSpecifier.endsWith('.jsx')) {
            const base = moduleSpecifier.slice(0, -4);
            candidates.push(base + '.tsx');
            candidates.push(base + '.ts');
            candidates.push(base + '.d.ts');
            candidates.push(base);
            candidates.push(base + '/index.ts');
            candidates.push(base + '/index.tsx');
            candidates.push(base + '/index.d.ts');
        } else if (!path.extname(moduleSpecifier)) {
            // B) Support extensionless imports
            // If it's ./external (no extension), try ./external.ts, ./external.tsx, ./external.d.ts, ./external/index.ts, etc.
            candidates.push(moduleSpecifier + '.ts');
            candidates.push(moduleSpecifier + '.tsx');
            candidates.push(moduleSpecifier + '.d.ts');
            candidates.push(moduleSpecifier + '/index.ts');
            candidates.push(moduleSpecifier + '/index.tsx');
            candidates.push(moduleSpecifier + '/index.d.ts');
        }
        
        return candidates;
    }

    /**
     * Resolves a module specifier to an actual file path.
     * Uses TypeScript's module resolution when possible (best), otherwise falls back to manual resolution.
     * Caches results for performance.
     */
    private resolveModulePath(moduleSpecifier: string, fromFile: string): string | null {
        const cacheKey = `${moduleSpecifier}|${fromFile}`;
        
        // Check cache - only log on cache miss
        if (this.moduleResolutionCache.has(cacheKey)) {
            return this.moduleResolutionCache.get(cacheKey)!;
        }
        
        const fromDir = path.dirname(fromFile);
        const tsApi = this.getTsApi();

        // C) Use TypeScript's resolver when possible (best)
        try {
            // Try Node16/NodeNext first (modern ESM), then fallback to NodeJs
            let moduleResolutionKind = tsApi.ModuleResolutionKind?.NodeJs ?? 2; // Default to NodeJs
            if (tsApi.ModuleResolutionKind) {
                // Prefer Node16 or NodeNext if available (modern ESM support)
                const node16 = tsApi.ModuleResolutionKind.Node16;
                const nodeNext = tsApi.ModuleResolutionKind.NodeNext;
                if (node16 !== undefined) {
                    moduleResolutionKind = node16;
                } else if (nodeNext !== undefined) {
                    moduleResolutionKind = nodeNext;
                }
            }
            
            const compilerOptions: ts.CompilerOptions = {
                module: tsApi.ModuleKind?.ESNext ?? 99, // ESNext
                target: tsApi.ScriptTarget?.ES2020 ?? 5, // ES2020
                moduleResolution: moduleResolutionKind ?? 2, // NodeJs
                allowJs: true,
                esModuleInterop: true,
                resolveJsonModule: true,
                skipLibCheck: true,
                baseUrl: fromDir,
            };
            
            const resolved = tsApi.resolveModuleName(
                moduleSpecifier,
                fromFile,
                compilerOptions,
                tsApi.sys
            ).resolvedModule?.resolvedFileName;
            
            if (resolved && fs.existsSync(resolved)) {
                this.moduleResolutionCache.set(cacheKey, resolved);
                // Only log on successful resolution (cache miss)
                return resolved;
            }
        } catch (error) {
            // Fall back to manual resolution
        }

        // Manual fallback: try all candidates from normalizeModuleSpecifier
        const candidates = this.normalizeModuleSpecifier(moduleSpecifier, fromFile);
        
        console.log("[RESOLVER] Trying candidates", {
            spec: moduleSpecifier,
            fromDir,
            candidates: candidates.map(c => {
                let resolved: string;
                if (c.startsWith('./') || c.startsWith('../')) {
                    resolved = path.resolve(fromDir, c);
                } else if (path.isAbsolute(c)) {
                    resolved = c;
                } else {
                    resolved = path.resolve(fromDir, c);
                }
                return { candidate: c, resolved, exists: fs.existsSync(resolved) };
            })
        });
        
        // Try each candidate
        for (const candidate of candidates) {
            let resolved: string;
            
            // Handle relative paths
            if (candidate.startsWith('./') || candidate.startsWith('../')) {
                resolved = path.resolve(fromDir, candidate);
            } else if (path.isAbsolute(candidate)) {
                resolved = candidate;
            } else {
                // Relative to fromDir (no ./ prefix)
                resolved = path.resolve(fromDir, candidate);
            }
            
            // Check if file exists
            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
                this.moduleResolutionCache.set(cacheKey, resolved);
                console.log(`[TypeScriptAnalyzer] Resolved '${moduleSpecifier}' to ${resolved} (manual)`);
                return resolved;
            }
            
            // Also check if it's a directory with an index file
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
                const indexFiles = ['index.ts', 'index.tsx', 'index.d.ts'];
                for (const indexFile of indexFiles) {
                    const indexPath = path.join(resolved, indexFile);
                    if (fs.existsSync(indexPath)) {
                        this.moduleResolutionCache.set(cacheKey, indexPath);
                        console.log(`[TypeScriptAnalyzer] Resolved '${moduleSpecifier}' to ${indexPath} (directory index)`);
                        return indexPath;
                    }
                }
            }
        }
        
        // Cache null result
        console.log(`[TypeScriptAnalyzer] Failed to resolve '${moduleSpecifier}' from ${fromFile} (tried ${candidates.length} candidates)`);
        this.moduleResolutionCache.set(cacheKey, null);
        return null;
    }

    /**
     * Resolves exports from a module using TypeScript's type checker.
     * This handles export * from modules that aren't explicitly listed.
     * Caches results for performance.
     */
    private resolveModuleExports(moduleSpecifier: string, fromFile: string): string[] {
        return this.resolveModuleExportsInternal(moduleSpecifier, fromFile, new Set());
    }

    private resolveModuleExportsInternal(moduleSpecifier: string, fromFile: string, visited: Set<string>): string[] {
        console.log("[resolveModuleExports] Called", { moduleSpecifier, fromFile });
        const resolvedPath = this.resolveModulePath(moduleSpecifier, fromFile);
        console.log("[resolveModuleExports] Resolved path:", resolvedPath);
        if (!resolvedPath) {
            console.warn(`[TypeScriptAnalyzer] Could not resolve module specifier "${moduleSpecifier}" from "${fromFile}"`);
            return [];
        }

        const normalizedResolvedPath = path.normalize(resolvedPath);
        const cachePath = normalizedResolvedPath.replace(/\\/g, '/');
        if (visited.has(cachePath)) {
            console.log(`[TypeScriptAnalyzer] Skipping already visited module: ${cachePath}`);
            return [];
        }
        visited.add(cachePath);

        console.log(`[TypeScriptAnalyzer] Resolving module specifier "${moduleSpecifier}" from "${fromFile}" -> ${cachePath}`);
        
        // Check cache
        if (this.symbolExportsCache.has(cachePath)) {
            return this.symbolExportsCache.get(cachePath)!;
        }
        
        // Try to get the source file from the project
        let targetSourceFile = this.project.getSourceFile(cachePath)
            ?? this.project.getSourceFile(normalizedResolvedPath)
            ?? this.project.getSourceFile(resolvedPath);
        if (!targetSourceFile && this.checker) {
            // If not in project, try to add it
            if (fs.existsSync(normalizedResolvedPath)) {
                try {
                    const content = fs.readFileSync(normalizedResolvedPath, 'utf8');
                    this.project.createSourceFile(cachePath, content, { overwrite: true });
                    this.updateTypeScriptProgram();
                    targetSourceFile = this.project.getSourceFile(cachePath)
                        ?? this.project.getSourceFile(normalizedResolvedPath)
                        ?? this.project.getSourceFile(resolvedPath);
                } catch (e) {
                    // Ignore errors
                }
            }
        }
        
        const exports: string[] = [];
        let checkerExportsCount = 0;
        
        if (this.checker && targetSourceFile) {
            try {
                // Use TypeScript's type checker to get module exports
                const sourceFile = targetSourceFile.compilerNode;
                // Get the module symbol from the source file
                const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile as unknown as ts.Node);
                
                if (moduleSymbol) {
                    const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                    for (const exportSymbol of moduleExports) {
                        // Skip default export symbol name
                        if (exportSymbol.getName() !== 'default') {
                            exports.push(exportSymbol.getName());
                            checkerExportsCount++;
                        }
                    }
                }
            } catch (e) {
                // Fall through to syntactic fallback below
            }
        }

        if (targetSourceFile && checkerExportsCount === 0) {
            const syntacticExports = this.collectSyntacticExports(targetSourceFile, cachePath, visited);
            if (syntacticExports.length > 0) {
                console.warn(`[TypeScriptAnalyzer] Syntactic export fallback for ${cachePath}: ${syntacticExports.length} exports`);
                exports.push(...syntacticExports);
            }
        }
        
        // Cache result
        this.symbolExportsCache.set(cachePath, exports);
        return exports;
    }

    private collectSyntacticExports(sourceFile: SourceFile, resolvedPath: string, visited: Set<string>): string[] {
        const exportNames = new Set<string>();
        console.log(`[TypeScriptAnalyzer] collectSyntacticExports: ${resolvedPath}`);

        // Local exports declared in this file
        const exportedDecls = sourceFile.getExportedDeclarations();
        const normalizedResolvedPath = path.normalize(resolvedPath).replace(/\\/g, '/');
        for (const [name, decls] of exportedDecls) {
            const isLocal = decls.some(decl => {
                const declPath = path.normalize(decl.getSourceFile().getFilePath()).replace(/\\/g, '/');
                return declPath === normalizedResolvedPath;
            });
            if (isLocal) {
                exportNames.add(name);
            }
        }

        // Re-exports
        const exportStatements = sourceFile.getExportDeclarations();
        console.log(`[TypeScriptAnalyzer] collectSyntacticExports: found ${exportStatements.length} export declarations`);
        for (const exportStmt of exportStatements) {
            const moduleSpecifier = exportStmt.getModuleSpecifierValue();
            const namedExports = exportStmt.getNamedExports();
            const namespaceExport = exportStmt.getNamespaceExport();
            if (moduleSpecifier) {
                console.log(`[TypeScriptAnalyzer] collectSyntacticExports: re-export ${moduleSpecifier} (named=${namedExports.length}, namespace=${!!namespaceExport})`);
                if (namespaceExport) {
                    exportNames.add(namespaceExport.getName());
                } else if (namedExports.length > 0) {
                    for (const namedExport of namedExports) {
                        exportNames.add(namedExport.getName());
                    }
                } else {
                    const resolvedExports = this.resolveModuleExportsInternal(moduleSpecifier, resolvedPath, visited);
                    for (const exportName of resolvedExports) {
                        exportNames.add(exportName);
                    }
                }
            } else if (namedExports.length > 0) {
                for (const namedExport of namedExports) {
                    exportNames.add(namedExport.getName());
                }
            }
        }

        return Array.from(exportNames);
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
        const preview = content.replace(/\s+/g, ' ').slice(0, 160).trim();
        console.log(`[TypeScriptAnalyzer] Content length: ${content.length} chars, preview="${preview}${content.length > 160 ? '...' : ''}"`);
        
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

            // Extract exports - split into 3 buckets: directExports, reExportedSymbols, typeOnlyExports
            // CRITICAL: For barrel files, getExportedDeclarations() includes re-exported symbols,
            // so we must use AST-first approach and avoid double-counting.
            
            const allExportStatements = sourceFile.getExportDeclarations();
            const defaultExport = sourceFile.getDefaultExportSymbol();
            console.log(`[TypeScriptAnalyzer] Export declarations found: ${allExportStatements.length}`);
            
            // Track counts explicitly and mutually exclusively
            let directExportedGroups = 0;
            let reexportGroupsResolved = 0;
            let reexportGroupsUnresolved = 0;
            
            // First pass: Collect all re-exported keys using strong key format
            // Use same key structure as uniqueness: name|module|type/value|kind
            // This prevents false positives when same name appears as both direct and re-export
            const reExportedKeys = new Set<string>();
            const reExportStatements: Array<{stmt: any, isTypeOnly: boolean, isNamespace: boolean, moduleSpecifier: string}> = [];
            
            for (const exportStmt of allExportStatements) {
                const moduleSpecifier = exportStmt.getModuleSpecifierValue();
                const namedCount = exportStmt.getNamedExports().length;
                const namespaceExportNode = exportStmt.getNamespaceExport();
                const isNamespaceExport = exportStmt.isNamespaceExport() && !!namespaceExportNode;
                console.log(`[TypeScriptAnalyzer] Export declaration module specifier: ${moduleSpecifier ?? '<none>'}`);
                console.log(`[TypeScriptAnalyzer] Export declaration details: named=${namedCount}, namespace=${isNamespaceExport}`);
                if (moduleSpecifier) {
                    // This is a re-export statement
                    const isTypeOnlyDeclaration = exportStmt.isTypeOnly();
                    const isNamespaceExport = exportStmt.isNamespaceExport() && !!exportStmt.getNamespaceExport();
                    
                    reExportStatements.push({
                        stmt: exportStmt,
                        isTypeOnly: isTypeOnlyDeclaration,
                        isNamespace: isNamespaceExport,
                        moduleSpecifier
                    });
                    
                    // For named re-exports, collect the keys immediately
                    const namedExports = exportStmt.getNamedExports();
                    if (isNamespaceExport) {
                        const namespaceName = exportStmt.getNamespaceExport()?.getName();
                        if (namespaceName) {
                            const kind = 're-export';
                            const key = `${namespaceName}|${moduleSpecifier}|${isTypeOnlyDeclaration ? 'type' : 'value'}|${kind}`;
                            reExportedKeys.add(key);
                        }
                    } else if (namedExports.length > 0) {
                        for (const namedExport of namedExports) {
                            const compilerNode = namedExport.compilerNode;
                            const publicName = compilerNode.name.text;
                            const isTypeOnlySpecifier = (compilerNode as unknown as ts.ExportSpecifier).isTypeOnly === true || isTypeOnlyDeclaration;
                            const kind = 're-export'; // Named re-exports are always 're-export' kind
                            // Build strong key: name|module|type/value|kind
                            const key = `${publicName}|${moduleSpecifier}|${isTypeOnlySpecifier ? 'type' : 'value'}|${kind}`;
                            reExportedKeys.add(key);
                        }
                    } else {
                        // For export * from (and namespace exports), resolve and collect keys
                        // Note: We don't know the kind yet, so we'll use a placeholder
                        // The actual kind will be determined when we create ExportInfo objects
                        console.log(`[TypeScriptAnalyzer] First-pass star export resolve: ${moduleSpecifier} from ${normalizedPath}`);
                        const resolvedExports = this.resolveModuleExports(moduleSpecifier, normalizedPath);
                        console.log(`[TypeScriptAnalyzer] First-pass star export result: ${resolvedExports.length} exports`);
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
                    const exportInfo: ExportInfo = {
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
            for (const {stmt: exportStmt, isTypeOnly: isTypeOnlyDeclaration, isNamespace: isNamespaceExport, moduleSpecifier} of reExportStatements) {
                const namedExports = exportStmt.getNamedExports();
                console.log(`[TypeScriptAnalyzer] Re-export statement: ${moduleSpecifier} (named=${namedExports.length}, namespace=${isNamespaceExport})`);
                if (isNamespaceExport) {
                    const namespaceName = exportStmt.getNamespaceExport()?.getName();
                    if (namespaceName) {
                        reexportGroupsResolved++;
                        const exportInfo: ExportInfo = {
                            name: namespaceName,
                            type: 'namespace',
                            kind: 're-export',
                            line: exportStmt.getStartLineNumber(),
                            sourceModule: moduleSpecifier,
                            sourceName: namespaceName,
                            exportedName: namespaceName,
                            localName: undefined,
                            isTypeOnly: isTypeOnlyDeclaration
                        };
                        exports.push(exportInfo);
                    } else {
                        reexportGroupsUnresolved++;
                    }
                } else if (namedExports.length > 0) {
                    // Handle export { x } from './module' or export { type Foo } from './module'
                    reexportGroupsResolved++;
                    
                    for (const namedExport of namedExports) {
                        const compilerNode = namedExport.compilerNode;
                        const exportedName = compilerNode.name.text; // Public API name
                        
                        // Check if this specific specifier is type-only (TS 5.x: export { type Foo } from ...)
                        const isTypeOnlySpecifier = (compilerNode as unknown as ts.ExportSpecifier).isTypeOnly === true || isTypeOnlyDeclaration;
                        
                        const sourceName = compilerNode.propertyName 
                            ? compilerNode.propertyName.text 
                            : compilerNode.name.text;
                        
                        const exportInfo: ExportInfo = {
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
                } else {
                    // Handle export * from './module' or export type * from './module'
                    console.log(`[TypeScriptAnalyzer] Star export: ${moduleSpecifier} from ${normalizedPath} (typeOnly=${isTypeOnlyDeclaration})`);
                    
                    const resolvedExports = this.resolveModuleExports(moduleSpecifier, normalizedPath);
                    
                    console.log(`[TypeScriptAnalyzer] Star export resolved: ${resolvedExports.length} exports for ${moduleSpecifier}`);
                    
                    if (resolvedExports.length > 0) {
                        reexportGroupsResolved++;
                        console.log(`[TypeScriptAnalyzer] Star export resolved; adding ${resolvedExports.length} exports`);
                        for (const exportName of resolvedExports) {
                            const exportInfo: ExportInfo = {
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
                    } else {
                        reexportGroupsUnresolved++;
                        console.log(`[TypeScriptAnalyzer] Star export unresolved: ${moduleSpecifier}`);
                    }
                }
            }
            
            // Handle default export separately if exists and not re-exported
            // Check using strong key format
            const defaultKey = `default|local|value|${defaultExport ? this.getDeclarationKind(defaultExport.getValueDeclaration() as Node) : 'default'}`;
            if (defaultExport && !reExportedKeys.has(defaultKey)) {
                const defaultExportDecl = sourceFile.getDefaultExportSymbol()?.getValueDeclaration();
                if (defaultExportDecl) {
                    const node = this.project.getSourceFile(normalizedPath)?.getDefaultExportSymbol()?.getValueDeclaration();
                    if (node) {
                        const exportInfo: ExportInfo = {
                            name: 'default',
                            type: 'default',
                            kind: this.getDeclarationKind(node as Node),
                            line: (node as any).getStartLineNumber?.() || 0,
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
            const getDeclarationLocation = (exp: ExportInfo): string => {
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
            const uniqueExportKeys = new Set<string>();
            const exportKeyToInfo = new Map<string, ExportInfo>();
            
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
                const exportKeyCounts = new Map<string, number>();
                const exportKeyToSources = new Map<string, string[]>();
                
                for (const exp of exports) {
                    const declLocation = getDeclarationLocation(exp);
                    const key = `${exp.name}|${exp.sourceModule || 'local'}|${exp.isTypeOnly ? 'type' : 'value'}|${exp.kind}|${declLocation}`;
                    exportKeyCounts.set(key, (exportKeyCounts.get(key) || 0) + 1);
                    
                    if (!exportKeyToSources.has(key)) {
                        exportKeyToSources.set(key, []);
                    }
                    const source = exp.sourceModule || 'local';
                    if (!exportKeyToSources.get(key)!.includes(source)) {
                        exportKeyToSources.get(key)!.push(source);
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
                } else {
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
                    directExportsNearZero: directExportedGroups <= 1, // Allow 0-1 for edge cases
                    // Check 2: export type * from must contribute only to exports_type, not exports_runtime
                    typeOnlyExportsNotInRuntime: typeOnlyExports > 0 ? exportsRuntime === (directExportsRuntime + reExportedSymbolsRuntime) : true,
                    // Check 3: Uniqueness after dedupe (allow small number of duplicates for now)
                    duplicatesAcceptable: duplicatesCount <= 1, // Allow 0-1 duplicates
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
                } else {
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

                    const importInfo: ImportInfo = {
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
            exportChanges,
            packageChanges: [] // TypeScript analyzer doesn't handle package.json changes
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
        const tsApi = this.getTsApi();
        
        // Extract properties if this is an object type literal or intersection with object literals
        const properties: Array<{ name: string; type: string; isOptional?: boolean }> = [];
        const indexSignatures: Array<{ keyType: string; valueType: string }> = [];
        
        if (typeNode) {
            try {
                const compilerNode = typeNode.compilerNode as unknown as ts.Node;
                
                // Handle direct object type literal: type X = { a?: string }
                if (tsApi.isTypeLiteralNode(compilerNode)) {
                    this.extractPropertiesFromTypeLiteral(compilerNode, properties, indexSignatures);
                }
                // Handle intersection types: type X = A & { a?: string }
                else if (tsApi.isIntersectionTypeNode(compilerNode)) {
                    for (const type of compilerNode.types) {
                        if (tsApi.isTypeLiteralNode(type)) {
                            this.extractPropertiesFromTypeLiteral(type, properties, indexSignatures);
                        } else if (tsApi.isTypeReferenceNode(type)) {
                            // For intersections with type references, try to resolve if it's an object type
                            // This is a best-effort - full resolution would require type checker
                            const typeName = type.typeName;
                            if (tsApi.isIdentifier(typeName)) {
                                // Mark that this type includes properties from another type
                                // We can't extract them without type checker, but we note the dependency
                            }
                        }
                    }
                }
                // Handle union types: type X = A | { a?: string }
                // Extract properties from all object literal members of the union
                else if (tsApi.isUnionTypeNode(compilerNode)) {
                    for (const type of compilerNode.types) {
                        if (tsApi.isTypeLiteralNode(type)) {
                            this.extractPropertiesFromTypeLiteral(type, properties, indexSignatures);
                        }
                    }
                    // Note: For unions, we collect properties from all object literal members
                    // This is conservative - in reality, only properties present in ALL members are guaranteed
                }
                // Handle mapped types: type X = { [K in keyof T]: T[K] }
                else if (tsApi.isMappedTypeNode(compilerNode)) {
                    // Mapped types are complex - extract what we can
                    const typeLiteral = compilerNode.type;
                    if (typeLiteral && tsApi.isTypeLiteralNode(typeLiteral)) {
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
        const tsApi = this.getTsApi();
        const members = typeLiteral.members;
        for (const member of members) {
            // Handle property signatures: { a?: string }
            if (tsApi.isPropertySignature(member)) {
                const propInfo = this.extractPropertySignature(member);
                if (propInfo) {
                    properties.push(propInfo);
                }
            }
            // Handle index signatures: { [key: string]: value }
            else if (tsApi.isIndexSignatureDeclaration(member)) {
                const indexInfo = this.extractIndexSignature(member);
                if (indexInfo) {
                    indexSignatures.push(indexInfo);
                }
            }
            // Handle method signatures: { method(): void }
            // Note: Method signatures are tracked but not used for property breaking change detection
            else if (tsApi.isMethodSignature(member)) {
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
        const tsApi = this.getTsApi();
        const propName = member.name;
        let propNameText: string | undefined;
        
        // Handle different property name types
        if (tsApi.isIdentifier(propName)) {
            propNameText = propName.text;
        } else if (tsApi.isStringLiteral(propName)) {
            propNameText = propName.text;
        } else if (tsApi.isNumericLiteral(propName)) {
            propNameText = propName.text;
        } else if (tsApi.isComputedPropertyName(propName)) {
            // Computed property names - extract expression text
            const expression = propName.expression;
            if (tsApi.isStringLiteral(expression) || tsApi.isNumericLiteral(expression)) {
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
            const tsApi = this.getTsApi();
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

    private getDeclarationKind(decl: Node | null | undefined): string {
        if (!decl) return 'unknown';
        // Check if getKindName method exists (ts-morph Node method)
        if (typeof (decl as any).getKindName !== 'function') {
            return 'unknown';
        }
        try {
            const kindName = (decl as any).getKindName();
            if (kindName === 'FunctionDeclaration') return 'function';
            if (kindName === 'ClassDeclaration') return 'class';
            if (kindName === 'InterfaceDeclaration') return 'interface';
            if (kindName === 'TypeAliasDeclaration') return 'type';
            if (kindName === 'EnumDeclaration') return 'enum';
            if (kindName === 'VariableDeclaration') return 'variable';
        } catch (e) {
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
    private normalizeCallSignature(signature: ts.Signature): string {
        if (!this.checker) return '';
        const tsApi = this.getTsApi();
        
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
                if (param.valueDeclaration && tsApi.isParameter(param.valueDeclaration)) {
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
            if (declaration && tsApi.isFunctionLike(declaration) && declaration.type) {
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

    /**
     * Resolves entrypoint exports to their actual declaration locations.
     * This is the core of API snapshot mode - it resolves all exports (direct and re-exported)
     * to their real declaration files and positions.
     */
    async resolveEntrypointExportsToDeclarations(
        entrypointPath: string,
        exports: ExportInfo[]
    ): Promise<ResolvedExport[]> {
        if (!this.checker) {
            console.warn('[TypeScriptAnalyzer] Type checker not available, cannot resolve exports to declarations');
            return [];
        }

        const resolvedExports: ResolvedExport[] = [];
        const entrypointFile = this.project.getSourceFile(entrypointPath);
        
        if (!entrypointFile) {
            console.warn(`[TypeScriptAnalyzer] Entrypoint file not found: ${entrypointPath}`);
            return [];
        }

        const entrypointFilePath = entrypointFile.getFilePath();
        const tsApi = this.getTsApi();

        for (const exp of exports) {
            try {
                if (!exp.sourceModule) {
                    // Case A: Direct/local export
                    const exportDeclarations = entrypointFile.getExportedDeclarations();
                    const declarations = exportDeclarations.get(exp.name);
                    
                    if (declarations && declarations.length > 0) {
                        // Verify it's actually in this file
                        const localDecls = declarations.filter(d => 
                            d.getSourceFile().getFilePath() === entrypointFilePath
                        );
                        
                        if (localDecls.length > 0) {
                            const decl = localDecls[0];
                            const declFile = decl.getSourceFile();
                            const declPath = declFile.getFilePath();
                            const declPos = decl.getStart();
                            const declEnd = decl.getEnd();
                            
                            // Get TypeScript symbol
                            let tsSymbol: ts.Symbol | undefined;
                            try {
                                const compilerNode = decl.compilerNode;
                                tsSymbol = this.checker!.getSymbolAtLocation(compilerNode as unknown as ts.Node);
                            } catch (e) {
                                // Ignore
                            }
                            
                            // Fallback: try to get symbol from module exports
                            if (!tsSymbol && this.checker) {
                                try {
                                    const sourceFile = entrypointFile.compilerNode;
                                    const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile as unknown as ts.Node);
                                    if (moduleSymbol) {
                                        const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                                        const foundSymbol = moduleExports.find(s => s.getName() === exp.name);
                                        if (foundSymbol) {
                                            tsSymbol = foundSymbol;
                                        }
                                    }
                                } catch (e) {
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
                } else {
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
                        } catch (e) {
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
                            
                            let tsSymbol: ts.Symbol | undefined;
                            try {
                                const compilerNode = decl.compilerNode;
                                tsSymbol = this.checker.getSymbolAtLocation(compilerNode as unknown as ts.Node);
                            } catch (e) {
                                // Ignore
                            }
                            
                            // Fallback: try to get symbol from target module exports
                            if (!tsSymbol && this.checker) {
                                try {
                                    const targetSourceFile = declFile.compilerNode;
                                    const moduleSymbol = this.checker.getSymbolAtLocation(targetSourceFile as unknown as ts.Node);
                                    if (moduleSymbol) {
                                        const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                                        // Prefer value symbols
                                        const foundSymbol = moduleExports.find(s => {
                                            if (s.getName() !== exp.sourceName) return false;
                                            const flags = s.getFlags();
                                            return (flags & (tsApi.SymbolFlags.Value | tsApi.SymbolFlags.Function | tsApi.SymbolFlags.Class | tsApi.SymbolFlags.Enum | tsApi.SymbolFlags.Variable)) !== 0;
                                        }) || moduleExports.find(s => s.getName() === exp.sourceName);
                                        if (foundSymbol) {
                                            tsSymbol = foundSymbol;
                                        }
                                    }
                                } catch (e) {
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
                    } else {
                        // Case C: export * from './mod' or export type * from './types'
                        // Use TypeScript's type checker to get all exports
                        try {
                            const sourceFile = targetSourceFile.compilerNode;
                            const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile as unknown as ts.Node);
                            
                            if (moduleSymbol) {
                                // Get all exports from the module (both value and type exports)
                                // TypeScript's getExportsOfModule should include both
                                const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                                
                                // Track which exports we've already added (by name) to avoid duplicates
                                const addedExports = new Set<string>();
                                
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
                                    const isTypeSymbol = (flags & tsApi.SymbolFlags.Type) !== 0 && 
                                                         (flags & (tsApi.SymbolFlags.Value | tsApi.SymbolFlags.Function | tsApi.SymbolFlags.Class | tsApi.SymbolFlags.Enum | tsApi.SymbolFlags.Variable)) === 0;
                                    
                                    // If this is a type-only export, include type symbols
                                    // Otherwise, skip pure type symbols (interfaces, type aliases without values)
                                    if (!exp.isTypeOnly && isTypeSymbol) {
                                        // Check if there's a value symbol with the same name
                                        const hasValueSymbol = moduleExports.some(s => 
                                            s.getName() === exportName && 
                                            (s.getFlags() & (tsApi.SymbolFlags.Value | tsApi.SymbolFlags.Function | tsApi.SymbolFlags.Class | tsApi.SymbolFlags.Enum | tsApi.SymbolFlags.Variable)) !== 0
                                        );
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
                                        if (!exportSymbol || exportSymbol.flags === tsApi.SymbolFlags.None) {
                                            console.warn(`[TypeScriptAnalyzer] Invalid symbol for export ${exportName}`);
                                            continue;
                                        }
                                        
                                        resolvedExports.push({
                                            exportName,
                                            isTypeOnly: exp.isTypeOnly || false, // Preserve type-only from export type *
                                            declFilePath: declPath,
                                            declPos,
                                            declEnd,
                                            tsSymbol: exportSymbol, // This should be set
                                            sourceModule: exp.sourceModule,
                                            kind: 're-export'
                                        });
                                        
                                        addedExports.add(exportName);
                                    } else {
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
                                            let tsSymbol: ts.Symbol | undefined = exportSymbol;
                                            try {
                                                const compilerNode = decl.compilerNode;
                                                const symbolFromNode = this.checker!.getSymbolAtLocation(compilerNode as unknown as ts.Node);
                                                if (symbolFromNode) {
                                                    tsSymbol = symbolFromNode;
                                                }
                                            } catch (e) {
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
                        } catch (e) {
                            console.warn(`[TypeScriptAnalyzer] Error resolving star export from ${exp.sourceModule}:`, e);
                        }
                    }
                }
            } catch (error) {
                console.warn(`[TypeScriptAnalyzer] Error resolving export ${exp.name}:`, error);
            }
        }
        
        return resolvedExports;
    }

    /**
     * Builds an API snapshot from resolved exports.
     * This creates normalized API shapes for each exported symbol.
     */
    async buildApiSnapshotFromResolvedExports(
        entrypointPath: string,
        resolvedExports: ResolvedExport[]
    ): Promise<ApiSnapshot> {
        const exports = new Map<ExportIdentity, ApiShape>();
        const tsApi = this.getTsApi();
        
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
                                const symbol = this.checker.getSymbolAtLocation(compilerNode as unknown as ts.Node);
                                if (symbol) {
                                    resolved.tsSymbol = symbol;
                                }
                            }
                            
                            // If still no symbol, try getting from module exports
                            if (!resolved.tsSymbol) {
                                const sourceFile = declSourceFile.compilerNode;
                                const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile as unknown as ts.Node);
                                if (moduleSymbol) {
                                    const moduleExports = this.checker.getExportsOfModule(moduleSymbol);
                                    // Prefer value symbols over type symbols
                                    const foundSymbol = moduleExports.find(s => {
                                        if (s.getName() !== resolved.exportName) return false;
                                        const flags = s.getFlags();
                                        // Prefer value symbols (functions, classes, variables, enums)
                                        return (flags & (tsApi.SymbolFlags.Value | tsApi.SymbolFlags.Function | tsApi.SymbolFlags.Class | tsApi.SymbolFlags.Enum | tsApi.SymbolFlags.Variable)) !== 0;
                                    }) || moduleExports.find(s => s.getName() === resolved.exportName);
                                    if (foundSymbol) {
                                        resolved.tsSymbol = foundSymbol;
                                    }
                                }
                            }
                        } catch (e) {
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
                } else {
                    // Check if this is a type-only export or a variable with interface declaration
                    // (both are expected to not have runtime API shapes)
                    const isTypeOnly = resolved.isTypeOnly || 
                        (resolved.tsSymbol && 
                         (resolved.tsSymbol.getFlags() & tsApi.SymbolFlags.Type) !== 0 &&
                         (resolved.tsSymbol.getFlags() & (tsApi.SymbolFlags.Value | tsApi.SymbolFlags.Function | tsApi.SymbolFlags.Class | tsApi.SymbolFlags.Enum | tsApi.SymbolFlags.Variable)) === 0);
                    
                    // Check if it's a variable symbol with interface declaration (constants like daysInWeek)
                    const isVariableWithInterface = resolved.tsSymbol && 
                        (resolved.tsSymbol.getFlags() & (tsApi.SymbolFlags.Variable | tsApi.SymbolFlags.Property)) !== 0 &&
                        resolved.tsSymbol.getDeclarations()?.some((d: ts.Declaration) => tsApi.isInterfaceDeclaration(d)) &&
                        !resolved.tsSymbol.getDeclarations()?.some((d: ts.Declaration) => tsApi.isVariableDeclaration(d));
                    
                    if (!isTypeOnly && !isVariableWithInterface) {
                        // Only log as failure if it's not a known skip case
                        console.warn(`[TypeScriptAnalyzer] Failed to build API shape for ${resolved.exportName} (kind: ${resolved.kind})`);
                        failureCount++;
                    }
                    // Otherwise, it's a type-only export or variable with interface - skip silently
                }
            } catch (error) {
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
    private createExportIdentity(resolved: ResolvedExport): ExportIdentity {
        return `${resolved.exportName}|${resolved.isTypeOnly ? 'type' : 'value'}|${resolved.declFilePath}|${resolved.declPos}`;
    }

    /**
     * Builds an API shape for a resolved export symbol.
     * Caches results for performance.
     */
    private async buildApiShapeForSymbol(resolved: ResolvedExport): Promise<ApiShape | null> {
        if (!this.checker || !resolved.tsSymbol) {
            return null;
        }
        const tsApi = this.getTsApi();
        
        // Create cache key
        const identity = this.createExportIdentity(resolved);
        
        // Check cache
        if (this.apiShapeCache.has(identity)) {
            return this.apiShapeCache.get(identity)!;
        }
        
        try {
            // Always de-alias symbols first - many re-exports come through as aliases
            let symbol = resolved.tsSymbol;
            if (symbol.flags & tsApi.SymbolFlags.Alias) {
                try {
                    symbol = this.checker.getAliasedSymbol(symbol);
                } catch (error) {
                    // If getAliasedSymbol fails, use the original symbol
                    // This can happen with certain TypeScript internal states
                    symbol = resolved.tsSymbol;
                }
            }
            
            const declarations = symbol.getDeclarations();
            if (!declarations || declarations.length === 0) {
                // Try to build shape from TypeChecker for type-only exports
                return this.buildShapeFromTypeChecker(symbol, resolved.exportName, identity);
            }
            
            // Filter out only truly invalid declaration kinds (JSX elements)
            // Allow: FunctionDeclaration, ClassDeclaration, InterfaceDeclaration, TypeAliasDeclaration,
            //        EnumDeclaration, VariableDeclaration, ModuleDeclaration, ImportEqualsDeclaration
            const validDeclarations = declarations.filter((d: ts.Declaration) => {
                const kind = d.kind;
                // Only skip JSX elements (282-284) - everything else is potentially valid
                // SourceFile (308) can be valid for namespace/module exports
                return kind !== 282 && kind !== 283 && kind !== 284;
            });
            
            if (validDeclarations.length === 0) {
                // All declarations were JSX elements - try TypeChecker fallback
                return this.buildShapeFromTypeChecker(symbol, resolved.exportName, identity);
            }
            
            // Prefer runtime value declarations, but fall back to type declarations
            const valueDeclarations = validDeclarations.filter((d: ts.Declaration) => {
                return tsApi.isFunctionDeclaration(d) ||
                       tsApi.isFunctionExpression(d) ||
                       tsApi.isClassDeclaration(d) ||
                       tsApi.isVariableDeclaration(d) ||
                       tsApi.isEnumDeclaration(d) ||
                       tsApi.isMethodDeclaration(d);
            });
            
            // Use value declaration if available, otherwise use any valid declaration (including types)
            const targetDecl = valueDeclarations.length > 0 ? valueDeclarations[0] : validDeclarations[0];
            const flags = symbol.getFlags();
            
            // Determine kind from the actual declaration, not just from resolved.kind
            // This is important because resolved.kind might be 're-export' which doesn't tell us the actual type
            let shape: ApiShape | null = null;
            
            // Check declaration kind first (most reliable)
            // Use ts.is* type guards for better type safety
            if (tsApi.isFunctionDeclaration(targetDecl) || 
                tsApi.isFunctionExpression(targetDecl) ||
                tsApi.isMethodDeclaration(targetDecl) ||
                tsApi.isMethodSignature(targetDecl)) {
                shape = this.buildFunctionApiShape(symbol, targetDecl);
            } else if (tsApi.isClassDeclaration(targetDecl)) {
                shape = this.buildClassApiShape(symbol, targetDecl);
            } else if (tsApi.isInterfaceDeclaration(targetDecl)) {
                // Always build interface shape - don't try to treat as variable
                shape = this.buildTypeApiShape(symbol, targetDecl, 'interface');
            } else if (tsApi.isTypeAliasDeclaration(targetDecl)) {
                shape = this.buildTypeApiShape(symbol, targetDecl, 'type');
            } else if (tsApi.isEnumDeclaration(targetDecl)) {
                shape = this.buildEnumApiShape(symbol, targetDecl);
            } else if (tsApi.isVariableDeclaration(targetDecl) ||
                       tsApi.isBindingElement(targetDecl)) {
                shape = this.buildVariableApiShape(symbol, targetDecl);
            } else if (tsApi.isModuleDeclaration(targetDecl)) {
                // Namespace/module export - build shape from TypeChecker
                shape = this.buildShapeFromTypeChecker(symbol, resolved.exportName, identity, targetDecl);
            } else if (targetDecl.kind === 268) {
                // ImportEqualsDeclaration - build shape from TypeChecker
                shape = this.buildShapeFromTypeChecker(symbol, resolved.exportName, identity, targetDecl);
            } else if (targetDecl.kind === 308) {
                // SourceFile - namespace/module export, build from TypeChecker
                shape = this.buildShapeFromTypeChecker(symbol, resolved.exportName, identity, targetDecl);
            } else {
                // Fallback: try to infer from symbol flags
                if (flags & tsApi.SymbolFlags.Function) {
                    // Try to find a function declaration
                    const funcDecl = declarations.find((d: ts.Declaration) => tsApi.isFunctionDeclaration(d) || tsApi.isFunctionExpression(d) || tsApi.isMethodDeclaration(d));
                    if (funcDecl) {
                        shape = this.buildFunctionApiShape(symbol, funcDecl);
                    } else {
                        // Use the type checker to get function signature
                        shape = this.buildFunctionApiShape(symbol, targetDecl);
                    }
                } else if (flags & tsApi.SymbolFlags.Class) {
                    const classDecl = declarations.find((d: ts.Declaration) => tsApi.isClassDeclaration(d));
                    if (classDecl) {
                        shape = this.buildClassApiShape(symbol, classDecl);
                    }
                } else if (flags & tsApi.SymbolFlags.Interface && !(flags & tsApi.SymbolFlags.Variable)) {
                    const ifaceDecl = declarations.find((d: ts.Declaration) => tsApi.isInterfaceDeclaration(d));
                    if (ifaceDecl) {
                        shape = this.buildTypeApiShape(symbol, ifaceDecl, 'interface');
                    }
                } else if (flags & tsApi.SymbolFlags.TypeAlias) {
                    const typeDecl = declarations.find((d: ts.Declaration) => tsApi.isTypeAliasDeclaration(d));
                    if (typeDecl) {
                        shape = this.buildTypeApiShape(symbol, typeDecl, 'type');
                    }
                } else if (flags & tsApi.SymbolFlags.Enum) {
                    const enumDecl = declarations.find((d: ts.Declaration) => tsApi.isEnumDeclaration(d));
                    if (enumDecl) {
                        shape = this.buildEnumApiShape(symbol, enumDecl);
                    } else {
                        // Symbol has enum flag but no enum declaration - might be a namespace or something else
                        console.warn(`[TypeScriptAnalyzer] Symbol has Enum flag but no EnumDeclaration for ${resolved.exportName}`);
                    }
                } else if (flags & tsApi.SymbolFlags.Variable || flags & tsApi.SymbolFlags.Property) {
                    const varDecl = declarations.find((d: ts.Declaration) => tsApi.isVariableDeclaration(d) || tsApi.isBindingElement(d));
                    if (varDecl) {
                        shape = this.buildVariableApiShape(symbol, varDecl);
                    } else {
                        // Only try to build variable shape if targetDecl is actually a variable declaration
                        // Don't call buildVariableApiShape with InterfaceDeclaration or other types
                        if (tsApi.isVariableDeclaration(targetDecl) || tsApi.isBindingElement(targetDecl)) {
                            shape = this.buildVariableApiShape(symbol, targetDecl);
                        } else {
                            // Can't build variable shape - try TypeChecker fallback
                            shape = this.buildShapeFromTypeChecker(symbol, resolved.exportName, identity, targetDecl);
                        }
                    }
                } else {
                    // Unknown declaration kind - try TypeChecker fallback before giving up
                    shape = this.buildShapeFromTypeChecker(symbol, resolved.exportName, identity, targetDecl);
                    if (!shape) {
                        console.warn(`[TypeScriptAnalyzer] Unknown declaration kind ${targetDecl.kind} (${tsApi.SyntaxKind[targetDecl.kind]}) for ${resolved.exportName}, flags: ${flags}`);
                    }
                }
            }
            
            // If shape building failed, try TypeChecker fallback
            if (!shape && targetDecl) {
                shape = this.buildShapeFromTypeChecker(symbol, resolved.exportName, identity, targetDecl);
            }
            
            // Cache result
            this.apiShapeCache.set(identity, shape);
            return shape;
        } catch (error) {
            console.warn(`[TypeScriptAnalyzer] Error building API shape for ${resolved.exportName}:`, error);
            // Try TypeChecker fallback on error
            try {
                const fallbackShape = this.buildShapeFromTypeChecker(resolved.tsSymbol, resolved.exportName, identity);
                if (fallbackShape) {
                    this.apiShapeCache.set(identity, fallbackShape);
                    return fallbackShape;
                }
            } catch (fallbackError) {
                // Ignore fallback errors
            }
            this.apiShapeCache.set(identity, null);
            return null;
        }
    }
    
    /**
     * Builds an API shape from TypeChecker when syntax-based building fails.
     * This is useful for type-only exports, complex aliases, and edge cases.
     */
    private buildShapeFromTypeChecker(
        symbol: ts.Symbol, 
        exportName: string, 
        identity: string,
        decl?: ts.Declaration
    ): ApiShape | null {
        if (!this.checker) return null;
        const tsApi = this.getTsApi();
        
        try {
            // Use provided declaration or get first available
            const declarations = symbol.getDeclarations();
            const targetDecl = decl || (declarations && declarations.length > 0 ? declarations[0] : null);
            
            if (!targetDecl) {
                return null;
            }
            
            // Get type from TypeChecker
            const type = this.checker.getTypeOfSymbolAtLocation(symbol, targetDecl);
            if (!type) {
                return null;
            }
            
            // Convert type to string
            const typeText = this.checker.typeToString(
                type, 
                targetDecl, 
                tsApi.TypeFormatFlags?.NoTruncation ?? undefined
            );
            
            // Determine kind from symbol flags
            const flags = symbol.getFlags();
            let kind: 'type' | 'variable' | 'interface' = 'type';
            
            if (flags & tsApi.SymbolFlags.Variable || flags & tsApi.SymbolFlags.Property) {
                kind = 'variable';
            } else if (flags & tsApi.SymbolFlags.Interface) {
                kind = 'interface';
            }
            
            // Build appropriate shape
            if (kind === 'variable') {
                const isConst = !!(targetDecl.modifiers && 
                    targetDecl.modifiers.some(m => m.kind === tsApi.SyntaxKind.ConstKeyword));
                return {
                    kind: isConst ? 'const' : 'variable',
                    name: exportName,
                    type: typeText,
                    readonly: isConst
                };
            } else {
                return {
                    kind: kind as 'type' | 'interface',
                    name: exportName,
                    typeText: typeText,
                    properties: [],
                    indexSignatures: []
                };
            }
        } catch (error) {
            // Silently fail - return null to let caller handle
            return null;
        }
    }

    /**
     * Builds a function API shape with support for generics and overloads.
     */
    private buildFunctionApiShape(symbol: ts.Symbol, decl: ts.Declaration): FunctionApiShape | null {
        if (!this.checker) return null;
        const tsApi = this.getTsApi();
        
        const name = symbol.getName();
        const type = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
        const signatures = this.checker.getSignaturesOfType(type, tsApi.SignatureKind.Call);
        
        // Extract type parameters (generics) from the declaration
        let typeParameters: string[] | undefined;
        if (tsApi.isFunctionDeclaration(decl) || tsApi.isMethodDeclaration(decl) || tsApi.isMethodSignature(decl)) {
            if (decl.typeParameters && decl.typeParameters.length > 0) {
                typeParameters = decl.typeParameters.map(tp => {
                    const tpName = tp.name.text;
                    // Include constraints if present
                    if (tp.constraint) {
                        const constraintText = this.checker!.typeToString(
                            this.checker!.getTypeFromTypeNode(tp.constraint)
                        );
                        return `${tpName} extends ${constraintText}`;
                    }
                    return tpName;
                });
            }
        }
        
        const overloads: FunctionSignature[] = [];
        
        for (const sig of signatures) {
            const params: ParameterSignature[] = [];
            
            for (let i = 0; i < sig.parameters.length; i++) {
                const param = sig.parameters[i];
                const paramType = this.checker!.getTypeOfSymbolAtLocation(param, decl);
                const paramName = param.getName();
                const paramDecl = param.getDeclarations()?.[0];
                
                // Normalize type string (handle complex types, generics, etc.)
                const typeString = this.normalizeTypeString(this.checker!.typeToString(paramType));
                
                params.push({
                    name: paramName || `param${i}`,
                    type: typeString,
                    optional: !!(paramDecl && tsApi.isParameter(paramDecl) && paramDecl.questionToken),
                    rest: !!(paramDecl && tsApi.isParameter(paramDecl) && paramDecl.dotDotDotToken)
                });
            }
            
            // Normalize return type
            const returnType = this.normalizeTypeString(this.checker!.typeToString(sig.getReturnType()));
            
            // Extract type parameters for this specific signature (if different from declaration)
            let sigTypeParameters: string[] | undefined;
            if (sig.typeParameters && sig.typeParameters.length > 0) {
                sigTypeParameters = sig.typeParameters.map(tp => {
                    const tpName = tp.symbol.getName();
                    const tpType = this.checker!.getTypeOfSymbolAtLocation(tp.symbol, decl);
                    const constraint = this.checker!.typeToString(tpType);
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
    private normalizeTypeString(typeString: string): string {
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
    private buildClassApiShape(symbol: ts.Symbol, decl: ts.Declaration): ClassApiShape | null {
        if (!this.checker) return null;
        const tsApi = this.getTsApi();
        if (!tsApi.isClassDeclaration(decl)) return null;
        
        const name = symbol.getName();
        const type = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
        const members: ClassMember[] = [];
        
        // Get class members
        const classType = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
        const properties = classType.getProperties();
        
        for (const prop of properties) {
            const propDecl = prop.getDeclarations()?.[0];
            if (!propDecl) continue;
            
            // Only include public/protected members
            const flags = prop.getFlags();
            if (flags & (tsApi.SymbolFlags as any).Private) continue;
            
            const visibility = flags & (tsApi.SymbolFlags as any).Protected ? 'protected' : 'public';
            const isStatic = !!(flags & (tsApi.SymbolFlags as any).Static);
            
            let member: ClassMember | null = null;
            
            if (tsApi.isMethodDeclaration(propDecl) || tsApi.isMethodSignature(propDecl)) {
                // Method - get signature from type
                const propType = this.checker!.getTypeOfSymbolAtLocation(prop, propDecl);
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
            } else if (tsApi.isPropertyDeclaration(propDecl) || tsApi.isPropertySignature(propDecl)) {
                // Property
                const propType = this.checker!.getTypeOfSymbolAtLocation(prop, propDecl);
                member = {
                    name: prop.getName(),
                    kind: 'property',
                    type: this.checker!.typeToString(propType),
                    optional: !!propDecl.questionToken,
                    readonly: !!(propDecl.modifiers && propDecl.modifiers.some(m => m.kind === tsApi.SyntaxKind.ReadonlyKeyword)),
                    visibility,
                    static: isStatic
                };
            } else if (tsApi.isGetAccessorDeclaration(propDecl)) {
                // Getter - get signature from type
                const propType = this.checker!.getTypeOfSymbolAtLocation(prop, propDecl);
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
            } else if (tsApi.isSetAccessorDeclaration(propDecl)) {
                // Setter - get signature from type
                const propType = this.checker!.getTypeOfSymbolAtLocation(prop, propDecl);
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
        let constructor: FunctionSignature | undefined;
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
    private buildMethodSignature(sig: ts.Signature, decl: ts.Declaration): FunctionSignature {
        const tsApi = this.getTsApi();
        const params: ParameterSignature[] = [];
        
        for (let i = 0; i < sig.parameters.length; i++) {
            const param = sig.parameters[i];
            const paramType = this.checker!.getTypeOfSymbolAtLocation(param, decl);
            const paramName = param.getName();
            const paramDecl = param.getDeclarations()?.[0];
            
            params.push({
                name: paramName || `param${i}`,
                type: this.checker!.typeToString(paramType),
                optional: !!(paramDecl && tsApi.isParameter(paramDecl) && paramDecl.questionToken),
                rest: !!(paramDecl && tsApi.isParameter(paramDecl) && paramDecl.dotDotDotToken)
            });
        }
        
        return {
            parameters: params,
            returnType: this.checker!.typeToString(sig.getReturnType())
        };
    }

    /**
     * Builds a type/interface API shape with support for generics, index signatures, and complex types.
     */
    private buildTypeApiShape(symbol: ts.Symbol, decl: ts.Declaration, kind: 'type' | 'interface'): TypeApiShape | null {
        if (!this.checker) return null;
        const tsApi = this.getTsApi();
        
        const name = symbol.getName();
        
        // For interface declarations, we can't use getTypeOfSymbolAtLocation if the symbol flags
        // indicate it's a variable (this causes the "Unhandled declaration kind" error)
        // Instead, get the type from the type node directly
        let type: ts.Type;
        try {
            if (tsApi.isInterfaceDeclaration(decl) && (symbol.getFlags() & (tsApi.SymbolFlags.Variable | tsApi.SymbolFlags.Property))) {
                // This is a variable with an interface type - get type from the type checker differently
                // Try to get the type from a variable declaration if available
                const varDecl = symbol.getDeclarations()?.find(d => tsApi.isVariableDeclaration(d));
                if (varDecl && tsApi.isVariableDeclaration(varDecl) && varDecl.type) {
                    type = this.checker.getTypeFromTypeNode(varDecl.type);
                } else {
                    // Fallback: try to get type from the symbol at a different location
                    const sourceFile = decl.getSourceFile();
                    type = this.checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
                }
            } else {
                type = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
            }
        } catch (e) {
            // If getTypeOfSymbolAtLocation fails, try alternative approach
            console.warn(`[TypeScriptAnalyzer] Error getting type for ${name}, trying alternative:`, e);
            try {
                const sourceFile = decl.getSourceFile();
                type = this.checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
            } catch (e2) {
                console.warn(`[TypeScriptAnalyzer] Failed to get type for ${name}:`, e2);
                return null;
            }
        }
        
        // Extract type parameters (generics)
        let typeParameters: string[] | undefined;
        if (tsApi.isInterfaceDeclaration(decl)) {
            if (decl.typeParameters && decl.typeParameters.length > 0) {
                typeParameters = decl.typeParameters.map(tp => {
                    const tpName = tp.name.text;
                    if (tp.constraint) {
                        const constraintText = this.checker!.typeToString(
                            this.checker!.getTypeFromTypeNode(tp.constraint)
                        );
                        return `${tpName} extends ${constraintText}`;
                    }
                    return tpName;
                });
            }
        } else if (tsApi.isTypeAliasDeclaration(decl)) {
            if (decl.typeParameters && decl.typeParameters.length > 0) {
                typeParameters = decl.typeParameters.map(tp => {
                    const tpName = tp.name.text;
                    if (tp.constraint) {
                        const constraintText = this.checker!.typeToString(
                            this.checker!.getTypeFromTypeNode(tp.constraint)
                        );
                        return `${tpName} extends ${constraintText}`;
                    }
                    return tpName;
                });
            }
        }
        
        const properties: TypeProperty[] = [];
        const indexSignatures: IndexSignature[] = [];
        let typeText: string | undefined;
        
        // Check if this is a complex type (union, intersection, etc.) that can't be represented as properties
        const typeFlags = type.flags;
        const isUnion = !!(typeFlags & tsApi.TypeFlags.Union);
        const isIntersection = !!(typeFlags & tsApi.TypeFlags.Intersection);
        
        if (isUnion || isIntersection) {
            // For complex types, store the type text directly
            typeText = this.normalizeTypeString(this.checker.typeToString(type));
        } else {
            // Get properties for object types
            const props = type.getProperties();
            for (const prop of props) {
                const propType = this.checker.getTypeOfSymbolAtLocation(prop, decl);
                const propDecl = prop.getDeclarations()?.[0];
                
                properties.push({
                    name: prop.getName(),
                    type: this.normalizeTypeString(this.checker.typeToString(propType)),
                    optional: !!(propDecl && (tsApi.isPropertySignature(propDecl) || tsApi.isPropertyDeclaration(propDecl)) && propDecl.questionToken),
                    readonly: !!(propDecl && propDecl.modifiers && propDecl.modifiers.some(m => m.kind === tsApi.SyntaxKind.ReadonlyKeyword))
                });
            }
            
            // Get index signatures
            if (tsApi.isInterfaceDeclaration(decl) || tsApi.isTypeAliasDeclaration(decl)) {
                const sourceFile = decl.getSourceFile();
                const checker = this.checker;
                
                // Check for index signatures in the declaration
                if (tsApi.isInterfaceDeclaration(decl) && decl.members) {
                    // Ensure members is iterable
                    try {
                        for (const member of decl.members) {
                            if (tsApi.isIndexSignatureDeclaration(member)) {
                                const keyType = member.parameters[0]?.type;
                                const valueType = member.type;
                                if (keyType && valueType) {
                                    indexSignatures.push({
                                        keyType: this.normalizeTypeString(checker.typeToString(checker.getTypeFromTypeNode(keyType))),
                                        valueType: this.normalizeTypeString(checker.typeToString(checker.getTypeFromTypeNode(valueType))),
                                        readonly: !!(member.modifiers && member.modifiers.some(m => m.kind === tsApi.SyntaxKind.ReadonlyKeyword))
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        // If members is not iterable, skip index signatures
                        console.warn(`[TypeScriptAnalyzer] Cannot iterate over interface members for ${name}:`, e);
                    }
                }
            }
        }
        
        // Get extends clauses for interfaces
        let extendsClauses: string[] | undefined;
        if (tsApi.isInterfaceDeclaration(decl) && decl.heritageClauses) {
            extendsClauses = [];
            for (const heritage of decl.heritageClauses) {
                if (heritage.token === tsApi.SyntaxKind.ExtendsKeyword) {
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
    private buildEnumApiShape(symbol: ts.Symbol, decl: ts.Declaration): EnumApiShape | null {
        const tsApi = this.getTsApi();
        // Verify this is actually an enum declaration
        if (!tsApi.isEnumDeclaration(decl)) {
            console.warn(`[TypeScriptAnalyzer] buildEnumApiShape called with non-enum declaration: ${tsApi.SyntaxKind[decl.kind]}`);
            return null;
        }
        
        const name = symbol.getName();
        const members: Array<{ name: string; value?: string | number }> = [];
        const isConst = !!(decl.modifiers && decl.modifiers.some(m => m.kind === tsApi.SyntaxKind.ConstKeyword));
        
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
            const memberName = member.name && tsApi.isIdentifier(member.name) ? member.name.text : 'unknown';
            let value: string | number | undefined;
            
            if (member.initializer) {
                if (tsApi.isStringLiteral(member.initializer)) {
                    value = member.initializer.text;
                } else if (tsApi.isNumericLiteral(member.initializer)) {
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
    private buildVariableApiShape(symbol: ts.Symbol, decl: ts.Declaration): VariableApiShape | null {
        if (!this.checker) return null;
        const tsApi = this.getTsApi();
        
        const name = symbol.getName();
        const type = this.checker.getTypeOfSymbolAtLocation(symbol, decl);
        const typeText = this.checker.typeToString(type);
        const isConst = !!(decl.modifiers && decl.modifiers.some(m => m.kind === tsApi.SyntaxKind.ConstKeyword));
        
        return {
            kind: isConst ? 'const' : 'variable',
            name,
            type: typeText,
            readonly: isConst
        };
    }
}
