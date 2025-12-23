import * as fs from 'fs';
import * as path from 'path';
import { CodeAnalysisResult } from './CodeAnalyzer';

export class DependencyAnalyzer {
    async findDownstreamComponents(sourceFilePath: string, codeAnalysis: CodeAnalysisResult): Promise<string[]> {
        const downstreamComponents: string[] = [];
        
        try {
            // Find files that import the source file
            const importingFiles = await this.findImportingFiles(sourceFilePath);
            downstreamComponents.push(...importingFiles);
            
            // Find files that reference the exported functions/classes
            const referencingFiles = await this.findReferencingFiles(sourceFilePath, codeAnalysis);
            downstreamComponents.push(...referencingFiles);
            
            // Remove duplicates
            return [...new Set(downstreamComponents)];
        } catch (error) {
            console.error('Error finding downstream components:', error);
            return [];
        }
    }

    private async findImportingFiles(sourceFilePath: string): Promise<string[]> {
        const importingFiles: string[] = [];
        const sourceFileName = path.basename(sourceFilePath, path.extname(sourceFilePath));
        const sourceDir = path.dirname(sourceFilePath);
        
        try {
            await this.walkDirectory(sourceDir, (filePath) => {
                if (filePath === sourceFilePath) return; // Skip the source file itself
                
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    
                    if (this.fileImportsSource(content, sourceFilePath, sourceFileName)) {
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

    private async findReferencingFiles(sourceFilePath: string, codeAnalysis: CodeAnalysisResult): Promise<string[]> {
        const referencingFiles: string[] = [];
        const sourceDir = path.dirname(sourceFilePath);
        
        try {
            await this.walkDirectory(sourceDir, (filePath) => {
                if (filePath === sourceFilePath) return; // Skip the source file itself
                
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    
                    // Check if file references exported functions
                    for (const funcName of codeAnalysis.functions) {
                        if (content.includes(funcName) && !this.isOwnFile(filePath, funcName)) {
                            referencingFiles.push(filePath);
                            break;
                        }
                    }
                    
                    // Check if file references exported classes
                    for (const className of codeAnalysis.classes) {
                        if (content.includes(className) && !this.isOwnFile(filePath, className)) {
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

    private fileImportsSource(content: string, sourceFilePath: string, sourceFileName: string): boolean {
        const relativePath = path.relative(path.dirname(sourceFilePath), sourceFilePath);
        
        // Check for various import patterns
        const importPatterns = [
            new RegExp(`import.*['"]\\.?/?${sourceFileName}['"]`, 'i'),
            new RegExp(`import.*['"]\\.?/?${relativePath.replace(/\\/g, '/')}['"]`, 'i'),
            new RegExp(`require\\(['"]\\.?/?${sourceFileName}['"]\\)`, 'i'),
            new RegExp(`require\\(['"]\\.?/?${relativePath.replace(/\\/g, '/')}['"]\\)`, 'i'),
            new RegExp(`from\\s+['"]\\.?/?${sourceFileName}['"]`, 'i'),
            new RegExp(`from\\s+['"]\\.?/?${relativePath.replace(/\\/g, '/')}['"]`, 'i')
        ];
        
        return importPatterns.some(pattern => pattern.test(content));
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
