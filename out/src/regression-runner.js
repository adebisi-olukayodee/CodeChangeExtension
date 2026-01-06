"use strict";
/**
 * Regression runner for TypeScript API analysis.
 * This module exports runAnalyzer which analyzes a repository and returns stable JSON results.
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
exports.buildApiSnapshot = exports.computeExportsDiff = exports.runAnalyzer = exports.apiDiffToFindings = exports.computeApiDiff = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const TypeScriptAnalyzer_js_1 = require("./analyzers/language/TypeScriptAnalyzer.js");
const JavaScriptAnalyzer_js_1 = require("./analyzers/language/JavaScriptAnalyzer.js");
const ApiDiff_js_1 = require("./analyzers/language/ApiDiff.js");
Object.defineProperty(exports, "computeApiDiff", { enumerable: true, get: function () { return ApiDiff_js_1.computeApiDiff; } });
const ApiRulesEngine_js_1 = require("./analyzers/language/ApiRulesEngine.js");
Object.defineProperty(exports, "apiDiffToFindings", { enumerable: true, get: function () { return ApiRulesEngine_js_1.apiDiffToFindings; } });
const ts = __importStar(require("typescript"));
/**
 * Analyzes a repository and returns stable JSON results.
 *
 * @param options - Analysis options
 * @returns Analysis results with findings, rule IDs, symbol names, severities, and file paths
 */
async function runAnalyzer(options) {
    const { repoRoot, paths = [], tsconfig, mode = 'exports-only' } = options;
    // Normalize repo root to absolute path
    const absoluteRepoRoot = path.isAbsolute(repoRoot) ? path.normalize(repoRoot) : path.resolve(repoRoot);
    // Select analyzer based on file extension (use first file if multiple paths)
    const firstPath = paths.length > 0 ? paths[0] : '';
    const analyzer = selectAnalyzer(firstPath || 'dummy.ts', absoluteRepoRoot, tsconfig, mode);
    // If tsconfig is specified, try to load it
    // Note: TypeScriptAnalyzer uses ts-morph which handles tsconfig automatically
    // We just need to ensure the project root is set correctly
    const findings = [];
    const ruleIds = new Set();
    const symbolNames = new Set();
    const severities = new Set();
    const filePaths = new Set();
    // If no paths specified, analyze all TypeScript files in the repo
    const filesToAnalyze = paths.length > 0
        ? paths.map(p => path.isAbsolute(p) ? p : path.join(absoluteRepoRoot, p))
        : await findTypeScriptFiles(absoluteRepoRoot);
    // Build snapshots for each file
    for (const filePath of filesToAnalyze) {
        if (!fs.existsSync(filePath)) {
            console.warn(`[regression-runner] File not found: ${filePath}`);
            continue;
        }
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            if (!analyzer.buildSnapshot) {
                console.warn(`[regression-runner] Analyzer ${analyzer.getLanguage()} doesn't support buildSnapshot for ${filePath}`);
                continue;
            }
            const snapshot = await analyzer.buildSnapshot(filePath, content);
            // Convert snapshot to findings
            const fileFindings = snapshotToFindings(snapshot, absoluteRepoRoot);
            findings.push(...fileFindings);
            // Collect metadata
            for (const finding of fileFindings) {
                if (finding.ruleId) {
                    ruleIds.add(finding.ruleId);
                }
                symbolNames.add(finding.symbol);
                severities.add(finding.severity);
                filePaths.add(finding.file);
            }
        }
        catch (error) {
            console.error(`[regression-runner] Error analyzing ${filePath}:`, error);
            // Continue with other files
        }
    }
    // Return stable, sorted results (no timestamps, no random IDs)
    return {
        findings: findings.sort((a, b) => {
            // Sort by file path, then by symbol name
            if (a.file !== b.file) {
                return a.file.localeCompare(b.file);
            }
            return a.symbol.localeCompare(b.symbol);
        }),
        ruleIds: Array.from(ruleIds).sort(),
        symbolNames: Array.from(symbolNames).sort(),
        severities: Array.from(severities).sort(),
        filePaths: Array.from(filePaths).sort()
    };
}
exports.runAnalyzer = runAnalyzer;
/**
 * Computes the diff between before and after export lists.
 * This is the key signal for breaking changes in regression testing.
 */
