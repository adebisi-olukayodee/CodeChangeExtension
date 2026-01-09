/**
 * Reference Index - tracks symbol references (call sites, import sites, etc.)
 * Maps symbolId → references[] for downstream-aware fixes
 */

import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { Reference, ReferenceIndex as IReferenceIndex } from '../FixTypes';
import { DependencyAnalyzer } from '../../analyzers/DependencyAnalyzer';
import { debugLog } from '../../core/debug-logger';

/**
 * Reference index implementation using TypeScript AST
 */
export class ReferenceIndex implements IReferenceIndex {
    private symbolToReferences: Map<string, Reference[]> = new Map();
    private fileToReferences: Map<string, Reference[]> = new Map();
    private dependencyAnalyzer: DependencyAnalyzer;
    private projectRoot: string;
    private compilerOptions: ts.CompilerOptions;
    private program: ts.Program | null = null;

    constructor(projectRoot: string, compilerOptions: ts.CompilerOptions) {
        this.projectRoot = projectRoot;
        this.compilerOptions = compilerOptions;
        this.dependencyAnalyzer = new DependencyAnalyzer();
    }

    /**
     * Build the reference index by scanning all TypeScript files
     */
    async buildIndex(): Promise<void> {
        debugLog(`[ReferenceIndex] Building reference index from: ${this.projectRoot}`);
        this.symbolToReferences.clear();
        this.fileToReferences.clear();

        // Build TypeScript program for symbol resolution
        const tsConfigPath = this.findTsConfig(this.projectRoot);
        if (tsConfigPath) {
            const config = ts.readConfigFile(tsConfigPath, (path) => fs.readFileSync(path, 'utf8'));
            if (config.config) {
                const parsed = ts.parseJsonConfigFileContent(
                    config.config,
                    ts.sys,
                    path.dirname(tsConfigPath)
                );
                this.compilerOptions = { ...this.compilerOptions, ...parsed.options };
            }
        }

        const allTsFiles = this.collectTypeScriptFiles(this.projectRoot);
        debugLog(`[ReferenceIndex] Found ${allTsFiles.length} TypeScript files`);

        // Create TypeScript program
        const host = ts.createCompilerHost(this.compilerOptions);
        this.program = ts.createProgram(allTsFiles, this.compilerOptions, host);

        // Get type checker for symbol resolution
        const checker = this.program.getTypeChecker();

        // Process each file
        for (const filePath of allTsFiles) {
            try {
                const sourceFile = this.program!.getSourceFile(filePath);
                if (!sourceFile) continue;

                const uri = vscode.Uri.file(filePath).toString();
                const fileReferences: Reference[] = [];

                // Visit all nodes to find references
                const visit = (node: ts.Node): void => {
                    // Find call expressions
                    if (ts.isCallExpression(node)) {
                        const callRefs = this.extractCallReferences(node, sourceFile, checker, uri);
                        fileReferences.push(...callRefs);
                    }

                    // Find property access expressions
                    if (ts.isPropertyAccessExpression(node)) {
                        const propRefs = this.extractPropertyReferences(node, sourceFile, checker, uri);
                        fileReferences.push(...propRefs);
                    }

                    // Find import declarations (already tracked by DependencyAnalyzer, but we need symbol IDs)
                    if (ts.isImportDeclaration(node)) {
                        const importRefs = this.extractImportReferences(node, sourceFile, checker, uri);
                        fileReferences.push(...importRefs);
                    }

                    // Find type references
                    if (ts.isTypeReference(node)) {
                        const typeRefs = this.extractTypeReferences(node, sourceFile, checker, uri);
                        fileReferences.push(...typeRefs);
                    }

                    ts.forEachChild(node, visit);
                };

                visit(sourceFile);

                // Store file references
                if (fileReferences.length > 0) {
                    this.fileToReferences.set(uri, fileReferences);

                    // Index by symbol ID
                    for (const ref of fileReferences) {
                        if (!this.symbolToReferences.has(ref.symbolId)) {
                            this.symbolToReferences.set(ref.symbolId, []);
                        }
                        this.symbolToReferences.get(ref.symbolId)!.push(ref);
                    }
                }
            } catch (error) {
                console.error(`[ReferenceIndex] Error processing file ${filePath}:`, error);
            }
        }

        debugLog(`[ReferenceIndex] Index built: ${this.symbolToReferences.size} symbols have references`);
    }

