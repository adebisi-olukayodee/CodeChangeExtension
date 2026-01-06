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
class DependencyAnalyzer {
    constructor() {
        this.reverseDeps = new Map(); // target -> Set<importers>
    }
    /**
     * Get singleton instance for shared dependency index
     */
    static getInstance() {
        if (!DependencyAnalyzer.instance) {
            DependencyAnalyzer.instance = new DependencyAnalyzer();
        }
        return DependencyAnalyzer.instance;
    }
    /**
     * Reset singleton instance (for testing)
     */
    static resetInstance() {
        DependencyAnalyzer.instance = null;
    }
    /**
     * Normalize path consistently (realpath/case/slashes) for matching
     * This ensures resolvedPath === analyzedFilePath matches correctly
     */
    normalizePath(filePath) {
        try {
            // Use realpath to resolve symlinks and get canonical path
            const realPath = fs.realpathSync.native(filePath);
            // Normalize separators (always use forward slashes for consistency)
            const normalized = path.normalize(realPath).replace(/\\/g, '/');
            // On Windows, normalize case (toLowerCase) for case-insensitive matching
            // On Unix, keep case as-is
            return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        }
        catch (error) {
            // If realpath fails (file doesn't exist), fall back to basic normalization
            const normalized = path.normalize(filePath).replace(/\\/g, '/');
            return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        }
    }
    /**
     * Invalidate dependency index for a file (remove from graph)
     * Call this when a file is deleted or renamed
     */
    invalidateFile(filePath) {
        const normalized = this.normalizePath(filePath);
        // Remove as a target (file being imported)
        this.reverseDeps.delete(normalized);
        // Remove as an importer (file that imports others)
        for (const [target, importers] of this.reverseDeps.entries()) {
            importers.delete(normalized);
        }
    }
    /**
     * Rebuild dependency index for a specific file
     * Call this when a file is created, renamed, or saved
     */
    async rebuildFileIndex(filePath, projectRoot) {
        // First invalidate old entries
        this.invalidateFile(filePath);
        // Then rebuild for this file
        try {
            if (!this.isSourceFile(path.basename(filePath))) {
                return; // Not a source file, skip
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const imports = this.parseImports(content, filePath, projectRoot);
            const normalizedFrom = this.normalizePath(filePath);
            for (const imp of imports) {
                const resolved = this.resolveImport(imp.specifier, filePath, projectRoot);
                if (resolved) {
                    const normalizedResolved = this.normalizePath(resolved);
                    if (!this.reverseDeps.has(normalizedResolved)) {
                        this.reverseDeps.set(normalizedResolved, new Set());
                    }
                    this.reverseDeps.get(normalizedResolved).add(normalizedFrom);
                }
            }
        }
        catch (error) {
            console.error(`[DependencyAnalyzer] Error rebuilding index for ${filePath}:`, error);
        }
    }
    /**
     * Build reverse import graph by scanning all TypeScript files in the project
     */
    async buildReverseImportGraph(projectRoot) {
        console.log(`[DependencyAnalyzer] Building reverse import graph from: ${projectRoot}`);
        this.reverseDeps.clear();
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
        // Parse imports from each file
        for (const filePath of allTsFiles) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const imports = this.parseImports(content, filePath, projectRoot);
                for (const imp of imports) {
                    const resolved = this.resolveImport(imp.specifier, filePath, projectRoot);
                    if (resolved) {
                        // Normalize paths consistently (realpath/case/slashes) for matching
                        const normalizedResolved = this.normalizePath(resolved);
                        const normalizedFrom = this.normalizePath(imp.from);
                        if (!this.reverseDeps.has(normalizedResolved)) {
                            this.reverseDeps.set(normalizedResolved, new Set());
                        }
                        this.reverseDeps.get(normalizedResolved).add(normalizedFrom);
                        const fromRel = path.relative(projectRoot, normalizedFrom);
                        const toRel = path.relative(projectRoot, normalizedResolved);
                        console.log(`[DependencyAnalyzer]   ${fromRel} imports ${toRel} (from '${imp.specifier}')`);
                    }
                    else {
                        // Log unresolved relative imports for debugging
                        if (imp.specifier.startsWith('./') || imp.specifier.startsWith('../')) {
                            console.log(`[DependencyAnalyzer]   ⚠️ Could not resolve import '${imp.specifier}' from ${path.relative(projectRoot, imp.from)}`);
                        }
                    }
                }
            }
            catch (error) {
                console.error(`Error processing file ${filePath}:`, error);
            }
        }
        console.log(`[DependencyAnalyzer] Reverse graph built: ${this.reverseDeps.size} files have importers`);
        if (this.reverseDeps.size > 0) {
            const sampleKeys = Array.from(this.reverseDeps.keys()).slice(0, 3);
            console.log(`[DependencyAnalyzer] Sample targets: ${sampleKeys.map(k => path.relative(projectRoot, k)).join(', ')}`);
        }
    }
    /**
     * Parse import statements from file content
     * Supports: import, import type, export type, dynamic import(), require()
     */
    parseImports(content, filePath, projectRoot) {
        const imports = [];
        // Match patterns:
        // - import ... from 'module'
        // - import type ... from 'module'
        // - export type ... from 'module'
        // - export { type ... } from 'module'
        // - import('module') or require('module')
        const importPatterns = [
            /(?:import|export)\s+(?:type\s+)?.*?\s+from\s+['"]([^'"]+)['"]/g,
            /export\s+\{\s*(?:type\s+)?[^}]*\}\s+from\s+['"]([^'"]+)['"]/g,
            /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require()
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
        // Try files with various extensions (order matters: .ts/.tsx before .d.ts, .d.ts before .js)
        const tryFiles = (p) => [
            p,
            `${p}.ts`,
            `${p}.tsx`,
            `${p}.d.ts`,
            `${p}.js`,
            `${p}.jsx`,
        ];
        // 1) Check if it's a file (with or without extension)
        for (const p of tryFiles(base)) {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                return this.normalizePath(p);
            }
        }
        // 2) Check if it's a directory -> try index.* (order: .ts/.tsx before .d.ts, .d.ts before .js)
        if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
            for (const idx of ['index.ts', 'index.tsx', 'index.d.ts', 'index.js', 'index.jsx']) {
                const p = path.join(base, idx);
                if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                    return this.normalizePath(p);
                }
            }
        }
        return null;
    }
    async findDownstreamComponents(sourceFilePath, codeAnalysis, impactedSymbols, projectRoot) {
        // CRITICAL: This log MUST appear if this function is called
        console.error(`[DependencyAnalyzer] ========== findDownstreamComponents CALLED ==========`);
        console.error(`[DependencyAnalyzer] sourceFilePath: ${sourceFilePath}`);
        console.error(`[DependencyAnalyzer] projectRoot: ${projectRoot || 'UNDEFINED'}`);
        console.error(`[DependencyAnalyzer] impactedSymbols: ${JSON.stringify(impactedSymbols || [])}`);
        const downstreamComponents = [];
        if (!projectRoot) {
            console.error(`[DependencyAnalyzer] WARNING: No projectRoot provided, falling back to simple search`);
            console.warn(`[DependencyAnalyzer] No projectRoot provided, falling back to simple search`);
            return this.findDownstreamComponentsLegacy(sourceFilePath, codeAnalysis, impactedSymbols);
        }
        console.log(`[DependencyAnalyzer] Finding downstream components for: ${sourceFilePath}`);
        console.log(`[DependencyAnalyzer] Project root: ${projectRoot}`);
        console.log(`[DependencyAnalyzer] Impacted symbols: ${JSON.stringify(impactedSymbols)}`);
        // Normalize source file path for comparison
        const normalizedSource = path.resolve(sourceFilePath);
        // Build reverse import graph if not already built
        if (this.reverseDeps.size === 0) {
            await this.buildReverseImportGraph(projectRoot);
        }
        // If graph was built from /after but caller gave /before, map it
        let graphKey = normalizedSource;
        if (projectRoot && normalizedSource.includes(`${path.sep}before${path.sep}`) && projectRoot.includes(`${path.sep}after${path.sep}`)) {
            graphKey = normalizedSource.replace(`${path.sep}before${path.sep}`, `${path.sep}after${path.sep}`);
            console.log(`[DependencyAnalyzer] Mapped before path to after path for graph lookup`);
        }
        console.log(`[DependencyAnalyzer] normalizedSource=${normalizedSource}`);
        console.log(`[DependencyAnalyzer] graphKey=${graphKey}`);
        console.log(`[DependencyAnalyzer] Reverse graph size: ${this.reverseDeps.size}`);
        // Get direct importers
        const directImporters = this.reverseDeps.get(graphKey) || new Set();
        console.log(`[DependencyAnalyzer] Direct importers of ${graphKey}: ${Array.from(directImporters).length}`);
        // Get transitive closure (files that import files that import the source)
        const visited = new Set();
        const queue = Array.from(directImporters);
        const allDownstream = new Set();
        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current))
                continue;
            visited.add(current);
            allDownstream.add(current);
            // Add files that import this file
            const importers = this.reverseDeps.get(current) || new Set();
            for (const importer of importers) {
                if (!visited.has(importer)) {
                    queue.push(importer);
                }
            }
        }
        console.log(`[DependencyAnalyzer] Total downstream files (including transitive): ${allDownstream.size}`);
        return Array.from(allDownstream);
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
                    if (this.fileImportsSource(content, sourceFilePath, sourceFileName, relativeSourcePath, relativeFilePath)) {
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
    fileImportsSource(content, sourceFilePath, sourceFileName, relativeSourcePath, relativeFilePath) {
        const relativePath = relativeSourcePath || path.relative(path.dirname(sourceFilePath), sourceFilePath);
        // Check for various import patterns
        // Pattern 1: import { x } from './lib' or from '../lib' or from 'src/lib'
        // Pattern 2: import { x } from './lib/index' or from '../lib/index'
        // Pattern 3: import x from './lib'
        const importPatterns = [
            // Relative path to directory: './lib', '../lib', 'src/lib'
            new RegExp(`from\\s+['"]\\.?/?${relativeSourcePath || sourceFileName}['"]`, 'i'),
            // Relative path to file: './lib/index', '../lib/index'
            relativeFilePath ? new RegExp(`from\\s+['"]\\.?/?${relativeFilePath}['"]`, 'i') : null,
            // Just the filename: 'index'
            new RegExp(`from\\s+['"]\\.?/?${sourceFileName}['"]`, 'i'),
            // require() patterns
            new RegExp(`require\\(['"]\\.?/?${relativeSourcePath || sourceFileName}['"]\\)`, 'i'),
            relativeFilePath ? new RegExp(`require\\(['"]\\.?/?${relativeFilePath}['"]\\)`, 'i') : null,
            // import() patterns
            new RegExp(`import\\(['"]\\.?/?${relativeSourcePath || sourceFileName}['"]\\)`, 'i'),
            relativeFilePath ? new RegExp(`import\\(['"]\\.?/?${relativeFilePath}['"]\\)`, 'i') : null,
        ].filter(p => p !== null);
        const matches = importPatterns.some(pattern => {
            const match = pattern.test(content);
            if (match) {
                console.log(`[DependencyAnalyzer.fileImportsSource] ✅ Pattern matched: ${pattern.source}`);
            }
            return match;
        });
        return matches;
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
    isSourceFile(fileName) {
        const ext = path.extname(fileName).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx', '.d.ts', '.py', '.java', '.cs', '.go', '.rs'].includes(ext);
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
DependencyAnalyzer.instance = null;
//# sourceMappingURL=DependencyAnalyzer.js.map