function computeExportsDiff(before, after) {
    const beforeExports = new Map();
    const afterExports = new Map();
    // Index exports by symbol name (assuming single file for now)
    for (const finding of before.findings) {
        if (finding.isExported) {
            beforeExports.set(finding.symbol, finding);
        }
    }
    for (const finding of after.findings) {
        if (finding.isExported) {
            afterExports.set(finding.symbol, finding);
        }
    }
    const added = [];
    const removed = [];
    const changed = [];
    // Find added exports
    for (const [symbol, finding] of afterExports) {
        if (!beforeExports.has(symbol)) {
            added.push(symbol);
        }
    }
    // Find removed exports and changed kinds
    for (const [symbol, beforeFinding] of beforeExports) {
        const afterFinding = afterExports.get(symbol);
        if (!afterFinding) {
            removed.push(symbol);
        }
        else if (beforeFinding.kind !== afterFinding.kind) {
            changed.push({
                symbol,
                beforeKind: beforeFinding.kind,
                afterKind: afterFinding.kind
            });
        }
    }
    return {
        added: added.sort(),
        removed: removed.sort(),
        changed: changed.sort((a, b) => a.symbol.localeCompare(b.symbol))
    };
}
exports.computeExportsDiff = computeExportsDiff;
/**
 * Converts a SymbolSnapshot to findings.
 * Focuses on exports (the public API surface) since that's what matters for breaking changes.
 */
function snapshotToFindings(snapshot, repoRoot) {
    const findings = [];
    const seenSymbols = new Set(); // Track to avoid duplicates
    // Get relative file path
    const relativePath = path.isAbsolute(snapshot.filePath)
        ? path.relative(repoRoot, snapshot.filePath)
        : snapshot.filePath;
    // For barrel files (like src/index.ts), exports are the primary signal
    // Add findings for all exports (including re-exports)
    for (const exp of snapshot.exports) {
        // Use symbol name as key to avoid duplicates
        const key = `${relativePath}:${exp.name}`;
        if (!seenSymbols.has(key)) {
            seenSymbols.add(key);
            findings.push({
                ruleId: undefined,
                severity: 'info',
                symbol: exp.name,
                file: relativePath.replace(/\\/g, '/'),
                kind: exp.kind,
                isExported: true,
                message: exp.type === 'default' ? 'default export' :
                    exp.type === 'namespace' ? 'namespace export' :
                        exp.kind === 're-export' ? `re-export from ${exp.sourceModule}` :
                            'named export'
            });
        }
    }
    // Also include directly exported symbols (functions, classes, etc.) that aren't re-exports
    const allSymbols = [
        ...snapshot.functions,
        ...snapshot.classes,
        ...snapshot.interfaces,
        ...snapshot.typeAliases,
        ...snapshot.enums
    ];
    // Only add symbols that are exported AND not already covered by exports list
    const exportedNames = new Set(snapshot.exports.map(e => e.name));
    for (const symbol of allSymbols) {
        if (symbol.isExported && !exportedNames.has(symbol.name)) {
            const key = `${relativePath}:${symbol.name}`;
            if (!seenSymbols.has(key)) {
                seenSymbols.add(key);
                findings.push({
                    ruleId: undefined,
                    severity: 'info',
                    symbol: symbol.name,
                    file: relativePath.replace(/\\/g, '/'),
                    kind: symbol.kind,
                    isExported: true
                });
            }
        }
    }
    return findings;
}
/**
 * Checks if TypeScript type-checking is available for a specific JavaScript file.
 * Returns true only if:
 * - tsconfig.json exists
 * - allowJs: true
 * - checkJs: true (required for reliable type-checking)
 * - file is included by the tsconfig (in include patterns or not excluded)
 */