    /**
     * Get all references to a symbol
     */
    getReferences(symbolId: string): Reference[] {
        return this.symbolToReferences.get(symbolId) || [];
    }

    /**
     * Get references in a specific file
     */
    getReferencesInFile(uri: string): Reference[] {
        return this.fileToReferences.get(uri) || [];
    }

    /**
     * Check if symbol has references
     */
    hasReferences(symbolId: string): boolean {
        return this.symbolToReferences.has(symbolId) && this.symbolToReferences.get(symbolId)!.length > 0;
    }

    /**
     * Update index for a file (incremental)
     */
    async updateFile(uri: string, content: string): Promise<void> {
        const filePath = vscode.Uri.parse(uri).fsPath;
        const sourceFile = ts.createSourceFile(
            filePath,
            content,
            this.compilerOptions.target || ts.ScriptTarget.Latest,
            true
        );

        // Remove old references for this file
        const oldRefs = this.fileToReferences.get(uri) || [];
        for (const ref of oldRefs) {
            const symbolRefs = this.symbolToReferences.get(ref.symbolId);
            if (symbolRefs) {
                const index = symbolRefs.findIndex(r => r.uri === uri && r.range.isEqual(ref.range));
                if (index >= 0) {
                    symbolRefs.splice(index, 1);
                }
            }
        }
        this.fileToReferences.delete(uri);

        // Rebuild references for this file
        if (this.program) {
            const checker = this.program.getTypeChecker();
            const fileReferences: Reference[] = [];

            const visit = (node: ts.Node): void => {
                if (ts.isCallExpression(node)) {
                    const callRefs = this.extractCallReferences(node, sourceFile, checker, uri);
                    fileReferences.push(...callRefs);
                }
                if (ts.isPropertyAccessExpression(node)) {
                    const propRefs = this.extractPropertyReferences(node, sourceFile, checker, uri);
                    fileReferences.push(...propRefs);
                }
                if (ts.isImportDeclaration(node)) {
                    const importRefs = this.extractImportReferences(node, sourceFile, checker, uri);
                    fileReferences.push(...importRefs);
                }
                if (ts.isTypeReference(node)) {
                    const typeRefs = this.extractTypeReferences(node, sourceFile, checker, uri);
                    fileReferences.push(...typeRefs);
                }
                ts.forEachChild(node, visit);
            };

            visit(sourceFile);

            // Store new references
            if (fileReferences.length > 0) {
                this.fileToReferences.set(uri, fileReferences);
                for (const ref of fileReferences) {
                    if (!this.symbolToReferences.has(ref.symbolId)) {
                        this.symbolToReferences.set(ref.symbolId, []);
                    }
                    this.symbolToReferences.get(ref.symbolId)!.push(ref);
                }
            }
        }
    }

    /**
     * Extract call expression references
     */
    private extractCallReferences(
        node: ts.CallExpression,
        sourceFile: ts.SourceFile,
        checker: ts.TypeChecker,
        uri: string
    ): Reference[] {
        const refs: Reference[] = [];
        const expression = node.expression;

        // Get symbol from expression
        const symbol = checker.getSymbolAtLocation(expression);
        if (symbol) {
            const symbolId = this.getSymbolId(symbol, checker);
            if (symbolId) {
                const range = this.getNodeRange(node, sourceFile);
                refs.push({
                    uri,
                    range,
                    nodeKind: 'call',
                    symbolId,
                    nodeInfo: {
                        text: node.getText(sourceFile),
                        parentKind: node.parent ? ts.SyntaxKind[node.parent.kind] : undefined
                    }
                });
            }
        }

        return refs;
    }

