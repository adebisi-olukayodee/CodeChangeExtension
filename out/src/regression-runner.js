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
const ApiDiff_js_1 = require("./analyzers/language/ApiDiff.js");
Object.defineProperty(exports, "computeApiDiff", { enumerable: true, get: function () { return ApiDiff_js_1.computeApiDiff; } });
const ApiRulesEngine_js_1 = require("./analyzers/language/ApiRulesEngine.js");
Object.defineProperty(exports, "apiDiffToFindings", { enumerable: true, get: function () { return ApiRulesEngine_js_1.apiDiffToFindings; } });
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
    // Initialize analyzer with project root
    const analyzer = new TypeScriptAnalyzer_js_1.TypeScriptAnalyzer(absoluteRepoRoot);
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
    // Collect export stats from snapshots
    let aggregatedStats;
    // Build snapshots for each file
    for (const filePath of filesToAnalyze) {
        if (!fs.existsSync(filePath)) {
            console.warn(`[regression-runner] File not found: ${filePath}`);
            continue;
        }
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const snapshot = await analyzer.buildSnapshot(filePath, content);
            // Aggregate export stats
            if (snapshot.exportStats) {
                if (!aggregatedStats) {
                    aggregatedStats = {
                        directExports: 0,
                        reExportedSymbols: 0,
                        typeOnlyExports: 0,
                        exportsTotal: 0,
                        exportsRuntime: 0,
                        exportsType: 0,
                        exportsUnique: 0,
                        exportsWithDeclarations: 0,
                        reexportGroupsUnresolved: 0,
                    };
                }
                aggregatedStats.directExports += snapshot.exportStats.directExports || 0;
                aggregatedStats.reExportedSymbols += snapshot.exportStats.reExportedSymbols || 0;
                aggregatedStats.typeOnlyExports += snapshot.exportStats.typeOnlyExports || 0;
                aggregatedStats.exportsTotal += snapshot.exportStats.exportsTotal || 0;
                aggregatedStats.exportsRuntime += snapshot.exportStats.exportsRuntime || 0;
                aggregatedStats.exportsType += snapshot.exportStats.exportsType || 0;
                aggregatedStats.exportsUnique += snapshot.exportStats.exportsUnique || 0;
                aggregatedStats.exportsWithDeclarations += snapshot.exportStats.exportsWithDeclarations || 0;
                aggregatedStats.reexportGroupsUnresolved += snapshot.exportStats.reexportGroupsUnresolved || 0;
            }
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
        filePaths: Array.from(filePaths).sort(),
        exportStats: aggregatedStats,
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
    const { repoRoot, paths = [] } = options;
    if (paths.length === 0) {
        console.warn('[regression-runner] No entrypoint paths specified for API snapshot');
        return null;
    }
    // Normalize repo root to absolute path
    const absoluteRepoRoot = path.isAbsolute(repoRoot) ? path.normalize(repoRoot) : path.resolve(repoRoot);
    // Initialize analyzer
    const analyzer = new TypeScriptAnalyzer_js_1.TypeScriptAnalyzer(absoluteRepoRoot);
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
    try {
        // Build snapshot for entrypoint
        const content = fs.readFileSync(absoluteEntrypointPath, 'utf8');
        const snapshot = await analyzer.buildSnapshot(absoluteEntrypointPath, content);
        // Resolve exports to their declaration locations
        const resolvedExports = await analyzer.resolveEntrypointExportsToDeclarations(absoluteEntrypointPath, snapshot.exports);
        // Build API snapshot from resolved exports
        const apiSnapshot = await analyzer.buildApiSnapshotFromResolvedExports(absoluteEntrypointPath, resolvedExports);
        return apiSnapshot;
    }
    catch (error) {
        console.error(`[regression-runner] Error building API snapshot:`, error);
        return null;
    }
}
exports.buildApiSnapshot = buildApiSnapshot;
//# sourceMappingURL=regression-runner.js.map