function isTypeScriptTypeCheckingAvailableForJS(filePath, repoRoot, tsconfigPath) {
    try {
        const tsconfigFile = tsconfigPath
            ? (path.isAbsolute(tsconfigPath) ? tsconfigPath : path.join(repoRoot, tsconfigPath))
            : path.join(repoRoot, 'tsconfig.json');
        if (!fs.existsSync(tsconfigFile)) {
            return false;
        }
        const configFile = ts.readConfigFile(tsconfigFile, ts.sys.readFile);
        if (configFile.error) {
            return false;
        }
        const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigFile));
        // Require both allowJs and checkJs for reliable type-checking
        const allowJs = parsed.options.allowJs ?? false;
        const checkJs = parsed.options.checkJs ?? false;
        if (!allowJs || !checkJs) {
            return false;
        }
        // Check if file is included by tsconfig
        const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
        const normalizedFilePath = path.normalize(absoluteFilePath);
        // Check include patterns
        if (parsed.raw.include && Array.isArray(parsed.raw.include)) {
            const includes = parsed.raw.include.map((pattern) => path.normalize(path.resolve(path.dirname(tsconfigFile), pattern)));
            const fileMatchesInclude = includes.some((includePattern) => {
                // Simple pattern matching (supports glob patterns like "src/**/*")
                if (includePattern.includes('**')) {
                    const base = includePattern.replace(/\*\*/g, '');
                    return normalizedFilePath.startsWith(path.normalize(base));
                }
                return normalizedFilePath.startsWith(includePattern);
            });
            if (!fileMatchesInclude && parsed.raw.include.length > 0) {
                // File doesn't match include patterns
                return false;
            }
        }
        // Check exclude patterns
        if (parsed.raw.exclude && Array.isArray(parsed.raw.exclude)) {
            const excludes = parsed.raw.exclude.map((pattern) => path.normalize(path.resolve(path.dirname(tsconfigFile), pattern)));
            const fileMatchesExclude = excludes.some((excludePattern) => {
                if (excludePattern.includes('**')) {
                    const base = excludePattern.replace(/\*\*/g, '');
                    return normalizedFilePath.startsWith(path.normalize(base));
                }
                return normalizedFilePath.startsWith(excludePattern);
            });
            if (fileMatchesExclude) {
                // File is explicitly excluded
                return false;
            }
        }
        return true;
    }
    catch (error) {
        // If we can't read/parse tsconfig, assume type-checking is not available
        return false;
    }
}
/**
 * Selects the appropriate analyzer based on file extension and type-checking availability.
 *
 * Rules:
 * - .ts/.tsx: Always TypeScriptAnalyzer
 * - .js/.jsx: JavaScriptAnalyzer by default (module-surface analysis)
 * - .js/.jsx with "Typed JS" mode: TypeScriptAnalyzer only if:
 *   - allowJs: true AND checkJs: true in tsconfig
 *   - file is included by tsconfig
 */
function selectAnalyzer(filePath, repoRoot, tsconfig, mode = 'exports-only') {
    const ext = path.extname(filePath).toLowerCase();
    const isJSFile = ext === '.js' || ext === '.jsx';
    const isTSFile = ext === '.ts' || ext === '.tsx';
    if (isTSFile) {
        // Always use TypeScriptAnalyzer for .ts/.tsx files
        return new TypeScriptAnalyzer_js_1.TypeScriptAnalyzer(repoRoot);
    }
    if (isJSFile) {
        // For JS files, use JavaScriptAnalyzer by default (module-surface analysis)
        // Only use TypeScriptAnalyzer in "Typed JS" mode when strict conditions are met
        const isTypedJS = isTypeScriptTypeCheckingAvailableForJS(filePath, repoRoot, tsconfig);
        if (mode === 'api-snapshot' && isTypedJS) {
            console.log(`[regression-runner] Using TypeScriptAnalyzer for ${filePath} (Typed JS mode: allowJs + checkJs enabled, file included)`);
            return new TypeScriptAnalyzer_js_1.TypeScriptAnalyzer(repoRoot);
        }
        else {
            console.log(`[regression-runner] Using JavaScriptAnalyzer for ${filePath} (module-surface analysis)`);
            return new JavaScriptAnalyzer_js_1.JavaScriptAnalyzer(repoRoot);
        }
    }
    // Default to TypeScriptAnalyzer for unknown extensions
    console.warn(`[regression-runner] Unknown file extension ${ext}, defaulting to TypeScriptAnalyzer`);
    return new TypeScriptAnalyzer_js_1.TypeScriptAnalyzer(repoRoot);
}
/**
 * Finds all TypeScript files in a directory recursively.
 */
async function findTypeScriptFiles(rootDir) {
    const files = [];
    const extensions = ['.ts', '.tsx'];
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.vscode'];
    function walkDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!ignoreDirs.includes(entry.name)) {
                        walkDir(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (extensions.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        }
        catch (error) {
            // Skip if can't read directory
            console.warn(`[regression-runner] Cannot read directory ${dir}:`, error);
        }
    }
    walkDir(rootDir);
    return files;
}
/**
 * Builds an API snapshot for the entrypoint file(s).
 * This is used in api-snapshot mode to analyze signature-level changes.
 */