    /**
     * Extract property access references
     */
    private extractPropertyReferences(
        node: ts.PropertyAccessExpression,
        sourceFile: ts.SourceFile,
        checker: ts.TypeChecker,
        uri: string
    ): Reference[] {
        const refs: Reference[] = [];
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) {
            const symbolId = this.getSymbolId(symbol, checker);
            if (symbolId) {
                const range = this.getNodeRange(node, sourceFile);
                refs.push({
                    uri,
                    range,
                    nodeKind: 'property-access',
                    symbolId,
                    nodeInfo: {
                        text: node.getText(sourceFile),
                        parentKind: node.parent ? ts.SyntaxKind[node.parent.kind] : undefined
                    }
                });
            }
        }
        return refs;
    }

    /**
     * Extract import references
     */
    private extractImportReferences(
        node: ts.ImportDeclaration,
        sourceFile: ts.SourceFile,
        checker: ts.TypeChecker,
        uri: string
    ): Reference[] {
        const refs: Reference[] = [];
        if (node.importClause) {
            if (node.importClause.namedBindings) {
                if (ts.isNamedImports(node.importClause.namedBindings)) {
                    for (const element of node.importClause.namedBindings.elements) {
                        const symbol = checker.getSymbolAtLocation(element);
                        if (symbol) {
                            const symbolId = this.getSymbolId(symbol, checker);
                            if (symbolId) {
                                const range = this.getNodeRange(element, sourceFile);
                                refs.push({
                                    uri,
                                    range,
                                    nodeKind: 'import',
                                    symbolId,
                                    nodeInfo: {
                                        text: element.getText(sourceFile)
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }
        return refs;
    }

    /**
     * Extract type references
     */
    private extractTypeReferences(
        node: ts.TypeReferenceNode,
        sourceFile: ts.SourceFile,
        checker: ts.TypeChecker,
        uri: string
    ): Reference[] {
        const refs: Reference[] = [];
        const symbol = checker.getSymbolAtLocation(node.typeName);
        if (symbol) {
            const symbolId = this.getSymbolId(symbol, checker);
            if (symbolId) {
                const range = this.getNodeRange(node, sourceFile);
                refs.push({
                    uri,
                    range,
                    nodeKind: 'type-ref',
                    symbolId,
                    nodeInfo: {
                        text: node.getText(sourceFile)
                    }
                });
            }
        }
        return refs;
    }

    /**
     * Get stable symbol ID from TypeScript symbol
     */
    private getSymbolId(symbol: ts.Symbol, checker: ts.TypeChecker): string | null {
        // Try to get fully qualified name
        const name = symbol.getName();
        const declarations = symbol.getDeclarations();
        if (declarations && declarations.length > 0) {
            const decl = declarations[0];
            const sourceFile = decl.getSourceFile();
            const fileName = sourceFile.fileName;
            // Create stable ID: fileName#symbolName
            return `${fileName}#${name}`;
        }
        return null;
    }

    /**
     * Get VS Code range from TypeScript node
     */
    private getNodeRange(node: ts.Node, sourceFile: ts.SourceFile): vscode.Range {
        const start = node.getStart(sourceFile);
        const end = node.getEnd();
        const startPos = sourceFile.getLineAndCharacterOfPosition(start);
        const endPos = sourceFile.getLineAndCharacterOfPosition(end);
        return new vscode.Range(
            startPos.line,
            startPos.character,
            endPos.line,
            endPos.character
        );
    }

    /**
     * Collect all TypeScript files in project
     */
    private collectTypeScriptFiles(dir: string): string[] {
        const files: string[] = [];
        const collect = (d: string) => {
            try {
                const items = fs.readdirSync(d);
                for (const item of items) {
                    const itemPath = path.join(d, item);
                    const stat = fs.statSync(itemPath);
                    if (stat.isDirectory()) {
                        if (!this.shouldSkipDirectory(item)) {
                            collect(itemPath);
                        }
                    } else if (stat.isFile() && this.isSourceFile(item)) {
                        files.push(itemPath);
                    }
                }
            } catch (error) {
                // Ignore errors
            }
        };
        collect(dir);
        return files;
    }

    /**
     * Check if directory should be skipped
     */
    private shouldSkipDirectory(name: string): boolean {
        return name === 'node_modules' || name === '.git' || name === 'dist' || name === 'build' || name.startsWith('.');
    }

    /**
     * Check if file is a source file
     */
    private isSourceFile(name: string): boolean {
        return /\.(ts|tsx)$/i.test(name);
    }

    /**
     * Find tsconfig.json
     */
    private findTsConfig(dir: string): string | null {
        let current = dir;
        while (current) {
            const configPath = path.join(current, 'tsconfig.json');
            if (fs.existsSync(configPath)) {
                return configPath;
            }
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
        return null;
    }
}

