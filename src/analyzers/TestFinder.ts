import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CodeAnalysisResult } from './CodeAnalyzer';

export class TestFinder {
    private testPatterns = [
        /\.test\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i,
        /\.spec\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i,
        /test_.*\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i,
        /.*_test\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i
    ];

    private testDirectories = [
        'test', 'tests', '__tests__', 'spec', 'specs', 
        'test-src', 'src/test', 'src/tests'
    ];

    async findAffectedTests(sourceFilePath: string, codeAnalysis: CodeAnalysisResult): Promise<string[]> {
        const testFiles: string[] = [];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        
        if (!workspaceFolder) {
            return testFiles;
        }

        const workspacePath = workspaceFolder.uri.fsPath;
        const sourceFileName = path.basename(sourceFilePath, path.extname(sourceFilePath));
        const sourceDir = path.dirname(sourceFilePath);

        // Strategy 1: Find test files in the same directory
        testFiles.push(...await this.findTestFilesInDirectory(sourceDir, sourceFileName));

        // Strategy 2: Find test files in test directories
        for (const testDir of this.testDirectories) {
            const testDirPath = path.join(workspacePath, testDir);
            if (fs.existsSync(testDirPath)) {
                testFiles.push(...await this.findTestFilesInDirectory(testDirPath, sourceFileName));
            }
        }

        // Strategy 3: Find test files that import or reference the source file
        testFiles.push(...await this.findTestsByContent(sourceFilePath, codeAnalysis, workspacePath));

        // Strategy 4: Find test files by naming convention
        testFiles.push(...await this.findTestsByNaming(sourceFileName, workspacePath));

        // Remove duplicates and filter by relevance
        const uniqueTestFiles = [...new Set(testFiles)];
        return this.filterRelevantTests(uniqueTestFiles, sourceFilePath, codeAnalysis);
    }

    private async findTestFilesInDirectory(dirPath: string, sourceFileName: string): Promise<string[]> {
        const testFiles: string[] = [];
        
        try {
            const files = fs.readdirSync(dirPath);
            
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stat = fs.statSync(filePath);
                
                if (stat.isFile() && this.isTestFile(file)) {
                    if (this.isRelatedTestFile(file, sourceFileName)) {
                        testFiles.push(filePath);
                    }
                } else if (stat.isDirectory()) {
                    testFiles.push(...await this.findTestFilesInDirectory(filePath, sourceFileName));
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
        }
        
        return testFiles;
    }

    private async findTestsByContent(sourceFilePath: string, codeAnalysis: CodeAnalysisResult, workspacePath: string): Promise<string[]> {
        const testFiles: string[] = [];
        const sourceFileName = path.basename(sourceFilePath, path.extname(sourceFilePath));
        
        try {
            await this.walkDirectory(workspacePath, (filePath) => {
                if (this.isTestFile(filePath)) {
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        
                        // Check if test file imports the source file
                        if (this.testFileImportsSource(content, sourceFilePath, sourceFileName)) {
                            testFiles.push(filePath);
                            return;
                        }
                        
                        // Check if test file references functions/classes from source
                        if (this.testFileReferencesCode(content, codeAnalysis)) {
                            testFiles.push(filePath);
                            return;
                        }
                    } catch (error) {
                        console.error(`Error reading test file ${filePath}:`, error);
                    }
                }
            });
        } catch (error) {
            console.error('Error walking directory for content-based test discovery:', error);
        }
        
        return testFiles;
    }

    private async findTestsByNaming(sourceFileName: string, workspacePath: string): Promise<string[]> {
        const testFiles: string[] = [];
        
        try {
            await this.walkDirectory(workspacePath, (filePath) => {
                if (this.isTestFile(filePath)) {
                    const testFileName = path.basename(filePath, path.extname(filePath));
                    
                    if (this.isRelatedTestFile(testFileName, sourceFileName)) {
                        testFiles.push(filePath);
                    }
                }
            });
        } catch (error) {
            console.error('Error walking directory for naming-based test discovery:', error);
        }
        
        return testFiles;
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
                } else if (stat.isFile()) {
                    callback(itemPath);
                }
            }
        } catch (error) {
            console.error(`Error walking directory ${dirPath}:`, error);
        }
    }

    private isTestFile(filePath: string): boolean {
        const fileName = path.basename(filePath);
        return this.testPatterns.some(pattern => pattern.test(fileName));
    }

    private isRelatedTestFile(testFileName: string, sourceFileName: string): boolean {
        // Remove test/spec suffixes
        const cleanTestName = testFileName
            .replace(/\.(test|spec)$/i, '')
            .replace(/^test_/, '')
            .replace(/_test$/, '');
        
        // Remove file extension
        const cleanSourceName = sourceFileName.replace(/\.[^.]+$/, '');
        
        // Check if test name contains source name or vice versa
        return cleanTestName.toLowerCase().includes(cleanSourceName.toLowerCase()) ||
               cleanSourceName.toLowerCase().includes(cleanTestName.toLowerCase()) ||
               cleanTestName === cleanSourceName;
    }

    private testFileImportsSource(testContent: string, sourceFilePath: string, sourceFileName: string): boolean {
        const sourceDir = path.dirname(sourceFilePath);
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
        
        return importPatterns.some(pattern => pattern.test(testContent));
    }

    private testFileReferencesCode(testContent: string, codeAnalysis: CodeAnalysisResult): boolean {
        // Check if test file references any functions from the source
        for (const funcName of codeAnalysis.functions) {
            if (testContent.includes(funcName)) {
                return true;
            }
        }
        
        // Check if test file references any classes from the source
        for (const className of codeAnalysis.classes) {
            if (testContent.includes(className)) {
                return true;
            }
        }
        
        return false;
    }

    private filterRelevantTests(testFiles: string[], sourceFilePath: string, codeAnalysis: CodeAnalysisResult): string[] {
        return testFiles.filter(testFile => {
            try {
                const content = fs.readFileSync(testFile, 'utf8');
                
                // Higher relevance if test file imports the source
                if (this.testFileImportsSource(content, sourceFilePath, path.basename(sourceFilePath))) {
                    return true;
                }
                
                // Higher relevance if test file references functions/classes
                if (this.testFileReferencesCode(content, codeAnalysis)) {
                    return true;
                }
                
                // Lower relevance for naming-based matches
                return this.isRelatedTestFile(path.basename(testFile), path.basename(sourceFilePath));
            } catch (error) {
                console.error(`Error filtering test file ${testFile}:`, error);
                return false;
            }
        });
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