async function buildApiSnapshot(options) {
    const { repoRoot, paths = [], tsconfig } = options;
    if (paths.length === 0) {
        console.warn('[regression-runner] No entrypoint paths specified for API snapshot');
        return null;
    }
    // Normalize repo root to absolute path
    const absoluteRepoRoot = path.isAbsolute(repoRoot) ? path.normalize(repoRoot) : path.resolve(repoRoot);
    // For now, use the first path as the entrypoint
    // TODO: Support multiple entrypoints
    const entrypointPath = paths[0];
    const absoluteEntrypointPath = path.isAbsolute(entrypointPath)
        ? path.normalize(entrypointPath)
        : path.join(absoluteRepoRoot, entrypointPath);
    if (!fs.existsSync(absoluteEntrypointPath)) {
        console.warn(`[regression-runner] Entrypoint file not found: ${absoluteEntrypointPath}`);
        return null;
    }
    // Select analyzer based on file extension and type-checking availability
    const analyzer = selectAnalyzer(entrypointPath, absoluteRepoRoot, tsconfig, 'api-snapshot');
    // JavaScriptAnalyzer: module-surface snapshot (exports only, no type shapes)
    if (analyzer instanceof JavaScriptAnalyzer_js_1.JavaScriptAnalyzer) {
        console.log(`[regression-runner] Using JavaScriptAnalyzer for module-surface analysis: ${entrypointPath}`);
        if (!analyzer.buildSnapshot) {
            console.error(`[regression-runner] JavaScriptAnalyzer doesn't support buildSnapshot`);
            return null;
        }
        try {
            const content = fs.readFileSync(absoluteEntrypointPath, 'utf8');
            const snapshot = await analyzer.buildSnapshot(absoluteEntrypointPath, content);
            // JavaScriptAnalyzer provides module-surface snapshot:
            // - Named exports, default export, re-exports (when resolvable)
            // - Module system shape (CJS vs ESM)
            // - No type shapes (that requires TypeScript type-checking)
            const exports = new Map();
            for (const exp of snapshot.exports) {
                // Create identity: exportName|type|filePath|line
                const expType = exp.type === 'default' ? 'default' :
                    exp.type === 'namespace' ? 'namespace' : 'value';
                const identity = `${exp.name}|${expType}|${absoluteEntrypointPath}|${exp.line || 0}`;
                // Create minimal shape (module-surface only, no type information)
                exports.set(identity, {
                    kind: exp.kind || 'variable',
                    name: exp.name,
                    // Note: No type information available without TypeScript type-checking
                });
            }
            return {
                entrypointPath: absoluteEntrypointPath,
                exports,
                timestamp: new Date(),
                partial: true,
                failedShapes: 0,
                failedShapeNames: [],
                moduleSystem: snapshot.moduleSystem,
                analysisMode: 'Module-surface' // Label as module-surface snapshot
            };
        }
        catch (error) {
            console.error(`[regression-runner] Error building module-surface snapshot with JavaScriptAnalyzer:`, error);
            return null;
        }
    }
    // TypeScriptAnalyzer path (for TS files or Typed JS files)
    const tsAnalyzer = analyzer;
    if (!tsAnalyzer.buildSnapshot) {
        console.error(`[regression-runner] TypeScriptAnalyzer doesn't support buildSnapshot`);
        return null;
    }
    // Check if this is a JS file being analyzed with TypeScript (Typed JS mode)
    const ext = path.extname(entrypointPath).toLowerCase();
    const isJSFile = ext === '.js' || ext === '.jsx';
    const isTypedJS = isJSFile && isTypeScriptTypeCheckingAvailableForJS(entrypointPath, absoluteRepoRoot, tsconfig);
    try {
        // Build snapshot for entrypoint
        const content = fs.readFileSync(absoluteEntrypointPath, 'utf8');
        const snapshot = await tsAnalyzer.buildSnapshot(absoluteEntrypointPath, content);
        // Resolve exports to their declaration locations
        const resolvedExports = await tsAnalyzer.resolveEntrypointExportsToDeclarations(absoluteEntrypointPath, snapshot.exports);
        // Build API snapshot from resolved exports
        const apiSnapshot = await tsAnalyzer.buildApiSnapshotFromResolvedExports(absoluteEntrypointPath, resolvedExports);
        // Label the analysis mode
        if (isTypedJS) {
            apiSnapshot.analysisMode = 'Typed JS (TS checker)';
        }
        else if (isJSFile) {
            // This shouldn't happen (should be caught by JavaScriptAnalyzer path above)
            apiSnapshot.analysisMode = 'Module-surface';
        }
        else {
            apiSnapshot.analysisMode = 'TypeScript';
        }
        return apiSnapshot;
    }
    catch (error) {
        console.error(`[regression-runner] Error building API snapshot:`, error);
        return null;
    }
}
exports.buildApiSnapshot = buildApiSnapshot;
//# sourceMappingURL=regression-runner.js.map