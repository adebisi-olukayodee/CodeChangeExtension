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
    async findDownstreamComponents(sourceFilePath, codeAnalysis) {
        const downstreamComponents = [];
        try {
            // Find files that import the source file
            const importingFiles = await this.findImportingFiles(sourceFilePath);
            downstreamComponents.push(...importingFiles);
            // Find files that reference the exported functions/classes
            const referencingFiles = await this.findReferencingFiles(sourceFilePath, codeAnalysis);
            downstreamComponents.push(...referencingFiles);
            // Remove duplicates
            return [...new Set(downstreamComponents)];
        }
        catch (error) {
            console.error('Error finding downstream components:', error);
            return [];
        }
    }
    async findImportingFiles(sourceFilePath) {
        const importingFiles = [];
        const sourceFileName = path.basename(sourceFilePath, path.extname(sourceFilePath));
        const sourceDir = path.dirname(sourceFilePath);
        try {
            await this.walkDirectory(sourceDir, (filePath) => {
                if (filePath === sourceFilePath)
                    return; // Skip the source file itself
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    if (this.fileImportsSource(content, sourceFilePath, sourceFileName)) {
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
    async findReferencingFiles(sourceFilePath, codeAnalysis) {
        const referencingFiles = [];
        const sourceDir = path.dirname(sourceFilePath);
        try {
            await this.walkDirectory(sourceDir, (filePath) => {
                if (filePath === sourceFilePath)
                    return; // Skip the source file itself
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
    fileImportsSource(content, sourceFilePath, sourceFileName) {
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