import * as fs from 'fs';
import * as path from 'path';
import { CodeAnalysisResult } from './CodeAnalyzer';

interface ImportInfo {
    from: string; // File that imports
    to: string;   // Resolved absolute path of imported file
    specifier: string; // Original import specifier (e.g., '../lib')
}

export class DependencyAnalyzer {
    private reverseDeps: Map<string, Set<string>> = new Map(); // target -> Set<importers>
    
    /**
     * Build reverse import graph by scanning all TypeScript files in the project
     */
    async buildReverseImportGraph(projectRoot: string): Promise<void> {
        console.log(`[DependencyAnalyzer] Building reverse import graph from: ${projectRoot}`);
        this.reverseDeps.clear();
        
        const allTsFiles: string[] = [];
        
        // Collect all .ts and .tsx files
        const collectFiles = (dir: string) => {
            try {
                const items = fs.readdirSync(dir);
                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    const stat = fs.statSync(itemPath);
                    
                    if (stat.isDirectory()) {
                        if (!this.shouldSkipDirectory(item)) {
                            collectFiles(itemPath);
                        }
                    } else if (stat.isFile() && this.isSourceFile(item)) {
                        allTsFiles.push(itemPath);
                    }
                }
            } catch (error) {
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
                        // Use path.resolve() directly (no normalize needed)
                        const normalizedResolved = path.resolve(resolved);
                        const normalizedFrom = path.resolve(imp.from);
                        if (!this.reverseDeps.has(normalizedResolved)) {
                            this.reverseDeps.set(normalizedResolved, new Set());
                        }
                        this.reverseDeps.get(normalizedResolved)!.add(normalizedFrom);
                        const fromRel = path.relative(projectRoot, normalizedFrom);
                        const toRel = path.relative(projectRoot, normalizedResolved);
                        console.log(`[DependencyAnalyzer]   ${fromRel} imports ${toRel} (from '${imp.specifier}')`);
                    } else {
                        // Log unresolved relative imports for debugging
                        if (imp.specifier.startsWith('./') || imp.specifier.startsWith('../')) {
                            console.log(`[DependencyAnalyzer]   ⚠️ Could not resolve import '${imp.specifier}' from ${path.relative(projectRoot, imp.from)}`);
                        }
                    }
                }
            } catch (error) {
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
     */
    private parseImports(content: string, filePath: string, projectRoot: string): ImportInfo[] {
        const imports: ImportInfo[] = [];
        
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
                    to: '', // Will be resolved
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
    private resolveImport(specifier: string, fromFile: string, projectRoot: string): string | null {
        // Only handle relative imports
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
            return null; // External package or absolute path
        }
        
        const fromDir = path.dirname(fromFile);
        const base = path.resolve(fromDir, specifier);
        
        // Try files with various extensions
        const tryFiles = (p: string): string[] => [
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
    async findDownstreamComponents(
        sourceFilePath: string, 
        codeAnalysis: CodeAnalysisResult,
        impactedSymbols?: string[],
        projectRoot?: string
    ): Promise<string[]> {
        // CRITICAL: This log MUST appear if this function is called
        console.error(`[DependencyAnalyzer] ========== findDownstreamComponents CALLED ==========`);
        console.error(`[DependencyAnalyzer] sourceFilePath: ${sourceFilePath}`);
        console.error(`[DependencyAnalyzer] projectRoot: ${projectRoot || 'UNDEFINED'}`);
        console.error(`[DependencyAnalyzer] impactedSymbols: ${JSON.stringify(impactedSymbols || [])}`);
        
        const downstreamComponents: string[] = [];
        
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
        const visited = new Set<string>();
        const queue = Array.from(directImporters);
        const allDownstream = new Set<string>();
        
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
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
    private async findDownstreamComponentsLegacy(
        sourceFilePath: string, 
        codeAnalysis: CodeAnalysisResult,
        impactedSymbols?: string[]
    ): Promise<string[]> {
        const downstreamComponents: string[] = [];
        const searchRoot = path.dirname(sourceFilePath);
        
        try {
            const importingFiles = await this.findImportingFiles(sourceFilePath, searchRoot);
            downstreamComponents.push(...importingFiles);
            
            const referencingFiles = await this.findReferencingFiles(sourceFilePath, codeAnalysis, impactedSymbols, searchRoot);
            downstreamComponents.push(...referencingFiles);
            
            return [...new Set(downstreamComponents)];
        } catch (error) {
            console.error('Error finding downstream components:', error);
            return [];
        }
    }

    private async findImportingFiles(sourceFilePath: string, searchRoot: string): Promise<string[]> {
        const importingFiles: string[] = [];
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
                if (filePath === sourceFilePath) return; // Skip the source file itself
                
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    
                    // Check if file imports the source file (using various import path formats)
                    if (this.fileImportsSource(content, sourceFilePath, sourceFileName, relativeSourcePath, relativeFilePath)) {
                        console.log(`[DependencyAnalyzer.findImportingFiles] ✅ Found importing file: ${filePath}`);
                        importingFiles.push(filePath);
                    }
                } catch (error) {
                    console.error(`Error reading file ${filePath}:`, error);
                }
            });
        } catch (error) {
            console.error('Error walking directory for importing files:', error);
        }
        
        return importingFiles;
    }

    private async findReferencingFiles(
        sourceFilePath: string, 
        codeAnalysis: CodeAnalysisResult,
        impactedSymbols: string[] | undefined,
        searchRoot: string
    ): Promise<string[]> {
        const referencingFiles: string[] = [];
        
        // Use impactedSymbols if provided, otherwise fall back to codeAnalysis
        const symbolsToCheck = impactedSymbols && impactedSymbols.length > 0 
            ? impactedSymbols 
            : [...codeAnalysis.functions, ...codeAnalysis.classes];
        
        try {
            await this.walkDirectory(searchRoot, (filePath) => {
                if (filePath === sourceFilePath) return; // Skip the source file itself
                
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
                } catch (error) {
                    console.error(`Error reading file ${filePath}:`, error);
                }
            });
        } catch (error) {
            console.error('Error walking directory for referencing files:', error);
        }
        
        return referencingFiles;
    }

    private async walkDirectory(dirPath: string, callback: (filePath: string) => void): Promise<void> {
        try {
            const items = fs.readdirSync(dirPath);
            
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);
                
                if (stat.isDirectory()) {
                    if (!this.shouldSkipDirectory(item)) {
                        await this.walkDirectory(itemPath, callback);
                    }
                } else if (stat.isFile() && this.isSourceFile(item)) {
                    callback(itemPath);
                }
            }
        } catch (error) {
            console.error(`Error walking directory ${dirPath}:`, error);
        }
    }

    private fileImportsSource(
        content: string, 
        sourceFilePath: string, 
        sourceFileName: string, 
        relativeSourcePath?: string,
        relativeFilePath?: string
    ): boolean {
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
        ].filter(p => p !== null) as RegExp[];
        
        const matches = importPatterns.some(pattern => {
            const match = pattern.test(content);
            if (match) {
                console.log(`[DependencyAnalyzer.fileImportsSource] ✅ Pattern matched: ${pattern.source}`);
            }
            return match;
        });
        
        return matches;
    }

    private isOwnFile(filePath: string, symbolName: string): boolean {
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
        } catch (error) {
            return false;
        }
    }

    private isSourceFile(fileName: string): boolean {
        const ext = path.extname(fileName).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cs', '.go', '.rs'].includes(ext);
    }

    private shouldSkipDirectory(dirName: string): boolean {
        const skipDirs = [
            'node_modules', '.git', '.vscode', 'dist', 'build', 
            'coverage', '.nyc_output', 'target', 'bin', 'obj',
            '.next', '.nuxt', 'vendor', '__pycache__'
        ];
        
        return skipDirs.includes(dirName) || dirName.startsWith('.');
    }
}
