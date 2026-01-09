/**
 * Fix Context - provides everything needed to compute fixes
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { FixContext as IFixContext, SymbolDeclaration, FixSettings } from './FixTypes';
import { ReferenceIndex } from './index/ReferenceIndex';
import { debugLog } from '../core/debug-logger';

/**
 * Default fix settings
 */
const DEFAULT_SETTINGS: FixSettings = {
    minConfidence: 0.7,
    maxFiles: 10,
    showLowConfidence: false
};

/**
 * Fix context implementation
 */
export class FixContextImpl implements IFixContext {
    public readonly projectRoot: string;
    public readonly compilerOptions: ts.CompilerOptions;
    public readonly referenceIndex: ReferenceIndex;
    public readonly settings: FixSettings;

    private fileTextCache: Map<string, string> = new Map();
    private symbolCache: Map<string, SymbolDeclaration | null> = new Map();
    private program: ts.Program | null = null;

    constructor(
        projectRoot: string,
        compilerOptions: ts.CompilerOptions,
        referenceIndex: ReferenceIndex,
        settings?: Partial<FixSettings>
    ) {
        this.projectRoot = projectRoot;
        this.compilerOptions = compilerOptions;
        this.referenceIndex = referenceIndex;
        this.settings = { ...DEFAULT_SETTINGS, ...settings };
    }

    /**
     * Create fix context from project root
     */
    static async create(
        projectRoot: string,
        settings?: Partial<FixSettings>
    ): Promise<FixContextImpl> {
        // Find and load tsconfig.json
        const tsConfigPath = this.findTsConfig(projectRoot);
        let compilerOptions: ts.CompilerOptions = {
            target: ts.ScriptTarget.Latest,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            esModuleInterop: true,
            skipLibCheck: true
        };

        if (tsConfigPath) {
            const config = ts.readConfigFile(tsConfigPath, (path) => fs.readFileSync(path, 'utf8'));
            if (config.config) {
                const parsed = ts.parseJsonConfigFileContent(
                    config.config,
                    ts.sys,
                    path.dirname(tsConfigPath)
                );
                compilerOptions = { ...compilerOptions, ...parsed.options };
            }
        }

        // Create reference index
        const referenceIndex = new ReferenceIndex(projectRoot, compilerOptions);
        await referenceIndex.buildIndex();

        const context = new FixContextImpl(projectRoot, compilerOptions, referenceIndex, settings);

        // Build TypeScript program for symbol resolution
        const allTsFiles = context.collectTypeScriptFiles(projectRoot);
        const host = ts.createCompilerHost(compilerOptions);
        context.program = ts.createProgram(allTsFiles, compilerOptions, host);

        return context;
    }

    /**
     * Get file text (from cache or disk)
     */
    async getFileText(uri: string): Promise<string> {
        // Check cache first
        if (this.fileTextCache.has(uri)) {
            return this.fileTextCache.get(uri)!;
        }

        // Try to get from VS Code workspace if available
        try {
            const vscodeUri = vscode.Uri.parse(uri);
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
            if (doc) {
                const text = doc.getText();
                this.fileTextCache.set(uri, text);
                return text;
            }
        } catch {
            // Not a VS Code URI or document not open
        }

        // Fallback to file system
        const filePath = vscode.Uri.parse(uri).fsPath;
        if (fs.existsSync(filePath)) {
            const text = fs.readFileSync(filePath, 'utf8');
            this.fileTextCache.set(uri, text);
            return text;
        }

        throw new Error(`File not found: ${uri}`);
    }

    /**
     * Resolve symbol to declaration
     */
    async resolveSymbol(symbolId: string): Promise<SymbolDeclaration | null> {
        // Check cache
        if (this.symbolCache.has(symbolId)) {
            return this.symbolCache.get(symbolId)!;
        }

        if (!this.program) {
            return null;
        }

        const checker = this.program.getTypeChecker();

        // Parse symbolId: fileName#symbolName
        const parts = symbolId.split('#');
        if (parts.length !== 2) {
            this.symbolCache.set(symbolId, null);
            return null;
        }

        const [fileName, symbolName] = parts;
        const sourceFile = this.program.getSourceFile(fileName);
        if (!sourceFile) {
            this.symbolCache.set(symbolId, null);
            return null;
        }

        // Find symbol in file
        const findSymbol = (node: ts.Node): ts.Symbol | null => {
            const symbol = checker.getSymbolAtLocation(node);
            if (symbol && symbol.getName() === symbolName) {
                return symbol;
            }
            let found: ts.Symbol | null = null;
            ts.forEachChild(node, (child) => {
                if (!found) {
                    found = findSymbol(child);
                }
            });
            return found;
        };

        const symbol = findSymbol(sourceFile);
        if (!symbol) {
            this.symbolCache.set(symbolId, null);
            return null;
        }

        const declarations = symbol.getDeclarations();
        if (!declarations || declarations.length === 0) {
            this.symbolCache.set(symbolId, null);
            return null;
        }

        const decl = declarations[0];
        const start = decl.getStart(sourceFile);
        const end = decl.getEnd();
        const startPos = sourceFile.getLineAndCharacterOfPosition(start);
        const endPos = sourceFile.getLineAndCharacterOfPosition(end);

        const result: SymbolDeclaration = {
            symbolId,
            uri: vscode.Uri.file(fileName).toString(),
            range: new vscode.Range(
                startPos.line,
                startPos.character,
                endPos.line,
                endPos.character
            ),
            name: symbolName,
            kind: this.getSymbolKind(symbol, checker)
        };

        // Extract parameters if function
        if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) {
            result.parameters = decl.parameters.map(p => ({
                name: p.name ? (ts.isIdentifier(p.name) ? p.name.text : '') : '',
                type: p.type ? p.type.getText(sourceFile) : 'any',
                optional: !!p.questionToken,
                defaultValue: p.initializer ? p.initializer.getText(sourceFile) : undefined
            }));
        }

        this.symbolCache.set(symbolId, result);
        return result;
    }

    /**
     * Get symbol kind from TypeScript symbol
     */
    private getSymbolKind(symbol: ts.Symbol, checker: ts.TypeChecker): SymbolDeclaration['kind'] {
        const flags = symbol.getFlags();
        if (flags & ts.SymbolFlags.Function) return 'function';
        if (flags & ts.SymbolFlags.Class) return 'class';
        if (flags & ts.SymbolFlags.Interface) return 'interface';
        if (flags & ts.SymbolFlags.TypeAlias) return 'type';
        if (flags & ts.SymbolFlags.Enum) return 'enum';
        return 'variable';
    }

    /**
     * Collect TypeScript files
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
            } catch {
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
    private static findTsConfig(dir: string): string | null {
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

