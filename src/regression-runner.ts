/**
 * Regression runner for TypeScript API analysis.
 * This module exports runAnalyzer which analyzes a repository and returns stable JSON results.
 */

import * as path from 'path';
import * as fs from 'fs';
import { TypeScriptAnalyzer } from './analyzers/language/TypeScriptAnalyzer.js';
import { SymbolSnapshot } from './analyzers/language/SymbolSnapshot.js';
import { ApiSnapshot, ApiDiff } from './analyzers/language/ApiSnapshotTypes.js';
import { computeApiDiff } from './analyzers/language/ApiDiff.js';
import { apiDiffToFindings } from './analyzers/language/ApiRulesEngine.js';

// Re-export for use in regression scripts
export { computeApiDiff, apiDiffToFindings };

export interface RunAnalyzerOptions {
    repoRoot: string;
    paths?: string[];
    tsconfig?: string | null;
    mode?: 'exports-only' | 'api-snapshot';
}

export interface Finding {
    ruleId?: string;
    severity: 'breaking' | 'warning' | 'info' | 'low' | 'medium' | 'high';
    symbol: string;
    file: string;
    message?: string;
    kind?: string;
    isExported?: boolean;
}

export interface RunAnalyzerResult {
    findings: Finding[];
    ruleIds: string[];
    symbolNames: string[];
    severities: string[];
    filePaths: string[];
    exportStats?: {
        directExports: number;
        reExportedSymbols: number;
        typeOnlyExports: number;
        exportsTotal: number;
        exportsRuntime: number;
        exportsType: number;
        exportsUnique: number;
        exportsWithDeclarations: number;
        reexportGroupsUnresolved: number;
    };
}

export interface ExportsDiff {
    added: string[];
    removed: string[];
    changed: Array<{
        symbol: string;
        beforeKind?: string;
        afterKind?: string;
    }>;
}

export interface RegressionResult {
    beforeSha: string;
    afterSha: string;
    before: RunAnalyzerResult;
    after: RunAnalyzerResult;
    exportsDiff?: ExportsDiff;
    apiDiff?: ApiDiff;
    apiSnapshotBefore?: ApiSnapshot;
    apiSnapshotAfter?: ApiSnapshot;
    apiFindings?: Finding[]; // Breaking change findings from API diff
}

/**
 * Analyzes a repository and returns stable JSON results.
 * 
 * @param options - Analysis options
 * @returns Analysis results with findings, rule IDs, symbol names, severities, and file paths
 */
export async function runAnalyzer(options: RunAnalyzerOptions): Promise<RunAnalyzerResult> {
    const { repoRoot, paths = [], tsconfig, mode = 'exports-only' } = options;
    
    // Normalize repo root to absolute path
    const absoluteRepoRoot = path.isAbsolute(repoRoot) ? path.normalize(repoRoot) : path.resolve(repoRoot);
    
    // Initialize analyzer with project root
    const analyzer = new TypeScriptAnalyzer(absoluteRepoRoot);
    
    // If tsconfig is specified, try to load it
    // Note: TypeScriptAnalyzer uses ts-morph which handles tsconfig automatically
    // We just need to ensure the project root is set correctly
    
    const findings: Finding[] = [];
    const ruleIds = new Set<string>();
    const symbolNames = new Set<string>();
    const severities = new Set<string>();
    const filePaths = new Set<string>();
    
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
        } catch (error) {
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

/**
 * Computes the diff between before and after export lists.
 * This is the key signal for breaking changes in regression testing.
 */
export function computeExportsDiff(before: RunAnalyzerResult, after: RunAnalyzerResult): ExportsDiff {
    const beforeExports = new Map<string, Finding>();
    const afterExports = new Map<string, Finding>();
    
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
    
    const added: string[] = [];
    const removed: string[] = [];
    const changed: Array<{ symbol: string; beforeKind?: string; afterKind?: string }> = [];
    
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
        } else if (beforeFinding.kind !== afterFinding.kind) {
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

/**
 * Converts a SymbolSnapshot to findings.
 * Focuses on exports (the public API surface) since that's what matters for breaking changes.
 */
function snapshotToFindings(snapshot: SymbolSnapshot, repoRoot: string): Finding[] {
    const findings: Finding[] = [];
    const seenSymbols = new Set<string>(); // Track to avoid duplicates
    
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
                ruleId: undefined, // Will be assigned during diff comparison
                severity: 'info', // Will be updated based on breaking change detection
                symbol: exp.name,
                file: relativePath.replace(/\\/g, '/'), // Normalize to forward slashes
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
async function findTypeScriptFiles(rootDir: string): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx'];
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.vscode'];
    
    function walkDir(dir: string): void {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    if (!ignoreDirs.includes(entry.name)) {
                        walkDir(fullPath);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (extensions.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (error) {
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
export async function buildApiSnapshot(
    options: RunAnalyzerOptions
): Promise<ApiSnapshot | null> {
    const { repoRoot, paths = [] } = options;
    
    if (paths.length === 0) {
        console.warn('[regression-runner] No entrypoint paths specified for API snapshot');
        return null;
    }
    
    // Normalize repo root to absolute path
    const absoluteRepoRoot = path.isAbsolute(repoRoot) ? path.normalize(repoRoot) : path.resolve(repoRoot);
    
    // Initialize analyzer
    const analyzer = new TypeScriptAnalyzer(absoluteRepoRoot);
    
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
        const resolvedExports = await analyzer.resolveEntrypointExportsToDeclarations(
            absoluteEntrypointPath,
            snapshot.exports
        );
        
        // Build API snapshot from resolved exports
        const apiSnapshot = await analyzer.buildApiSnapshotFromResolvedExports(
            absoluteEntrypointPath,
            resolvedExports
        );
        
        return apiSnapshot;
    } catch (error) {
        console.error(`[regression-runner] Error building API snapshot:`, error);
        return null;
    }
}

