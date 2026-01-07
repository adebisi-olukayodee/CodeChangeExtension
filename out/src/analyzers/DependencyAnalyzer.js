"use strict";
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
exports.DependencyAnalyzer = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
class DependencyAnalyzer {
    constructor() {
        this.reverseDeps = new Map(); // target -> Set<importers>
        this.exportGraph = new Map(); // modulePath -> Map<exportName, ExportInfo>
        this.tsConfigCache = new Map();
    }
    /**
     * Build reverse import graph by scanning all TypeScript files in the project
     */
    async buildReverseImportGraph(projectRoot) {
        console.log(`[DependencyAnalyzer] Building reverse import graph from: ${projectRoot}`);
        this.reverseDeps.clear();
        this.exportGraph.clear();
        const allTsFiles = [];
        // Collect all .ts and .tsx files
        const collectFiles = (dir) => {
            try {
                const items = fs.readdirSync(dir);
                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    const stat = fs.statSync(itemPath);
                    if (stat.isDirectory()) {
                        if (!this.shouldSkipDirectory(item)) {
                            collectFiles(itemPath);
                        }
                    }
                    else if (stat.isFile() && this.isSourceFile(item)) {
                        allTsFiles.push(itemPath);
                    }
                }
            }
            catch (error) {
                console.error(`Error collecting files from ${dir}:`, error);
            }
        };
        collectFiles(projectRoot);
        console.log(`[DependencyAnalyzer] Found ${allTsFiles.length} TypeScript files`);
        // Get TypeScript compiler options for module resolution
        const tsConfig = this.findTsConfig(projectRoot);
        const compilerOptions = tsConfig ? this.loadCompilerOptions(tsConfig) : this.getDefaultCompilerOptions();
        const moduleResolutionHost = this.createModuleResolutionHost();
        // Parse imports and exports from each file
        for (const filePath of allTsFiles) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                // Parse imports using TypeScript module resolution
                const imports = this.parseImportsWithTS(content, filePath, projectRoot, compilerOptions, moduleResolutionHost);
                for (const imp of imports) {
                    if (imp.resolved) {
                        // Normalize paths consistently
                        const normalizedResolved = path.resolve(imp.resolved).replace(/\\/g, '/');
                        const normalizedFrom = path.resolve(imp.from).replace(/\\/g, '/');
                        // Also store with backslashes for Windows compatibility
                        const normalizedResolvedWin = normalizedResolved.replace(/\//g, '\\');
                        const normalizedFromWin = normalizedFrom.replace(/\//g, '\\');
                        // Store both variations to handle path separator differences
                        const keys = [normalizedResolved, normalizedResolvedWin];
                        const fromKeys = [normalizedFrom, normalizedFromWin];
                        for (const key of keys) {
                            if (!this.reverseDeps.has(key)) {
                                this.reverseDeps.set(key, new Set());
                            }
                            for (const fromKey of fromKeys) {
                                this.reverseDeps.get(key).add(fromKey);
                            }
                        }
                        const fromRel = path.relative(projectRoot, normalizedFrom);
                        const toRel = path.relative(projectRoot, normalizedResolved);
                        console.log(`[DependencyAnalyzer]   ${fromRel} imports ${toRel} (from '${imp.specifier}')`);
                    }
                }
                // Parse exports and track re-exports
                const exports = this.parseExports(content, filePath, projectRoot, compilerOptions, moduleResolutionHost);
                this.trackExports(filePath, exports);
            }
            catch (error) {
                console.error(`Error processing file ${filePath}:`, error);
            }
        }
        console.log(`[DependencyAnalyzer] Reverse graph built: ${this.reverseDeps.size} files have importers`);
        console.log(`[DependencyAnalyzer] Export graph built: ${this.exportGraph.size} modules have exports tracked`);
        if (this.reverseDeps.size > 0) {
            const sampleKeys = Array.from(this.reverseDeps.keys()).slice(0, 3);
            console.log(`[DependencyAnalyzer] Sample targets: ${sampleKeys.map(k => path.relative(projectRoot, k)).join(', ')}`);
        }
    }
    /**
     * Parse import statements using TypeScript module resolution
     */
    parseImportsWithTS(content, filePath, projectRoot, compilerOptions, host) {
        const imports = [];
        // Extract import specifiers using regex (we'll resolve them with TS)
        const importPatterns = [
            /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
            /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        ];
        const specifiers = new Set();
        for (const pattern of importPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const specifier = match[1];
                // Skip external packages (but include relative and absolute paths)
                if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@')) {
                    specifiers.add(specifier);
                }
            }
        }
        // Resolve each specifier using TypeScript
        for (const specifier of specifiers) {
            try {
                const resolved = ts.resolveModuleName(specifier, filePath, compilerOptions, host);
                if (resolved.resolvedModule) {
                    imports.push({
                        from: filePath,
                        to: resolved.resolvedModule.resolvedFileName,
                        specifier: specifier,
                        resolved: resolved.resolvedModule.resolvedFileName
                    });
                }
                else {
                    // Fallback to old resolution method
                    const fallbackResolved = this.resolveImport(specifier, filePath, projectRoot);
                    if (fallbackResolved) {
                        imports.push({
                            from: filePath,
                            to: fallbackResolved,
                            specifier: specifier,
                            resolved: fallbackResolved
                        });
                    }
                }
            }
            catch (error) {
                // Fallback to old resolution method on error
                const fallbackResolved = this.resolveImport(specifier, filePath, projectRoot);
                if (fallbackResolved) {
                    imports.push({
                        from: filePath,
                        to: fallbackResolved,
                        specifier: specifier,
                        resolved: fallbackResolved
                    });
                }
            }
        }
        return imports;
    }
    /**
     * Parse export statements and track re-exports (export * from, export {x} from)
     */
    parseExports(content, filePath, projectRoot, compilerOptions, host) {
        const exports = [];
        // Parse export * from 'module'
        const namespaceReExportPattern = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = namespaceReExportPattern.exec(content)) !== null) {
            const specifier = match[1];
            try {
                const resolved = ts.resolveModuleName(specifier, filePath, compilerOptions, host);
                if (resolved.resolvedModule) {
                    exports.push({
                        from: filePath,
                        to: resolved.resolvedModule.resolvedFileName,
                        exportName: '*',
                        isReExport: true,
                        isNamespaceReExport: true
                    });
                }
            }
            catch (error) {
                // Fallback
                const fallbackResolved = this.resolveImport(specifier, filePath, projectRoot);
                if (fallbackResolved) {
                    exports.push({
                        from: filePath,
                        to: fallbackResolved,
                        exportName: '*',
                        isReExport: true,
                        isNamespaceReExport: true
                    });
                }
            }
        }
        // Parse export {x, y} from 'module' or export {x as y} from 'module'
        const namedReExportPattern = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
        while ((match = namedReExportPattern.exec(content)) !== null) {
            const exportNames = match[1].split(',').map(s => s.trim());
            const specifier = match[2];
            try {
                const resolved = ts.resolveModuleName(specifier, filePath, compilerOptions, host);
                const resolvedPath = resolved.resolvedModule?.resolvedFileName || this.resolveImport(specifier, filePath, projectRoot);
                if (resolvedPath) {
                    for (const exportName of exportNames) {
                        // Handle "x as y" syntax
                        const parts = exportName.split(/\s+as\s+/);
                        const actualName = parts[0].trim();
                        const alias = parts.length > 1 ? parts[1].trim() : actualName;
                        exports.push({
                            from: filePath,
                            to: resolvedPath,
                            exportName: alias,
                            isReExport: true,
                            isNamespaceReExport: false
                        });
                    }
                }
            }
            catch (error) {
                // Fallback
                const fallbackResolved = this.resolveImport(specifier, filePath, projectRoot);
                if (fallbackResolved) {
                    for (const exportName of exportNames) {
                        const parts = exportName.split(/\s+as\s+/);
                        const actualName = parts[0].trim();
                        const alias = parts.length > 1 ? parts[1].trim() : actualName;
                        exports.push({
                            from: filePath,
                            to: fallbackResolved,
                            exportName: alias,
                            isReExport: true,
                            isNamespaceReExport: false
                        });
                    }
                }
            }
        }
        // Parse direct exports (export const x, export function x, etc.)
        // These are not re-exports, but we track them for completeness
        const directExportPatterns = [
            /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g,
            /export\s+default\s+/g
        ];
        for (const pattern of directExportPatterns) {
            while ((match = pattern.exec(content)) !== null) {
                const exportName = match[1] || 'default';
                exports.push({
                    from: filePath,
                    to: filePath,
                    exportName: exportName,
                    isReExport: false,
                    isNamespaceReExport: false
                });
            }
        }
        return exports;
    }
    /**
     * Track exports in the export graph
     */
    trackExports(filePath, exports) {
        const normalizedPath = path.resolve(filePath).replace(/\\/g, '/');
        if (!this.exportGraph.has(normalizedPath)) {
            this.exportGraph.set(normalizedPath, new Map());
        }
        const moduleExports = this.exportGraph.get(normalizedPath);
        for (const exp of exports) {
            const normalizedTo = exp.to ? path.resolve(exp.to).replace(/\\/g, '/') : normalizedPath;
            moduleExports.set(exp.exportName, {
                ...exp,
                from: normalizedPath,
                to: normalizedTo
            });
        }
    }
    /**
     * Find tsconfig.json file
     */
    findTsConfig(projectRoot) {
        let currentDir = projectRoot;
        while (currentDir !== path.dirname(currentDir)) {
            const tsConfigPath = path.join(currentDir, 'tsconfig.json');
            if (fs.existsSync(tsConfigPath)) {
                return tsConfigPath;
            }
            currentDir = path.dirname(currentDir);
        }
        return null;
    }
    /**
     * Load compiler options from tsconfig.json
     */
    loadCompilerOptions(tsConfigPath) {
        try {
            const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
            if (configFile.error) {
                console.warn(`[DependencyAnalyzer] Error reading tsconfig: ${configFile.error.messageText}`);
                return this.getDefaultCompilerOptions();
            }
            const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsConfigPath));
            return parsed.options;
        }
        catch (error) {
            console.warn(`[DependencyAnalyzer] Error loading tsconfig: ${error}`);
            return this.getDefaultCompilerOptions();
        }
    }
    /**
     * Get default compiler options
     */
    getDefaultCompilerOptions() {
        return {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            strict: false,
            skipLibCheck: true
        };
    }
    /**
     * Create module resolution host
     */
    createModuleResolutionHost() {
        return {
            fileExists: (fileName) => fs.existsSync(fileName),
            readFile: (fileName) => {
                try {
                    return fs.readFileSync(fileName, 'utf8');
                }
                catch {
                    return undefined;
                }
            },
            getCurrentDirectory: () => process.cwd()
        };
    }
    /**
     * Parse import statements from file content (legacy method, kept for fallback)
     */
    parseImports(content, filePath, projectRoot) {
        const imports = [];
        // Match: import ... from 'module' or import ... from "module"
        // Also: import('module') or require('module')
        const importPatterns = [
            /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
            /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        ];
        for (const pattern of importPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const specifier = match[1];
                // Skip node_modules and absolute paths for now
                if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
                    continue; // Skip external packages
                }
                imports.push({
                    from: filePath,
                    to: '',
                    specifier: specifier
                });
            }
        }
        return imports;
    }
    /**
     * Resolve import specifier to absolute file path
     * Handles directory imports (e.g., '../lib' -> '../lib/index.ts')
     * Handles extensionless imports (e.g., '../src/app/consumer' -> '../src/app/consumer.ts')
     */
    resolveImport(specifier, fromFile, projectRoot) {
        // Only handle relative imports
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
            return null; // External package or absolute path
        }
        const fromDir = path.dirname(fromFile);
        const base = path.resolve(fromDir, specifier);
        // Try files with various extensions
        const tryFiles = (p) => [
            p,
            `${p}.ts`,
            `${p}.tsx`,
            `${p}.js`,
            `${p}.jsx`,
            `${p}.d.ts`,
        ];
        // 1) Check if it's a file (with or without extension)
        for (const p of tryFiles(base)) {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                return path.resolve(p);
            }
        }
        // 2) Check if it's a directory -> try index.*
        if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
            for (const idx of ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.d.ts']) {
                const p = path.join(base, idx);
                if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                    return path.resolve(p);
                }
            }
        }
        return null;
    }
    async findDownstreamComponents(sourceFilePath, codeAnalysis, impactedSymbols, projectRoot) {
        const results = await this.findDownstreamComponentsWithLines(sourceFilePath, codeAnalysis, impactedSymbols, projectRoot);
        return results.map(r => r.filePath);
    }
    async findDownstreamComponentsWithLines(sourceFilePath, codeAnalysis, impactedSymbols, projectRoot) {
        // CRITICAL: This log MUST appear if this function is called
        console.error(`[DependencyAnalyzer] ========== findDownstreamComponents CALLED ==========`);
        console.error(`[DependencyAnalyzer] sourceFilePath: ${sourceFilePath}`);
        console.error(`[DependencyAnalyzer] projectRoot: ${projectRoot || 'UNDEFINED'}`);
        console.error(`[DependencyAnalyzer] impactedSymbols: ${JSON.stringify(impactedSymbols || [])}`);
        const downstreamComponents = [];
        if (!projectRoot) {
            console.error(`[DependencyAnalyzer] WARNING: No projectRoot provided, falling back to simple search`);
            console.warn(`[DependencyAnalyzer] No projectRoot provided, falling back to simple search`);
            const legacyResults = await this.findDownstreamComponentsLegacy(sourceFilePath, codeAnalysis, impactedSymbols);
            // Convert legacy results to new format (no line numbers available)
            return legacyResults.map(filePath => ({ filePath, lines: [] }));
        }
        console.log(`[DependencyAnalyzer] Finding downstream components for: ${sourceFilePath}`);
        console.log(`[DependencyAnalyzer] Project root: ${projectRoot}`);
        console.log(`[DependencyAnalyzer] Impacted symbols: ${JSON.stringify(impactedSymbols)}`);
        // Normalize source file path for comparison - use consistent format
        const normalizedSource = path.resolve(sourceFilePath).replace(/\\/g, '/');
        // Build reverse import graph and export graph first (needed for both approaches)
        if (this.reverseDeps.size === 0 || this.exportGraph.size === 0) {
            console.log(`[DependencyAnalyzer] Building import/export graphs...`);
            await this.buildReverseImportGraph(projectRoot);
        }
        // Try direct file scanning first (more reliable than graph)
        const directScanResults = await this.findDownstreamByDirectScan(normalizedSource, projectRoot, impactedSymbols);
        if (directScanResults.length > 0) {
            console.log(`[DependencyAnalyzer] Direct scan found ${directScanResults.length} downstream files`);
            return directScanResults;
        }
        // Fallback to graph-based approach
        console.log(`[DependencyAnalyzer] Direct scan found 0 files, trying graph-based approach...`);
        // If graph was built from /after but caller gave /before, map it
        let graphKey = normalizedSource;
        if (projectRoot && normalizedSource.includes(`${path.sep}before${path.sep}`) && projectRoot.includes(`${path.sep}after${path.sep}`)) {
            graphKey = normalizedSource.replace(`${path.sep}before${path.sep}`, `${path.sep}after${path.sep}`);
            console.log(`[DependencyAnalyzer] Mapped before path to after path for graph lookup`);
        }
        console.log(`[DependencyAnalyzer] normalizedSource=${normalizedSource}`);
        console.log(`[DependencyAnalyzer] graphKey=${graphKey}`);
        console.log(`[DependencyAnalyzer] Reverse graph size: ${this.reverseDeps.size}`);
        // Try multiple path variations to find importers (handle case sensitivity, path separators, etc.)
        let directImporters = this.reverseDeps.get(graphKey) || new Set();
        // If not found, try case-insensitive and normalized path matching
        if (directImporters.size === 0) {
            const allKeys = Array.from(this.reverseDeps.keys());
            const normalizedGraphKey = graphKey.toLowerCase().replace(/\\/g, '/');
            // Try exact match first
            for (const key of allKeys) {
                const normalizedKey = key.toLowerCase().replace(/\\/g, '/');
                if (normalizedKey === normalizedGraphKey) {
                    directImporters = this.reverseDeps.get(key) || new Set();
                    console.log(`[DependencyAnalyzer] Found match with case/path normalization: ${key}`);
                    break;
                }
            }
            // If still not found, try matching by relative path
            if (directImporters.size === 0) {
                const sourceRelPath = path.relative(projectRoot, graphKey).replace(/\\/g, '/').toLowerCase();
                for (const key of allKeys) {
                    const keyRelPath = path.relative(projectRoot, key).replace(/\\/g, '/').toLowerCase();
                    if (keyRelPath === sourceRelPath) {
                        directImporters = this.reverseDeps.get(key) || new Set();
                        console.log(`[DependencyAnalyzer] Found match by relative path: ${key}`);
                        break;
                    }
                }
            }
        }
        console.log(`[DependencyAnalyzer] Direct importers of ${graphKey}: ${Array.from(directImporters).length}`);
        // Debug: Check if graph key exists in the map
        if (directImporters.size === 0) {
            console.log(`[DependencyAnalyzer] ⚠️ No direct importers found for ${graphKey}`);
            console.log(`[DependencyAnalyzer] Checking if key exists in graph...`);
            const allKeys = Array.from(this.reverseDeps.keys());
            const sourceBasename = path.basename(graphKey);
            const matchingKeys = allKeys.filter(k => {
                const kBasename = path.basename(k);
                const kRel = path.relative(projectRoot, k).replace(/\\/g, '/').toLowerCase();
                const sourceRel = path.relative(projectRoot, graphKey).replace(/\\/g, '/').toLowerCase();
                return kBasename === sourceBasename || kRel === sourceRel || k.includes(sourceBasename);
            });
            console.log(`[DependencyAnalyzer] Graph has ${allKeys.length} total keys`);
            if (matchingKeys.length > 0) {
                console.log(`[DependencyAnalyzer] Found ${matchingKeys.length} potentially matching keys:`);
                matchingKeys.slice(0, 5).forEach(k => {
                    const rel = path.relative(projectRoot, k);
                    const importers = this.reverseDeps.get(k);
                    console.log(`[DependencyAnalyzer]   - ${rel} (importers: ${importers?.size || 0})`);
                    if (importers && importers.size > 0) {
                        console.log(`[DependencyAnalyzer]     Importers: ${Array.from(importers).slice(0, 3).map(i => path.relative(projectRoot, i)).join(', ')}`);
                    }
                });
                // Use the first matching key if found
                if (matchingKeys.length > 0) {
                    const matchedKey = matchingKeys[0];
                    directImporters = this.reverseDeps.get(matchedKey) || new Set();
                    console.log(`[DependencyAnalyzer] Using matched key: ${matchedKey} (${directImporters.size} importers)`);
                }
            }
            else {
                console.log(`[DependencyAnalyzer] No matching keys found. Sample keys:`);
                allKeys.slice(0, 5).forEach(k => {
                    const rel = path.relative(projectRoot, k);
                    console.log(`[DependencyAnalyzer]   - ${rel}`);
                });
            }
        }
        // Find files that re-export the changed symbols (barrel files)
        const reExportingFiles = new Set();
        if (impactedSymbols && impactedSymbols.length > 0) {
            console.log(`[DependencyAnalyzer] Finding files that re-export changed symbols: ${JSON.stringify(impactedSymbols)}`);
            for (const [modulePath, exports] of this.exportGraph) {
                for (const symbolName of impactedSymbols) {
                    const exportInfo = exports.get(symbolName);
                    if (exportInfo && exportInfo.isReExport) {
                        // Check if this module re-exports the symbol from the source file
                        const normalizedSourceWin = normalizedSource.replace(/\//g, '\\');
                        if (exportInfo.to === normalizedSource || exportInfo.to === normalizedSourceWin) {
                            reExportingFiles.add(modulePath);
                            console.log(`[DependencyAnalyzer] Found re-export: ${path.relative(projectRoot, modulePath)} re-exports '${symbolName}' from source`);
                        }
                    }
                    // Also check namespace re-exports (export * from)
                    const namespaceExport = exports.get('*');
                    if (namespaceExport && namespaceExport.isNamespaceReExport) {
                        const normalizedSourceWin = normalizedSource.replace(/\//g, '\\');
                        if (namespaceExport.to === normalizedSource || namespaceExport.to === normalizedSourceWin) {
                            reExportingFiles.add(modulePath);
                            console.log(`[DependencyAnalyzer] Found namespace re-export: ${path.relative(projectRoot, modulePath)} re-exports * from source`);
                        }
                    }
                }
            }
            console.log(`[DependencyAnalyzer] Found ${reExportingFiles.size} files that re-export changed symbols`);
        }
        // Get transitive closure (files that import files that import the source)
        const visited = new Set();
        const queue = Array.from(directImporters);
        // Also add re-exporting files to the queue
        for (const reExportFile of reExportingFiles) {
            const normalizedReExport = path.resolve(reExportFile).replace(/\\/g, '/');
            const normalizedReExportWin = normalizedReExport.replace(/\//g, '\\');
            // Find importers of re-exporting files
            const reExportImporters = this.reverseDeps.get(normalizedReExport) || this.reverseDeps.get(normalizedReExportWin) || new Set();
            for (const importer of reExportImporters) {
                queue.push(importer);
            }
        }
        const allDownstream = new Set();
        // Add direct importers
        for (const importer of directImporters) {
            allDownstream.add(importer);
        }
        // Add re-exporting files themselves (they're impacted)
        for (const reExportFile of reExportingFiles) {
            allDownstream.add(reExportFile);
        }
        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current))
                continue;
            visited.add(current);
            allDownstream.add(current);
            // Add files that import this file
            const normalizedCurrent = path.resolve(current).replace(/\\/g, '/');
            const normalizedCurrentWin = normalizedCurrent.replace(/\//g, '\\');
            const importers = this.reverseDeps.get(normalizedCurrent) || this.reverseDeps.get(normalizedCurrentWin) || new Set();
            for (const importer of importers) {
                if (!visited.has(importer)) {
                    queue.push(importer);
                }
            }
        }
        console.log(`[DependencyAnalyzer] Total downstream files (including transitive and re-exports): ${allDownstream.size}`);
        // Filter by symbol usage if impactedSymbols is provided and collect line numbers
        const result = [];
        if (impactedSymbols && impactedSymbols.length > 0) {
            console.log(`[DependencyAnalyzer] Filtering by impacted symbols: ${JSON.stringify(impactedSymbols)}`);
            for (const filePath of allDownstream) {
                // Re-exporting files are always included (they're impacted)
                if (reExportingFiles.has(filePath)) {
                    result.push({ filePath, lines: [] });
                    continue;
                }
                const symbolUsage = this.fileUsesSymbolsWithLines(filePath, impactedSymbols, sourceFilePath);
                if (symbolUsage.uses) {
                    result.push({ filePath, lines: symbolUsage.lines });
                }
            }
            console.log(`[DependencyAnalyzer] After symbol filtering: ${result.length} files`);
            return result;
        }
        // No symbol filtering - return all downstream files with import line numbers
        for (const filePath of allDownstream) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const importLines = this.findImportLines(content, filePath, sourceFilePath);
                result.push({ filePath, lines: importLines });
            }
            catch {
                result.push({ filePath, lines: [] });
            }
        }
        return result;
    }
    /**
     * Legacy method for when projectRoot is not available
     */
    async findDownstreamComponentsLegacy(sourceFilePath, codeAnalysis, impactedSymbols) {
        const downstreamComponents = [];
        const searchRoot = path.dirname(sourceFilePath);
        try {
            const importingFiles = await this.findImportingFiles(sourceFilePath, searchRoot);
            downstreamComponents.push(...importingFiles);
            const referencingFiles = await this.findReferencingFiles(sourceFilePath, codeAnalysis, impactedSymbols, searchRoot);
            downstreamComponents.push(...referencingFiles);
            return [...new Set(downstreamComponents)];
        }
        catch (error) {
            console.error('Error finding downstream components:', error);
            return [];
        }
    }
    async findImportingFiles(sourceFilePath, searchRoot) {
        const importingFiles = [];
        const sourceFileName = path.basename(sourceFilePath, path.extname(sourceFilePath));
        const sourceDir = path.dirname(sourceFilePath);
        // Calculate relative path from searchRoot to sourceDir for import matching
        const relativeSourcePath = path.relative(searchRoot, sourceDir).replace(/\\/g, '/');
        // Also calculate relative path to the file itself (without extension)
        const relativeFilePath = path.relative(searchRoot, sourceFilePath).replace(/\\/g, '/').replace(/\.ts$/, '');
        console.log(`[DependencyAnalyzer.findImportingFiles] sourceFilePath: ${sourceFilePath}`);
        console.log(`[DependencyAnalyzer.findImportingFiles] sourceFileName: ${sourceFileName}`);
        console.log(`[DependencyAnalyzer.findImportingFiles] relativeSourcePath: ${relativeSourcePath}`);
        console.log(`[DependencyAnalyzer.findImportingFiles] relativeFilePath: ${relativeFilePath}`);
        try {
            await this.walkDirectory(searchRoot, (filePath) => {
                if (filePath === sourceFilePath)
                    return; // Skip the source file itself
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    // Check if file imports the source file (using various import path formats)
                    if (this.fileImportsSource(content, filePath, sourceFilePath, sourceFileName, relativeSourcePath, relativeFilePath)) {
                        console.log(`[DependencyAnalyzer.findImportingFiles] ✅ Found importing file: ${filePath}`);
                        importingFiles.push(filePath);
                    }
                }
                catch (error) {
                    console.error(`Error reading file ${filePath}:`, error);
                }
            });
        }
        catch (error) {
            console.error('Error walking directory for importing files:', error);
        }
        return importingFiles;
    }
    async findReferencingFiles(sourceFilePath, codeAnalysis, impactedSymbols, searchRoot) {
        const referencingFiles = [];
        // Use impactedSymbols if provided, otherwise fall back to codeAnalysis
        const symbolsToCheck = impactedSymbols && impactedSymbols.length > 0
            ? impactedSymbols
            : [...codeAnalysis.functions, ...codeAnalysis.classes];
        try {
            await this.walkDirectory(searchRoot, (filePath) => {
                if (filePath === sourceFilePath)
                    return; // Skip the source file itself
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    // Check if file references any of the impacted symbols
                    for (const symbolName of symbolsToCheck) {
                        // More precise check: look for imports or usage of the symbol
                        // Check for import statements: import { symbolName } or import symbolName
                        const importPattern = new RegExp(`import\\s+.*\\b${symbolName}\\b|import\\s+.*\\{.*\\b${symbolName}\\b.*\\}`, 'g');
                        // Check for usage: symbolName( or .symbolName or symbolName. or symbolName:
                        const usagePattern = new RegExp(`\\b${symbolName}\\s*[\\(\\:\\.]|\\b${symbolName}\\b`, 'g');
                        if ((importPattern.test(content) || usagePattern.test(content)) && !this.isOwnFile(filePath, symbolName)) {
                            referencingFiles.push(filePath);
                            break;
                        }
                    }
                }
                catch (error) {
                    console.error(`Error reading file ${filePath}:`, error);
                }
            });
        }
        catch (error) {
            console.error('Error walking directory for referencing files:', error);
        }
        return referencingFiles;
    }
    async walkDirectory(dirPath, callback) {
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                    if (!this.shouldSkipDirectory(item)) {
                        await this.walkDirectory(itemPath, callback);
                    }
                }
                else if (stat.isFile() && this.isSourceFile(item)) {
                    callback(itemPath);
                }
            }
        }
        catch (error) {
            console.error(`Error walking directory ${dirPath}:`, error);
        }
    }
    fileImportsSource(content, filePath, sourceFilePath, sourceFileName, relativeSourcePath, relativeFilePath) {
        // Calculate relative paths from the file being checked to the source file
        const fileDir = path.dirname(filePath);
        const sourceDir = path.dirname(sourceFilePath);
        const sourceBaseName = path.basename(sourceFilePath, path.extname(sourceFilePath));
        const sourceFullName = path.basename(sourceFilePath);
        // Calculate relative path from file to source
        let relativePath = path.relative(fileDir, sourceFilePath).replace(/\\/g, '/');
        // Remove extension for import matching
        const relativePathNoExt = relativePath.replace(/\.(ts|tsx|js|jsx)$/, '');
        // Also try relative to directory
        const relativeDirPath = path.relative(fileDir, sourceDir).replace(/\\/g, '/');
        // Also extract path segments for flexible matching (monorepo support)
        // e.g., if source is packages/ui/src/index.ts, match imports containing "packages/ui" or "ui/src"
        const sourcePathSegments = sourceFilePath.replace(/\\/g, '/').split('/');
        const sourcePathVariations = [];
        // Try to find meaningful path segments (skip common dirs like 'src', 'lib')
        const meaningfulSegments = sourcePathSegments.filter(seg => seg && !['src', 'lib', 'dist', 'build'].includes(seg) && !seg.endsWith('.ts') && !seg.endsWith('.tsx'));
        if (meaningfulSegments.length > 0) {
            // Add last 2-3 meaningful segments
            const lastSegments = meaningfulSegments.slice(-3);
            sourcePathVariations.push(lastSegments.join('/'));
            if (lastSegments.length > 1) {
                sourcePathVariations.push(lastSegments.slice(-2).join('/'));
            }
        }
        // Use provided parameters if available, otherwise calculate
        const checkSourceFileName = sourceFileName || sourceBaseName;
        const checkRelativeSourcePath = relativeSourcePath || relativeDirPath;
        const checkRelativeFilePath = relativeFilePath || relativePathNoExt;
        // Also check for package imports - try to find package.json near source file
        let packageName = null;
        let packagePath = null;
        try {
            let currentDir = sourceDir;
            for (let i = 0; i < 10; i++) { // Limit search depth
                const packageJsonPath = path.join(currentDir, 'package.json');
                if (fs.existsSync(packageJsonPath)) {
                    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                    if (packageJson.name) {
                        packageName = packageJson.name;
                        packagePath = path.relative(currentDir, sourceFilePath).replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx)$/, '');
                        break;
                    }
                }
                const parentDir = path.dirname(currentDir);
                if (parentDir === currentDir)
                    break;
                currentDir = parentDir;
            }
        }
        catch (error) {
            // Ignore errors
        }
        // Escape for regex
        const escape = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Check for various import patterns
        const importPatterns = [
            // Relative path to file without extension: './path/to/index', '../path/to/index'
            new RegExp(`from\\s+['"]${escape(checkRelativeFilePath)}['"]`, 'i'),
            // Relative path to file with extension: './path/to/index.ts'
            new RegExp(`from\\s+['"]${escape(relativePath)}['"]`, 'i'),
            // Relative path to directory: './path/to', '../path/to'
            new RegExp(`from\\s+['"]${escape(checkRelativeSourcePath)}['"]`, 'i'),
            // Just the filename without extension: 'index'
            new RegExp(`from\\s+['"]${escape(checkSourceFileName)}['"]`, 'i'),
            // require() patterns
            new RegExp(`require\\(['"]${escape(checkRelativeFilePath)}['"]\\)`, 'i'),
            new RegExp(`require\\(['"]${escape(relativePath)}['"]\\)`, 'i'),
            new RegExp(`require\\(['"]${escape(checkRelativeSourcePath)}['"]\\)`, 'i'),
            // import() patterns
            new RegExp(`import\\(['"]${escape(checkRelativeFilePath)}['"]\\)`, 'i'),
            new RegExp(`import\\(['"]${escape(relativePath)}['"]\\)`, 'i'),
            new RegExp(`import\\(['"]${escape(checkRelativeSourcePath)}['"]\\)`, 'i'),
        ];
        // Add package import patterns if package name found
        if (packageName) {
            const escapedPackageName = escape(packageName);
            // Package name only: 'package-name' or '@scope/package-name'
            importPatterns.push(new RegExp(`from\\s+['"]${escapedPackageName}['"]`, 'i'), new RegExp(`require\\(['"]${escapedPackageName}['"]\\)`, 'i'), new RegExp(`import\\(['"]${escapedPackageName}['"]\\)`, 'i'));
            // Package name with path: 'package-name/src' or '@scope/package-name/src'
            if (packagePath) {
                const escapedPackagePath = escape(packagePath);
                importPatterns.push(new RegExp(`from\\s+['"]${escapedPackageName}/${escapedPackagePath}['"]`, 'i'), new RegExp(`require\\(['"]${escapedPackageName}/${escapedPackagePath}['"]\\)`, 'i'), new RegExp(`import\\(['"]${escapedPackageName}/${escapedPackagePath}['"]\\)`, 'i'));
            }
        }
        // Add path segment matching for monorepo imports
        // Match imports that contain key path segments (e.g., "packages/ui" or "ui/src")
        for (const pathVar of sourcePathVariations) {
            if (pathVar && pathVar.length > 3) { // Only meaningful paths
                const escapedPathVar = escape(pathVar);
                importPatterns.push(new RegExp(`from\\s+['"][^'"]*${escapedPathVar}[^'"]*['"]`, 'i'), new RegExp(`require\\(['"][^'"]*${escapedPathVar}[^'"]*['"]\\)`, 'i'), new RegExp(`import\\(['"][^'"]*${escapedPathVar}[^'"]*['"]\\)`, 'i'));
            }
        }
        const matches = importPatterns.some(pattern => {
            const match = pattern.test(content);
            if (match) {
                console.log(`[DependencyAnalyzer.fileImportsSource] ✅ Pattern matched: ${pattern.source}`);
                console.log(`[DependencyAnalyzer.fileImportsSource]   File: ${path.basename(filePath)}, Source: ${path.basename(sourceFilePath)}`);
                console.log(`[DependencyAnalyzer.fileImportsSource]   Relative path: ${checkRelativeFilePath}`);
                if (packageName) {
                    console.log(`[DependencyAnalyzer.fileImportsSource]   Package name: ${packageName}`);
                }
            }
            return match;
        });
        return matches;
    }
    /**
     * Check if a file uses any of the specified symbols from the source file
     */
    fileUsesSymbols(filePath, symbolNames, sourceFilePath) {
        const result = this.fileUsesSymbolsWithLines(filePath, symbolNames, sourceFilePath);
        return result.lines.length > 0;
    }
    /**
     * Check if file uses symbols and return line numbers where they're used
     * @returns Object with boolean indicating usage and array of line numbers (1-based)
     */
    fileUsesSymbolsWithLines(filePath, symbolNames, sourceFilePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            const usageLines = new Set();
            // First, check if the file imports from the source file
            if (!this.fileImportsSource(content, filePath, sourceFilePath)) {
                return { uses: false, lines: [] };
            }
            // Then check if any of the symbols are used in the file
            for (const symbolName of symbolNames) {
                // Check for named imports: import { symbolName } from ...
                const namedImportPattern = new RegExp(`import\\s+\\{[^}]*\\b${this.escapeRegex(symbolName)}\\b[^}]*\\}\\s+from`, 'g');
                let match;
                while ((match = namedImportPattern.exec(content)) !== null) {
                    const lineNum = content.substring(0, match.index).split('\n').length;
                    usageLines.add(lineNum);
                    console.log(`[DependencyAnalyzer] File ${path.basename(filePath)} imports symbol '${symbolName}' at line ${lineNum}`);
                }
                // Check for default import: import symbolName from ...
                const defaultImportPattern = new RegExp(`import\\s+${this.escapeRegex(symbolName)}\\s+from`, 'g');
                while ((match = defaultImportPattern.exec(content)) !== null) {
                    const lineNum = content.substring(0, match.index).split('\n').length;
                    usageLines.add(lineNum);
                    console.log(`[DependencyAnalyzer] File ${path.basename(filePath)} imports '${symbolName}' as default at line ${lineNum}`);
                }
                // Check for namespace import: import * as symbolName from ...
                const namespaceImportPattern = new RegExp(`import\\s+\\*\\s+as\\s+${this.escapeRegex(symbolName)}\\s+from`, 'g');
                while ((match = namespaceImportPattern.exec(content)) !== null) {
                    const lineNum = content.substring(0, match.index).split('\n').length;
                    usageLines.add(lineNum);
                    console.log(`[DependencyAnalyzer] File ${path.basename(filePath)} imports '${symbolName}' as namespace at line ${lineNum}`);
                }
                // Check for usage: symbolName( or symbolName. or symbolName[
                // This is the most important - actual usage of the symbol
                const usagePattern = new RegExp(`\\b${this.escapeRegex(symbolName)}\\s*[\\(\.\\[]`, 'g');
                while ((match = usagePattern.exec(content)) !== null) {
                    const lineNum = content.substring(0, match.index).split('\n').length;
                    usageLines.add(lineNum);
                    console.log(`[DependencyAnalyzer] File ${path.basename(filePath)} uses symbol '${symbolName}' at line ${lineNum}`);
                }
            }
            return { uses: usageLines.size > 0, lines: Array.from(usageLines).sort((a, b) => a - b) };
        }
        catch (error) {
            console.error(`[DependencyAnalyzer] Error checking symbol usage in ${filePath}:`, error);
            // If we can't read the file, assume it might use the symbols (conservative approach)
            return { uses: true, lines: [] };
        }
    }
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    isOwnFile(filePath, symbolName) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            // Check if the symbol is defined in this file
            const definitionPatterns = [
                new RegExp(`function\\s+${symbolName}\\s*\\(`, 'i'),
                new RegExp(`class\\s+${symbolName}\\s*[\\{:]`, 'i'),
                new RegExp(`const\\s+${symbolName}\\s*=`, 'i'),
                new RegExp(`let\\s+${symbolName}\\s*=`, 'i'),
                new RegExp(`var\\s+${symbolName}\\s*=`, 'i'),
                new RegExp(`def\\s+${symbolName}\\s*\\(`, 'i'),
                new RegExp(`public\\s+.*\\s+${symbolName}\\s*\\(`, 'i'),
                new RegExp(`private\\s+.*\\s+${symbolName}\\s*\\(`, 'i')
            ];
            return definitionPatterns.some(pattern => pattern.test(content));
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Find line numbers where a file imports from the source file
     */
    findImportLines(content, filePath, sourceFilePath) {
        const lines = [];
        const fileDir = path.dirname(filePath);
        const relativePath = path.relative(fileDir, sourceFilePath).replace(/\\/g, '/');
        // Try to match various import patterns
        const importPatterns = [
            new RegExp(`from\\s+['"]${this.escapeRegex(relativePath)}['"]`, 'g'),
            new RegExp(`from\\s+['"]\\./${this.escapeRegex(relativePath)}['"]`, 'g'),
            new RegExp(`from\\s+['"]@[^'"]*['"]`, 'g'), // Package imports
        ];
        for (const pattern of importPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                if (!lines.includes(lineNum)) {
                    lines.push(lineNum);
                }
            }
        }
        return lines.sort((a, b) => a - b);
    }
    /**
     * Direct scan approach: scan all files in project and check if they import the source file
     * This is more reliable than the graph-based approach for finding downstream files
     */
    async findDownstreamByDirectScan(sourceFilePath, projectRoot, impactedSymbols) {
        console.log(`[DependencyAnalyzer] Starting direct scan for: ${sourceFilePath}`);
        const downstreamFiles = [];
        const normalizedSource = path.resolve(sourceFilePath).replace(/\\/g, '/');
        const normalizedSourceWin = normalizedSource.replace(/\//g, '\\');
        const sourceRelPath = path.relative(projectRoot, sourceFilePath).replace(/\\/g, '/');
        // Find files that re-export the changed symbols (if export graph is available)
        const reExportingFiles = new Set();
        if (impactedSymbols && impactedSymbols.length > 0 && this.exportGraph.size > 0) {
            console.log(`[DependencyAnalyzer] Checking export graph for re-exports of: ${JSON.stringify(impactedSymbols)}`);
            for (const [modulePath, exports] of this.exportGraph) {
                for (const symbolName of impactedSymbols) {
                    const exportInfo = exports.get(symbolName);
                    if (exportInfo && exportInfo.isReExport) {
                        if (exportInfo.to === normalizedSource || exportInfo.to === normalizedSourceWin) {
                            reExportingFiles.add(modulePath);
                            console.log(`[DependencyAnalyzer] Found re-export: ${path.relative(projectRoot, modulePath)} re-exports '${symbolName}'`);
                        }
                    }
                    // Check namespace re-exports (export * from)
                    const namespaceExport = exports.get('*');
                    if (namespaceExport && namespaceExport.isNamespaceReExport) {
                        if (namespaceExport.to === normalizedSource || namespaceExport.to === normalizedSourceWin) {
                            reExportingFiles.add(modulePath);
                            console.log(`[DependencyAnalyzer] Found namespace re-export: ${path.relative(projectRoot, modulePath)}`);
                        }
                    }
                }
            }
        }
        // Collect all source files
        const allFiles = [];
        const collectFiles = (dir) => {
            try {
                const items = fs.readdirSync(dir);
                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    const stat = fs.statSync(itemPath);
                    if (stat.isDirectory()) {
                        if (!this.shouldSkipDirectory(item)) {
                            collectFiles(itemPath);
                        }
                    }
                    else if (stat.isFile() && this.isSourceFile(item)) {
                        // Skip the source file itself
                        if (path.resolve(itemPath) !== path.resolve(sourceFilePath)) {
                            allFiles.push(itemPath);
                        }
                    }
                }
            }
            catch (error) {
                // Skip directories we can't read
            }
        };
        collectFiles(projectRoot);
        console.log(`[DependencyAnalyzer] Scanning ${allFiles.length} files for imports of ${sourceRelPath}`);
        console.log(`[DependencyAnalyzer] Source file: ${sourceFilePath}`);
        console.log(`[DependencyAnalyzer] Source relative path: ${sourceRelPath}`);
        // Add re-exporting files to downstream (they're definitely impacted)
        for (const reExportFile of reExportingFiles) {
            downstreamFiles.push({ filePath: reExportFile, lines: [] });
            console.log(`[DependencyAnalyzer] ✅ Found re-exporting file: ${path.relative(projectRoot, reExportFile)}`);
        }
        // Check each file
        for (const filePath of allFiles) {
            // Skip if already added as re-export
            if (reExportingFiles.has(filePath)) {
                continue;
            }
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                // Check if file imports from source file or from a re-exporting file
                let isDownstream = this.fileImportsSource(content, filePath, sourceFilePath);
                // Also check if it imports from re-exporting files
                if (!isDownstream) {
                    for (const reExportFile of reExportingFiles) {
                        if (this.fileImportsSource(content, filePath, reExportFile)) {
                            isDownstream = true;
                            break;
                        }
                    }
                }
                if (isDownstream) {
                    // If symbol filtering is enabled, check if the file uses the symbols
                    if (impactedSymbols && impactedSymbols.length > 0) {
                        const symbolUsage = this.fileUsesSymbolsWithLines(filePath, impactedSymbols, sourceFilePath);
                        if (symbolUsage.uses) {
                            downstreamFiles.push({ filePath, lines: symbolUsage.lines });
                            console.log(`[DependencyAnalyzer] ✅ Found downstream file: ${path.relative(projectRoot, filePath)} (lines: ${symbolUsage.lines.join(', ')})`);
                        }
                        else {
                            console.log(`[DependencyAnalyzer] ⚠️ File imports source but doesn't use symbols: ${path.relative(projectRoot, filePath)}`);
                        }
                    }
                    else {
                        // No symbol filtering - include all files that import the source
                        // Still try to find line numbers for the import statement
                        const importLines = this.findImportLines(content, filePath, sourceFilePath);
                        downstreamFiles.push({ filePath, lines: importLines });
                        console.log(`[DependencyAnalyzer] ✅ Found downstream file (no symbol filter): ${path.relative(projectRoot, filePath)} (lines: ${importLines.join(', ')})`);
                    }
                }
                else {
                    // Debug: log why file wasn't considered downstream
                    console.log(`[DependencyAnalyzer] File does not import source: ${path.relative(projectRoot, filePath)}`);
                }
            }
            catch (error) {
                // Skip files we can't read
            }
        }
        console.log(`[DependencyAnalyzer] Direct scan found ${downstreamFiles.length} downstream files`);
        return downstreamFiles;
    }
    isSourceFile(fileName) {
        const ext = path.extname(fileName).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cs', '.go', '.rs'].includes(ext);
    }
    shouldSkipDirectory(dirName) {
        const skipDirs = [
            'node_modules', '.git', '.vscode', 'dist', 'build',
            'coverage', '.nyc_output', 'target', 'bin', 'obj',
            '.next', '.nuxt', 'vendor', '__pycache__'
        ];
        return skipDirs.includes(dirName) || dirName.startsWith('.');
    }
}
exports.DependencyAnalyzer = DependencyAnalyzer;
//# sourceMappingURL=DependencyAnalyzer.js.map