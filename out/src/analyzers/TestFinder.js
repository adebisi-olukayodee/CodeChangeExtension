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
exports.TestFinder = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class TestFinder {
    constructor() {
        this.testPatterns = [
            /\.test\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i,
            /\.spec\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i,
            /test_.*\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i,
            /.*_test\.(js|jsx|ts|tsx|py|java|cs|go|rs)$/i
        ];
        this.testDirectories = [
            'test', 'tests', '__tests__', 'spec', 'specs',
            'test-src', 'src/test', 'src/tests'
        ];
    }
    async findAffectedTests(sourceFilePath, codeAnalysis) {
        const testFiles = [];
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
    async findTestFilesInDirectory(dirPath, sourceFileName) {
        const testFiles = [];
        try {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stat = fs.statSync(filePath);
                if (stat.isFile() && this.isTestFile(file)) {
                    if (this.isRelatedTestFile(file, sourceFileName)) {
                        testFiles.push(filePath);
                    }
                }
                else if (stat.isDirectory()) {
                    testFiles.push(...await this.findTestFilesInDirectory(filePath, sourceFileName));
                }
            }
        }
        catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
        }
        return testFiles;
    }
    async findTestsByContent(sourceFilePath, codeAnalysis, workspacePath) {
        const testFiles = [];
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
                    }
                    catch (error) {
                        console.error(`Error reading test file ${filePath}:`, error);
                    }
                }
            });
        }
        catch (error) {
            console.error('Error walking directory for content-based test discovery:', error);
        }
        return testFiles;
    }
    async findTestsByNaming(sourceFileName, workspacePath) {
        const testFiles = [];
        try {
            await this.walkDirectory(workspacePath, (filePath) => {
                if (this.isTestFile(filePath)) {
                    const testFileName = path.basename(filePath, path.extname(filePath));
                    if (this.isRelatedTestFile(testFileName, sourceFileName)) {
                        testFiles.push(filePath);
                    }
                }
            });
        }
        catch (error) {
            console.error('Error walking directory for naming-based test discovery:', error);
        }
        return testFiles;
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
                else if (stat.isFile()) {
                    callback(itemPath);
                }
            }
        }
        catch (error) {
            console.error(`Error walking directory ${dirPath}:`, error);
        }
    }
    isTestFile(filePath) {
        const fileName = path.basename(filePath);
        return this.testPatterns.some(pattern => pattern.test(fileName));
    }
    isRelatedTestFile(testFileName, sourceFileName) {
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
    testFileImportsSource(testContent, sourceFilePath, sourceFileName) {
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
    testFileReferencesCode(testContent, codeAnalysis) {
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
    filterRelevantTests(testFiles, sourceFilePath, codeAnalysis) {
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
            }
            catch (error) {
                console.error(`Error filtering test file ${testFile}:`, error);
                return false;
            }
        });
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
exports.TestFinder = TestFinder;
//# sourceMappingURL=TestFinder.js.map