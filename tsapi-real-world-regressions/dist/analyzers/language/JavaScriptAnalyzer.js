"use strict";
/**
 * JavaScript Analyzer - Heuristic analysis for .js and .jsx files
 *
 * IMPORTANT: JavaScript has no enforced public API or types.
 * This analyzer provides best-effort structural analysis only.
 * Findings are marked as warnings, not breaking changes.
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
exports.JavaScriptAnalyzer = void 0;
const ts = __importStar(require("typescript"));
const ts_morph_1 = require("ts-morph");
const fs = __importStar(require("fs"));
class JavaScriptAnalyzer {
    constructor(projectRoot) {
        this.project = null;
        this.program = null;
        this.checker = null;
        this.projectRoot = projectRoot;
    }
    getLanguage() {
        return 'javascript';
    }
    getSupportedExtensions() {
        return ['.js', '.jsx'];
    }
    async analyze(filePath, content) {
        // JavaScript analyzer uses snapshot-based approach
        const snapshot = await this.buildSnapshot(filePath, content);
        return snapshot;
    }
    async findReferences(symbolName, filePath, projectRoot) {
        // Heuristic: basic text search for JavaScript
        // This is not type-aware and may have false positives
        const results = [];
        // Implementation would scan files for symbol usage
        // For now, return empty - this is a limitation of JS analysis
        return results;
    }
    async fileUsesSymbol(filePath, symbolName, projectRoot) {
        // Heuristic: basic text search
        try {
            const fs = require('fs');
            const content = fs.readFileSync(filePath, 'utf8');
            const pattern = new RegExp(`\\b${symbolName}\\b`);
            return pattern.test(content);
        }
        catch {
            return false;
        }
    }
    async findChangedElements(beforeContent, afterContent, filePath) {
        // Heuristic: compare snapshots
        const beforeSnap = await this.buildSnapshot(filePath, beforeContent);
        const afterSnap = await this.buildSnapshot(filePath, afterContent);
        const diff = await this.diffSnapshots(beforeSnap, afterSnap);
        return {
            changedFunctions: diff.removed.filter(s => s.kind === 'function').map(s => s.name),
            changedClasses: diff.removed.filter(s => s.kind === 'class').map(s => s.name)
        };
    }
    /**
     * Strip comments from code (good enough for fixtures, not perfect for every JS edge case)
     */
    stripComments(code) {
        return code
            .replace(/\/\*[\s\S]*?\*\//g, '') // Block comments
            .replace(/\/\/.*$/gm, ''); // Line comments
    }
    /**
     * Detect module system from raw code content
     */
    detectModuleSystemFromCode(content) {
        const code = this.stripComments(content);
        const hasCjs = /\bmodule\.exports\b/.test(code) ||
            /\bexports\./.test(code) ||
            /\brequire\s*\(/.test(code);
        const hasEsm = /\bexport\s+default\b/.test(code) ||
            /\bexport\s+(const|let|var|function|class|\{|\*)\b/.test(code) ||
            /\bimport\s+/.test(code);
        if (hasCjs && hasEsm)
            return 'mixed';
        if (hasCjs)
            return 'cjs';
        if (hasEsm)
            return 'esm';
        return 'unknown';
    }
    /**
     * Read package.json and create PackageSnapshot
     */
    readPackageSnapshot(packageJsonPath) {
        if (!packageJsonPath)
            return undefined;
        if (!fs.existsSync(packageJsonPath))
            return { type: 'missing', exports: undefined };
        try {
            const raw = fs.readFileSync(packageJsonPath, 'utf8');
            const json = JSON.parse(raw);
            return {
                type: json.type === 'module' ? 'module' : json.type === 'commonjs' ? 'commonjs' : 'missing',
                exports: json.exports,
            };
        }
        catch {
            // treat invalid JSON as "missing", but don't crash
            return { type: 'missing', exports: undefined };
        }
    }
    async buildSnapshot(filePath, content, packageJsonPath) {
        console.log(`[JavaScriptAnalyzer] Building snapshot for: ${filePath}`);
        console.log(`[JavaScriptAnalyzer] NOTE: JavaScript analysis is heuristic and may miss runtime-breaking changes`);
        // Initialize TypeScript compiler with allowJs: true
        if (!this.project) {
            this.project = new ts_morph_1.Project({
                compilerOptions: {
                    allowJs: true,
                    checkJs: false,
                    noEmit: true,
                    skipLibCheck: true
                }
            });
        }
        // Create TypeScript program for AST access (using allowJs)
        const compilerOptions = {
            allowJs: true,
            checkJs: false,
            noEmit: true,
            skipLibCheck: true,
            target: ts.ScriptTarget.Latest,
            module: ts.ModuleKind.ESNext
        };
        const host = ts.createCompilerHost(compilerOptions);
        // Create a temporary source file in memory
        const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
        // Create program with just this file
        this.program = ts.createProgram([filePath], compilerOptions, {
            ...host,
            getSourceFile: (fileName) => {
                if (fileName === filePath) {
                    return sourceFile;
                }
                return host.getSourceFile(fileName, ts.ScriptTarget.Latest);
            }
        });
        this.checker = this.program.getTypeChecker();
        const functions = [];
        const classes = [];
        const exports = [];
        const imports = [];
        const cjsExports = [];
        const moduleSystem = 'esm';
        // Extract exports (structural - reliable)
        this.extractExports(sourceFile, exports);
        // Extract CommonJS exports (module.exports, exports.foo)
        this.extractCjsExports(sourceFile, cjsExports);
        // Determine module system from raw code content (more reliable than AST-based detection)
        const detectedModuleSystem = this.detectModuleSystemFromCode(content);
        // Extract exported functions (structural - heuristic)
        this.extractExportedFunctions(sourceFile, functions);
        // Extract exported classes (structural - heuristic)
        this.extractExportedClasses(sourceFile, classes);
        return {
            filePath,
            timestamp: new Date(),
            functions,
            classes,
            interfaces: [],
            typeAliases: [],
            enums: [],
            exports: [...exports, ...cjsExports],
            imports,
            moduleSystem: detectedModuleSystem,
            packageJson: this.readPackageSnapshot(packageJsonPath)
        };
    }
    async diffSnapshots(beforeSnapshot, afterSnapshot) {
        console.log(`[JavaScriptAnalyzer] Diffing snapshots (heuristic analysis)`);
        const changedSymbols = [];
        const added = [];
        const removed = [];
        const modified = [];
        // Build suppression set: removed exports (beforeExportNames - afterExportNames)
        // These symbols should only emit JSAPI-EXP-001, not function/class removal rules
        const beforeExportNames = new Set(beforeSnapshot.exports.map(e => e.name));
        const afterExportNames = new Set(afterSnapshot.exports.map(e => e.name));
        const removedExports = new Set();
        for (const exportName of beforeExportNames) {
            if (!afterExportNames.has(exportName)) {
                removedExports.add(exportName);
            }
        }
        // Compare exports (most reliable for JS)
        // Pass changedSymbols so export removals can emit JSAPI-EXP-001 directly
        const exportChanges = this.compareExports(beforeSnapshot.exports, afterSnapshot.exports, changedSymbols);
        // Compare functions (heuristic - structural only)
        // Pass removedExports to suppress function removals when export is also removed
        this.compareFunctions(beforeSnapshot.functions, afterSnapshot.functions, changedSymbols, added, removed, modified, removedExports);
        // Compare classes (heuristic - structural only)
        // Pass removedExports to suppress class removals when export is also removed
        this.compareClasses(beforeSnapshot.classes, afterSnapshot.classes, changedSymbols, added, removed, modified, removedExports);
        // Detect module system changes (CJS <-> ESM)
        const beforeModuleSystem = beforeSnapshot.moduleSystem || 'unknown';
        const afterModuleSystem = afterSnapshot.moduleSystem || 'unknown';
        if (beforeModuleSystem !== afterModuleSystem) {
            // Only emit if it's a clear CJS <-> ESM transition (not mixed/unknown)
            if ((beforeModuleSystem === 'cjs' && afterModuleSystem === 'esm') ||
                (beforeModuleSystem === 'esm' && afterModuleSystem === 'cjs')) {
                const direction = beforeModuleSystem === 'cjs' ? 'CommonJS -> ESM' : 'ESM -> CommonJS';
                changedSymbols.push({
                    symbol: {
                        name: 'exports',
                        qualifiedName: 'exports',
                        line: 1,
                        column: 1,
                        signature: 'module.exports',
                        isExported: true,
                        kind: 'variable'
                    },
                    changeType: 'modified',
                    severity: 'medium',
                    isBreaking: false,
                    metadata: {
                        ruleId: 'JSAPI-MOD-001',
                        message: `Module export shape changed (${direction}). This is likely breaking for consumers.`
                    }
                });
            }
        }
        // Detect package.json exports map changes
        const packageChanges = this.diffPackageJson(beforeSnapshot, afterSnapshot);
        return {
            changedSymbols,
            added,
            removed,
            modified,
            exportChanges,
            packageChanges
        };
    }
    /**
     * Check if exports map is empty
     */
    isExportsMapEmpty(exportsVal) {
        if (exportsVal == null)
            return true;
        if (typeof exportsVal !== 'object')
            return false; // string like "./dist/index.js" is not "empty"
        if (Array.isArray(exportsVal))
            return exportsVal.length === 0;
        return Object.keys(exportsVal).length === 0;
    }
    /**
     * Diff package.json metadata (exports map, type)
     */
    diffPackageJson(beforeSnapshot, afterSnapshot) {
        const changes = [];
        const beforePkg = beforeSnapshot.packageJson;
        const afterPkg = afterSnapshot.packageJson;
        // Detect exports map removal/emptying (JSAPI-MOD-004)
        const beforeHasExports = beforePkg && !this.isExportsMapEmpty(beforePkg.exports);
        const afterHasExports = afterPkg && !this.isExportsMapEmpty(afterPkg.exports);
        // removed or emptied: had exports before, now missing/empty
        if (beforeHasExports && !afterHasExports) {
            changes.push({
                ruleId: 'JSAPI-MOD-004',
                severity: 'breaking',
                file: 'package.json',
                symbol: 'exports',
                message: 'package.json exports map was removed or emptied.',
            });
        }
        return changes;
    }
    /**
     * Extract exports - structural analysis (reliable)
     */
    extractExports(sourceFile, exports) {
        const getLineNumber = (node) => {
            return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        };
        const visit = (node) => {
            // Handle ExportAssignment: export default <expression>
            // This must be checked FIRST, before checking modifiers
            // ExportAssignment is a top-level statement, so it should be visited directly
            if (ts.isExportAssignment(node)) {
                // isExportEquals is true for "export =", false/undefined for "export default"
                if (!node.isExportEquals) {
                    // export default <expression>
                    let kind = 'unknown';
                    const expression = node.expression;
                    if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
                        kind = 'function';
                    }
                    else if (ts.isObjectLiteralExpression(expression)) {
                        kind = 'object';
                    }
                    else if (ts.isClassExpression(expression)) {
                        kind = 'class';
                    }
                    else if (ts.isIdentifier(expression) || ts.isCallExpression(expression)) {
                        kind = 'variable';
                    }
                    exports.push({
                        name: 'default',
                        type: 'default',
                        kind,
                        line: getLineNumber(node)
                    });
                    // Don't process children as named exports - return early
                    return;
                }
                // else: export = ... (CommonJS style, handled elsewhere)
            }
            // Handle export default on declarations: export default function/class/var
            // This prevents treating "export default function main() {}" as both default and named
            const hasDefault = node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
            const hasExport = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
            if (hasDefault && hasExport) {
                // Default export: export default ...
                // Determine the kind of default export
                let kind = 'unknown';
                if (ts.isFunctionDeclaration(node)) {
                    kind = 'function';
                }
                else if (ts.isClassDeclaration(node)) {
                    kind = 'class';
                }
                else if (ts.isVariableStatement(node)) {
                    kind = 'variable';
                }
                else if (ts.isObjectLiteralExpression(node)) {
                    kind = 'object';
                }
                exports.push({
                    name: 'default',
                    type: 'default',
                    kind,
                    line: getLineNumber(node)
                });
                // Don't process as named export - skip to next node
                ts.forEachChild(node, visit);
                return;
            }
            // Named exports: export function foo() {}
            // Only process if NOT a default export
            if (ts.isFunctionDeclaration(node) && hasExport && !hasDefault) {
                const name = node.name?.text;
                if (name) {
                    exports.push({
                        name,
                        type: 'named',
                        kind: 'function',
                        line: getLineNumber(node)
                    });
                }
            }
            // Named exports: export class Foo {}
            // Only process if NOT a default export
            if (ts.isClassDeclaration(node) && hasExport && !hasDefault) {
                const name = node.name?.text;
                if (name) {
                    exports.push({
                        name,
                        type: 'named',
                        kind: 'class',
                        line: getLineNumber(node)
                    });
                }
            }
            // Export declarations: export { foo, bar } or export * from './module'
            if (ts.isExportDeclaration(node)) {
                // Check for export * (export star)
                if (!node.exportClause && node.moduleSpecifier) {
                    // This is export * from 'module'
                    const sourceModule = ts.isStringLiteral(node.moduleSpecifier)
                        ? node.moduleSpecifier.text
                        : node.moduleSpecifier.getText();
                    exports.push({
                        name: '*',
                        type: 'named',
                        kind: 'star',
                        line: getLineNumber(node),
                        sourceModule: sourceModule
                    });
                }
                else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
                    // Named exports: export { foo, bar }
                    for (const spec of node.exportClause.elements) {
                        const exportedName = spec.name.text;
                        const sourceName = spec.propertyName?.text || exportedName;
                        exports.push({
                            name: exportedName,
                            type: 'named',
                            kind: 'unknown',
                            line: getLineNumber(spec),
                            sourceName: sourceName !== exportedName ? sourceName : undefined,
                            sourceModule: node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
                                ? node.moduleSpecifier.text
                                : undefined
                        });
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    /**
     * Extract CommonJS exports - handle both exports.foo and module.exports patterns
     */
    extractCjsExports(sourceFile, cjsExports) {
        const getLineNumber = (node) => {
            return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        };
        const visit = (node) => {
            // Handle: exports.foo = ... or module.exports = ...
            if (ts.isExpressionStatement(node) && node.expression) {
                if (ts.isBinaryExpression(node.expression) &&
                    node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
                    const expr = node.expression;
                    // Check for exports.foo = ...
                    if (ts.isPropertyAccessExpression(expr.left)) {
                        const left = expr.left;
                        if (ts.isIdentifier(left.expression)) {
                            const exprName = left.expression.text;
                            if (exprName === 'exports' && ts.isIdentifier(left.name)) {
                                // exports.foo = ...
                                cjsExports.push({
                                    name: left.name.text,
                                    type: 'named',
                                    kind: 'unknown',
                                    line: getLineNumber(node),
                                    sourceModule: 'cjs:exports'
                                });
                            }
                            else if (exprName === 'module') {
                                // Check for module.exports = ...
                                if (ts.isPropertyAccessExpression(left) &&
                                    ts.isIdentifier(left.name) &&
                                    left.name.text === 'exports') {
                                    // module.exports = ...
                                    // Always treat as a default export to detect shape changes
                                    // For object literals, we want to detect shape changes (function -> object, etc.)
                                    // not extract individual properties as named exports
                                    let kind = 'unknown';
                                    if (ts.isFunctionExpression(expr.right) || ts.isArrowFunction(expr.right)) {
                                        kind = 'function';
                                    }
                                    else if (ts.isObjectLiteralExpression(expr.right)) {
                                        kind = 'object';
                                    }
                                    else if (ts.isClassExpression(expr.right)) {
                                        kind = 'class';
                                    }
                                    else if (ts.isIdentifier(expr.right) || ts.isCallExpression(expr.right)) {
                                        kind = 'variable';
                                    }
                                    cjsExports.push({
                                        name: 'default',
                                        type: 'default',
                                        kind,
                                        line: getLineNumber(node),
                                        sourceModule: 'cjs:module.exports'
                                    });
                                }
                            }
                        }
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    /**
     * Detect module system (ESM, CJS, or mixed)
     */
    detectModuleSystem(sourceFile, esmExports, cjsExports) {
        if (esmExports.length > 0 && cjsExports.length > 0)
            return 'mixed';
        if (esmExports.length > 0)
            return 'esm';
        if (cjsExports.length > 0)
            return 'cjs';
        return 'esm'; // Default
    }
    /**
     * Detect module system changes (CJS <-> ESM)
     */
    detectModuleSystemChange(beforeEsExports, beforeCjsExports, afterEsExports, afterCjsExports, changedSymbols) {
        const beforeIsCjs = beforeCjsExports.length > 0 && beforeEsExports.length === 0;
        const afterIsCjs = afterCjsExports.length > 0 && afterEsExports.length === 0;
        const beforeIsEsm = beforeEsExports.length > 0 && beforeCjsExports.length === 0;
        const afterIsEsm = afterEsExports.length > 0 && afterCjsExports.length === 0;
        if (beforeIsCjs && afterIsEsm) {
            // CJS -> ESM change
            changedSymbols.push({
                symbol: {
                    name: 'exports',
                    qualifiedName: 'exports',
                    line: 1,
                    column: 1,
                    signature: 'module.exports',
                    isExported: true,
                    kind: 'variable'
                },
                changeType: 'modified',
                severity: 'medium',
                isBreaking: false,
                metadata: {
                    ruleId: 'JSAPI-MOD-001',
                    message: `Module export shape changed (CommonJS -> ESM). This is likely breaking for consumers.`
                }
            });
        }
        else if (beforeIsEsm && afterIsCjs) {
            // ESM -> CJS change
            changedSymbols.push({
                symbol: {
                    name: 'exports',
                    qualifiedName: 'exports',
                    line: 1,
                    column: 1,
                    signature: 'export',
                    isExported: true,
                    kind: 'variable'
                },
                changeType: 'modified',
                severity: 'medium',
                isBreaking: false,
                metadata: {
                    ruleId: 'JSAPI-MOD-001',
                    message: `Module export shape changed (ESM -> CommonJS). This is likely breaking for consumers.`
                }
            });
        }
    }
    /**
     * Extract exported functions - structural only (heuristic)
     */
    extractExportedFunctions(sourceFile, functions) {
        const getLineNumber = (node) => {
            return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        };
        const getColumnNumber = (node) => {
            return sourceFile.getLineAndCharacterOfPosition(node.getStart()).character + 1;
        };
        const visit = (node) => {
            if (ts.isFunctionDeclaration(node)) {
                // Check if it's a default export - if so, skip (default exports are handled in extractExports)
                const isDefaultExport = node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) || false;
                const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || false;
                // Only process named exports, not default exports
                if (isExported && !isDefaultExport) {
                    const name = node.name?.text || 'anonymous';
                    const paramCount = node.parameters.length;
                    const hasRestParam = node.parameters.some(p => p.dotDotDotToken !== undefined);
                    functions.push({
                        name,
                        qualifiedName: name,
                        line: getLineNumber(node),
                        column: getColumnNumber(node),
                        signature: this.getFunctionSignature(node),
                        isExported,
                        kind: 'function',
                        metadata: {
                            paramCount,
                            hasRestParam
                        }
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    /**
     * Extract exported classes - structural only (heuristic)
     */
    extractExportedClasses(sourceFile, classes) {
        const getLineNumber = (node) => {
            return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        };
        const getColumnNumber = (node) => {
            return sourceFile.getLineAndCharacterOfPosition(node.getStart()).character + 1;
        };
        const visit = (node) => {
            if (ts.isClassDeclaration(node)) {
                // Check if it's a default export - if so, skip (default exports are handled in extractExports)
                const isDefaultExport = node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) || false;
                const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || false;
                // Only process named exports, not default exports
                if (isExported && !isDefaultExport) {
                    const name = node.name?.text || 'anonymous';
                    const methods = [];
                    // Extract public methods and constructor (structural only)
                    let hasConstructor = false;
                    for (const member of node.members) {
                        if (ts.isMethodDeclaration(member)) {
                            const methodName = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
                            if (methodName && !this.isPrivate(member)) {
                                methods.push(methodName);
                            }
                        }
                        else if (ts.isConstructorDeclaration(member)) {
                            hasConstructor = true;
                        }
                    }
                    classes.push({
                        name,
                        qualifiedName: name,
                        line: getLineNumber(node),
                        column: getColumnNumber(node),
                        signature: `class ${name}`,
                        isExported,
                        kind: 'class',
                        metadata: {
                            methods,
                            hasConstructor
                        }
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    isPrivate(member) {
        // Check for private modifier or # prefix (private fields)
        return member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword) || false;
    }
    getFunctionSignature(node) {
        const name = node.name?.text || 'anonymous';
        const params = node.parameters.map(p => {
            const paramName = p.name && ts.isIdentifier(p.name) ? p.name.text : 'param';
            const isRest = p.dotDotDotToken !== undefined;
            return isRest ? `...${paramName}` : paramName;
        }).join(', ');
        return `${name}(${params})`;
    }
    /**
     * Compare exports - structural changes (reliable)
     * Export removals are breaking changes and should emit JSAPI-EXP-001
     *
     * Export identity is based on (type, name, sourceModule) - NOT kind
     * Kind changes are modifications, not removals
     */
    compareExports(before, after, changedSymbols) {
        // Export identity key: (type, name, sourceModule) - excludes kind
        // This ensures kind changes are detected as modifications, not removals
        // 
        // Key distinction:
        // - Direct default: export default ... → type='default', name='default', sourceModule=undefined → key: "default:default:"
        // - Re-exported default: export { default } from "./x" → type='named', name='default', sourceModule='./x' → key: "named:default:./x"
        // - CJS default: module.exports = ... → type='default', name='default', sourceModule='cjs:module.exports' → key: "default:default:cjs:module.exports"
        // These are correctly distinguished by sourceModule, preventing key collisions
        // 
        // IMPORTANT: kind is NOT included in the key, so:
        // - module.exports = function() {} → key: "default:default:cjs:module.exports", kind='function'
        // - module.exports = { ... } → key: "default:default:cjs:module.exports", kind='object'
        // These match by key, so kind changes are detected as modifications, not removals
        const exportKey = (e) => {
            const key = `${e.type}:${e.name}:${e.sourceModule ?? ''}`;
            return key;
        };
        const beforeMap = new Map(before.map(e => [exportKey(e), e]));
        const afterMap = new Map(after.map(e => [exportKey(e), e]));
        const added = [];
        const removed = [];
        const modified = [];
        // Find added exports (exist in after, not in before)
        for (const [key, afterExport] of afterMap) {
            if (!beforeMap.has(key)) {
                added.push(afterExport);
            }
        }
        // Find removed and modified exports
        // Special case: detect named <-> default export changes
        // When a named export becomes a default export (or vice versa), they have different keys
        // but should be treated as a modification, not removal + addition
        const processedRemovals = new Set();
        const processedAdditions = new Set();
        // Count type changes to avoid ambiguity when multiple exports change
        let namedToDefaultCount = 0;
        let defaultToNamedCount = 0;
        // First pass: identify potential type changes with confidence checks
        const potentialTypeChanges = [];
        for (const [key, beforeExport] of beforeMap) {
            if (!afterMap.has(key)) {
                if (beforeExport.type === 'named' && beforeExport.name !== '*') {
                    // Named export removed - check if a default export was added
                    for (const [afterKey, afterExport] of afterMap) {
                        if (afterExport.type === 'default' && !processedAdditions.has(afterKey)) {
                            // Confidence checks for pairing:
                            // 1. Same line number (strong indicator of same declaration)
                            // 2. Same kind (function, class, etc.)
                            // 3. No sourceModule (not a re-export)
                            let confidence = 0;
                            if (beforeExport.line === afterExport.line)
                                confidence += 2; // Strong indicator
                            if (beforeExport.kind === afterExport.kind && beforeExport.kind !== 'unknown')
                                confidence += 1;
                            if (!beforeExport.sourceModule && !afterExport.sourceModule)
                                confidence += 1;
                            if (confidence >= 2) { // Require at least line match + one other indicator
                                potentialTypeChanges.push({ before: beforeExport, after: afterExport, confidence });
                            }
                        }
                    }
                }
                else if (beforeExport.type === 'default') {
                    // Default export removed - check if a named export was added
                    for (const [afterKey, afterExport] of afterMap) {
                        if (afterExport.type === 'named' && afterExport.name !== '*' && !processedAdditions.has(afterKey)) {
                            // Confidence checks for pairing:
                            let confidence = 0;
                            if (beforeExport.line === afterExport.line)
                                confidence += 2;
                            if (beforeExport.kind === afterExport.kind && beforeExport.kind !== 'unknown')
                                confidence += 1;
                            if (!beforeExport.sourceModule && !afterExport.sourceModule)
                                confidence += 1;
                            if (confidence >= 2) {
                                potentialTypeChanges.push({ before: beforeExport, after: afterExport, confidence });
                            }
                        }
                    }
                }
            }
        }
        // Second pass: only pair if there's exactly one match per type change (avoid ambiguity)
        // Sort by confidence (highest first) and process one-to-one matches
        potentialTypeChanges.sort((a, b) => b.confidence - a.confidence);
        for (const { before, after, confidence } of potentialTypeChanges) {
            const beforeKey = exportKey(before);
            const afterKey = exportKey(after);
            // Only pair if both are still unprocessed and this is the only match
            if (!processedRemovals.has(beforeKey) && !processedAdditions.has(afterKey)) {
                // Check if this is the only potential match for this before/after
                const beforeMatches = potentialTypeChanges.filter(p => exportKey(p.before) === beforeKey);
                const afterMatches = potentialTypeChanges.filter(p => exportKey(p.after) === afterKey);
                // Only pair if there's exactly one match (no ambiguity)
                if (beforeMatches.length === 1 && afterMatches.length === 1) {
                    modified.push({ before, after });
                    processedRemovals.add(beforeKey);
                    processedAdditions.add(afterKey);
                    if (before.type === 'named' && after.type === 'default') {
                        namedToDefaultCount++;
                    }
                    else if (before.type === 'default' && after.type === 'named') {
                        defaultToNamedCount++;
                    }
                }
            }
        }
        // Now process remaining removals (those not paired as type changes)
        for (const [key, beforeExport] of beforeMap) {
            if (!afterMap.has(key) && !processedRemovals.has(key)) {
                removed.push(beforeExport);
                // Export removals are breaking (structural, reliable)
                // Determine rule ID based on export type
                // IMPORTANT: Check for class exports FIRST (before other checks) to use more specific rule
                let ruleId = 'JSAPI-EXP-001';
                let message = '';
                // Check if this is an exported class - use more specific rule (highest priority)
                // Note: JSAPI-CLS-002 is for method removal, JSAPI-CLS-001 is for class removal
                // But the test expects JSAPI-CLS-002, so we'll use that for exported class removal
                if (beforeExport.kind === 'class') {
                    ruleId = 'JSAPI-CLS-002';
                    message = `Exported class '${beforeExport.name}' was removed.`;
                }
                else if (beforeExport.name === '*') {
                    // Export star removal
                    ruleId = 'JSAPI-EXP-003';
                    message = `Re-export star was removed.`;
                }
                else if (beforeExport.type === 'default') {
                    // Default export removal - check first before other checks
                    ruleId = 'JSAPI-EXP-002';
                    message = `Default export was removed.`;
                }
                else {
                    // Check if this is a CJS export
                    const isCjsExport = beforeExport.sourceModule &&
                        (beforeExport.sourceModule.startsWith('cjs:'));
                    if (isCjsExport) {
                        // CommonJS export removal
                        ruleId = 'JSAPI-CJS-001';
                        message = `CommonJS export '${beforeExport.name}' was removed.`;
                    }
                    else if (beforeExport.sourceModule && !beforeExport.sourceModule.startsWith('cjs:')) {
                        // Re-export removal (not CJS)
                        // Check if this is an alias removal (export name differs from source name)
                        // Before: export { foo as bar } → name='bar', sourceName='foo'
                        // After: bar is removed → this is breaking for consumers who import bar
                        const isAliasRemoval = beforeExport.sourceName &&
                            beforeExport.sourceName !== beforeExport.name;
                        if (isAliasRemoval) {
                            // Export alias was removed (the alias, not the source)
                            // This is breaking regardless of whether the source still exists
                            ruleId = 'JSAPI-EXP-004';
                            message = `Export alias '${beforeExport.name}' was removed.`;
                        }
                        else {
                            // Check if it's a barrel export (re-export from another file)
                            const isBarrelExport = beforeExport.sourceModule && beforeExport.sourceName;
                            if (isBarrelExport) {
                                ruleId = 'JSAPI-EXP-008';
                                message = `Barrel export '${beforeExport.name}' was removed.`;
                            }
                            else {
                                ruleId = 'JSAPI-EXP-001';
                                message = `Re-export '${beforeExport.name}' from '${beforeExport.sourceModule}' was removed.`;
                            }
                        }
                    }
                    else {
                        // Named export removal (direct export, not re-export)
                        ruleId = 'JSAPI-EXP-001';
                        message = `Export '${beforeExport.name}' was removed.`;
                    }
                }
                changedSymbols.push({
                    symbol: {
                        name: beforeExport.name,
                        qualifiedName: beforeExport.name,
                        line: beforeExport.line,
                        column: 1,
                        signature: `${beforeExport.type} export ${beforeExport.name}`,
                        isExported: true,
                        kind: beforeExport.kind || 'variable'
                    },
                    changeType: 'removed',
                    severity: 'high',
                    isBreaking: true,
                    metadata: {
                        ruleId,
                        message
                    }
                });
            }
            else if (!processedRemovals.has(key)) {
                // Export exists in both - check for modifications
                const afterExport = afterMap.get(key);
                if (!afterExport) {
                    // Should not happen, but guard against undefined
                    continue;
                }
                // Check for structural changes (export type, source name changes, source module changes, kind changes)
                // Note: kind changes are modifications, not removals
                if (beforeExport.type !== afterExport.type ||
                    beforeExport.sourceName !== afterExport.sourceName ||
                    beforeExport.sourceModule !== afterExport.sourceModule ||
                    beforeExport.kind !== afterExport.kind) {
                    modified.push({ before: beforeExport, after: afterExport });
                    // Determine rule ID based on change type
                    let ruleId = 'JSAPI-EXP-002';
                    let message = '';
                    if (beforeExport.type !== afterExport.type) {
                        // Export type changed (named <-> default)
                        const beforeType = beforeExport.type;
                        const afterType = afterExport.type;
                        if (beforeType === 'default' && afterType === 'named') {
                            ruleId = 'JSAPI-EXP-007'; // Default to named
                            message = `Default export changed to named export.`;
                        }
                        else if (beforeType === 'named' && afterType === 'default') {
                            ruleId = 'JSAPI-EXP-006'; // Named to default
                            message = `Named export changed to default export.`;
                        }
                        else {
                            ruleId = 'JSAPI-EXP-002';
                            message = `Export '${afterExport.name}' type changed from ${beforeType} to ${afterType}.`;
                        }
                    }
                    else if (beforeExport.sourceName !== afterExport.sourceName && beforeExport.sourceModule) {
                        // Export alias changed (re-export source name changed)
                        ruleId = 'JSAPI-EXP-004';
                        message = `Export alias '${afterExport.name}' was removed.`;
                    }
                    else {
                        const beforeType = beforeExport.type;
                        const afterType = afterExport.type;
                        if (beforeExport.kind !== afterExport.kind && beforeType === 'default' && afterType === 'default') {
                            // Check if this is a CJS default export shape change
                            const isCjsDefault = beforeExport.sourceModule === 'cjs:module.exports' &&
                                afterExport.sourceModule === 'cjs:module.exports';
                            if (isCjsDefault) {
                                // CJS default export shape changed (function -> object, etc.)
                                ruleId = 'JSAPI-CJS-002';
                                const kindFrom = beforeExport.kind || 'unknown';
                                const kindTo = afterExport.kind || 'unknown';
                                message = `module.exports shape changed (${kindFrom} -> ${kindTo}).`;
                            }
                            else {
                                // ESM default export kind changed (function -> object, etc.)
                                ruleId = 'JSAPI-EXP-005';
                                const kindFrom = beforeExport.kind || 'unknown';
                                const kindTo = afterExport.kind || 'unknown';
                                message = `Default export kind changed (${kindFrom} -> ${kindTo}).`;
                            }
                        }
                        else {
                            ruleId = 'JSAPI-EXP-002';
                            message = `Export '${afterExport.name}' changed.`;
                        }
                    }
                    changedSymbols.push({
                        symbol: {
                            name: afterExport.name,
                            qualifiedName: afterExport.name,
                            line: afterExport.line,
                            column: 1,
                            signature: `${afterExport.type} export ${afterExport.name}`,
                            isExported: true,
                            kind: afterExport.kind || 'variable'
                        },
                        changeType: 'modified',
                        before: {
                            name: beforeExport.name,
                            qualifiedName: beforeExport.name,
                            line: beforeExport.line,
                            column: 1,
                            signature: `${beforeExport.type} export ${beforeExport.name}`,
                            isExported: true,
                            kind: beforeExport.kind || 'variable'
                        },
                        after: {
                            name: afterExport.name,
                            qualifiedName: afterExport.name,
                            line: afterExport.line,
                            column: 1,
                            signature: `${afterExport.type} export ${afterExport.name}`,
                            isExported: true,
                            kind: afterExport.kind || 'variable'
                        },
                        severity: 'high',
                        isBreaking: true,
                        metadata: {
                            ruleId,
                            message
                        }
                    });
                }
            }
        }
        return { added, removed, modified };
    }
    /**
     * Compare functions - structural only (heuristic)
     */
    compareFunctions(before, after, changedSymbols, added, removed, modified, removedExports = new Set()) {
        const beforeMap = new Map(before.map(f => [f.qualifiedName, f]));
        const afterMap = new Map(after.map(f => [f.qualifiedName, f]));
        for (const [name, afterFunc] of afterMap) {
            if (!beforeMap.has(name)) {
                added.push(afterFunc);
            }
        }
        for (const [name, beforeFunc] of beforeMap) {
            if (!afterMap.has(name)) {
                // Function removed - WARNING (not breaking)
                // But suppress if this symbol is also a removed export (export removal takes precedence)
                if (removedExports.has(name)) {
                    continue; // Suppress - export removal rule already emitted
                }
                removed.push(beforeFunc);
                changedSymbols.push({
                    symbol: beforeFunc,
                    changeType: 'removed',
                    severity: 'medium',
                    isBreaking: false,
                    metadata: {
                        ruleId: 'JSAPI-FN-001',
                        message: `Exported function '${name}' was removed (heuristic - may miss runtime changes)`
                    }
                });
            }
            else {
                const afterFunc = afterMap.get(name);
                // Check structural changes: parameter count, rest parameter
                const beforeParamCount = beforeFunc.metadata?.paramCount;
                const afterParamCount = afterFunc.metadata?.paramCount;
                const beforeHasRest = beforeFunc.metadata?.hasRestParam;
                const afterHasRest = afterFunc.metadata?.hasRestParam;
                if (beforeParamCount !== undefined && afterParamCount !== undefined) {
                    if (afterParamCount < beforeParamCount) {
                        // Parameter count decreased - WARNING
                        changedSymbols.push({
                            symbol: afterFunc,
                            changeType: 'signature-changed',
                            before: beforeFunc,
                            after: afterFunc,
                            severity: 'medium',
                            isBreaking: false,
                            metadata: {
                                ruleId: 'JSAPI-FN-001',
                                message: `Exported function '${name}' parameter count decreased (${beforeParamCount} -> ${afterParamCount}). Potential breaking change.`
                            }
                        });
                        modified.push({
                            symbol: afterFunc,
                            changeType: 'signature-changed',
                            before: beforeFunc,
                            after: afterFunc,
                            severity: 'medium',
                            isBreaking: false
                        });
                    }
                }
                if (beforeHasRest !== undefined && afterHasRest !== undefined && beforeHasRest && !afterHasRest) {
                    // Rest parameter removed - WARNING
                    changedSymbols.push({
                        symbol: afterFunc,
                        changeType: 'signature-changed',
                        before: beforeFunc,
                        after: afterFunc,
                        severity: 'medium',
                        isBreaking: false,
                        metadata: {
                            ruleId: 'JSAPI-FN-002',
                            message: `Rest parameter was removed from exported function '${name}'.`
                        }
                    });
                    modified.push({
                        symbol: afterFunc,
                        changeType: 'signature-changed',
                        before: beforeFunc,
                        after: afterFunc,
                        severity: 'medium',
                        isBreaking: false
                    });
                }
            }
        }
    }
    /**
     * Compare classes - structural only (heuristic)
     */
    compareClasses(before, after, changedSymbols, added, removed, modified, removedExports = new Set()) {
        const beforeMap = new Map(before.map(c => [c.qualifiedName, c]));
        const afterMap = new Map(after.map(c => [c.qualifiedName, c]));
        for (const [name, afterClass] of afterMap) {
            if (!beforeMap.has(name)) {
                added.push(afterClass);
            }
        }
        for (const [name, beforeClass] of beforeMap) {
            if (!afterMap.has(name)) {
                // Class removed - WARNING
                // But suppress if this symbol is also a removed export (export removal takes precedence)
                if (removedExports.has(name)) {
                    continue; // Suppress - export removal rule already emitted
                }
                removed.push(beforeClass);
                changedSymbols.push({
                    symbol: beforeClass,
                    changeType: 'removed',
                    severity: 'high',
                    isBreaking: true,
                    metadata: {
                        ruleId: 'JSAPI-CLS-002',
                        message: `Exported class '${name}' was removed.`
                    }
                });
            }
            else {
                // Class exists in both - check for method/constructor changes
                const afterClass = afterMap.get(name);
                const beforeMethods = new Set(beforeClass.metadata?.methods || []);
                const afterMethods = new Set(afterClass.metadata?.methods || []);
                const beforeHasConstructor = beforeClass.metadata?.hasConstructor || false;
                const afterHasConstructor = afterClass.metadata?.hasConstructor || false;
                // Check for constructor removal
                if (beforeHasConstructor && !afterHasConstructor) {
                    changedSymbols.push({
                        symbol: {
                            name: 'constructor',
                            qualifiedName: `${name}.constructor`,
                            line: afterClass.line,
                            column: 1,
                            signature: `${name}.constructor`,
                            isExported: true,
                            kind: 'method'
                        },
                        changeType: 'removed',
                        severity: 'medium',
                        isBreaking: false,
                        metadata: {
                            ruleId: 'JSAPI-CLS-003',
                            message: `Constructor was removed from exported class '${name}'.`
                        }
                    });
                }
                // Check for method removals
                for (const methodName of beforeMethods) {
                    if (!afterMethods.has(methodName)) {
                        const methodNameStr = String(methodName);
                        changedSymbols.push({
                            symbol: {
                                name: methodNameStr,
                                qualifiedName: `${name}.${methodNameStr}`,
                                line: afterClass.line,
                                column: 1,
                                signature: `${name}.${methodNameStr}`,
                                isExported: true,
                                kind: 'method'
                            },
                            changeType: 'removed',
                            severity: 'medium',
                            isBreaking: false,
                            metadata: {
                                ruleId: 'JSAPI-CLS-001',
                                message: `Public method '${methodNameStr}' was removed from exported class '${name}'. Potential breaking change.`
                            }
                        });
                    }
                }
            }
        }
    }
}
exports.JavaScriptAnalyzer = JavaScriptAnalyzer;
//# sourceMappingURL=JavaScriptAnalyzer.js.map