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
exports.runAnalyzer = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const TypeScriptAnalyzer_1 = require("./analyzers/language/TypeScriptAnalyzer");
/**
 * Analyzes a repository and returns stable JSON results.
 *
 * @param options - Analysis options
 * @returns Analysis results with findings, rule IDs, symbol names, severities, and file paths
 */
async function runAnalyzer(options) {
    const { repoRoot, paths = [], tsconfig } = options;
    // Normalize repo root to absolute path
    const absoluteRepoRoot = path.isAbsolute(repoRoot) ? path.normalize(repoRoot) : path.resolve(repoRoot);
    // Initialize analyzer with project root
    const analyzer = new TypeScriptAnalyzer_1.TypeScriptAnalyzer(absoluteRepoRoot);
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
 * Converts a SymbolSnapshot to findings.
 * Since we're analyzing a single state (not comparing before/after),
 * we return all exported symbols as findings.
 */
function snapshotToFindings(snapshot, repoRoot) {
    const findings = [];
    // Get relative file path
    const relativePath = path.isAbsolute(snapshot.filePath)
        ? path.relative(repoRoot, snapshot.filePath)
        : snapshot.filePath;
    // Add findings for all exported symbols
    const allSymbols = [
        ...snapshot.functions,
        ...snapshot.classes,
        ...snapshot.interfaces,
        ...snapshot.typeAliases,
        ...snapshot.enums
    ];
    for (const symbol of allSymbols) {
        if (symbol.isExported) {
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
    // Add findings for exports (including re-exports)
    for (const exp of snapshot.exports) {
        findings.push({
            ruleId: undefined,
            severity: 'info',
            symbol: exp.name,
            file: relativePath.replace(/\\/g, '/'),
            kind: exp.kind,
            isExported: true,
            message: exp.type === 'default' ? 'default export' : exp.type === 'namespace' ? 'namespace export' : 'named export'
        });
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
//# sourceMappingURL=regression-runner.js.map