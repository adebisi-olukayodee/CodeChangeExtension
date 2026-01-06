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
exports.CodeAnalyzer = void 0;
const path = __importStar(require("path"));
class CodeAnalyzer {
    async analyzeFile(filePath, content) {
        const analysis = {
            functions: [],
            classes: [],
            modules: [],
            imports: [],
            exports: [],
            complexity: 0,
            linesOfCode: content.split('\n').length
        };
        try {
            const ext = path.extname(filePath).toLowerCase();
            switch (ext) {
                case '.js':
                case '.jsx':
                case '.ts':
                case '.tsx':
                    return this.analyzeJavaScriptTypeScript(content, analysis);
                case '.py':
                    return this.analyzePython(content, analysis);
                case '.java':
                    return this.analyzeJava(content, analysis);
                case '.cs':
                    return this.analyzeCSharp(content, analysis);
                case '.go':
                    return this.analyzeGo(content, analysis);
                case '.rs':
                    return this.analyzeRust(content, analysis);
                default:
                    return this.analyzeGeneric(content, analysis);
            }
        }
        catch (error) {
            console.error('Error in code analysis:', error);
            return analysis;
        }
    }
    analyzeJavaScriptTypeScript(content, analysis) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Function detection
            if (this.isFunctionDeclaration(line)) {
                const funcName = this.extractFunctionName(line);
                if (funcName) {
                    analysis.functions.push(funcName);
                }
            }
            // Class detection
            if (this.isClassDeclaration(line)) {
                const className = this.extractClassName(line);
                if (className) {
                    analysis.classes.push(className);
                }
            }
            // Import detection
            if (this.isImportStatement(line)) {
                analysis.imports.push(line);
            }
            // Export detection
            if (this.isExportStatement(line)) {
                analysis.exports.push(line);
            }
        }
        analysis.complexity = this.calculateComplexity(content);
        return analysis;
    }
    analyzePython(content, analysis) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Function detection
            if (line.startsWith('def ')) {
                const funcName = line.split('def ')[1]?.split('(')[0]?.trim();
                if (funcName) {
                    analysis.functions.push(funcName);
                }
            }
            // Class detection
            if (line.startsWith('class ')) {
                const className = line.split('class ')[1]?.split('(')[0]?.split(':')[0]?.trim();
                if (className) {
                    analysis.classes.push(className);
                }
            }
            // Import detection
            if (line.startsWith('import ') || line.startsWith('from ')) {
                analysis.imports.push(line);
            }
        }
        analysis.complexity = this.calculateComplexity(content);
        return analysis;
    }
    analyzeJava(content, analysis) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Method detection
            if (this.isJavaMethod(line)) {
                const methodName = this.extractJavaMethodName(line);
                if (methodName) {
                    analysis.functions.push(methodName);
                }
            }
            // Class detection
            if (line.includes('class ') && !line.startsWith('//')) {
                const className = line.split('class ')[1]?.split(' ')[0]?.split('{')[0]?.trim();
                if (className) {
                    analysis.classes.push(className);
                }
            }
            // Import detection
            if (line.startsWith('import ')) {
                analysis.imports.push(line);
            }
        }
        analysis.complexity = this.calculateComplexity(content);
        return analysis;
    }
    analyzeCSharp(content, analysis) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Method detection
            if (this.isCSharpMethod(line)) {
                const methodName = this.extractCSharpMethodName(line);
                if (methodName) {
                    analysis.functions.push(methodName);
                }
            }
            // Class detection
            if (line.includes('class ') && !line.startsWith('//')) {
                const className = line.split('class ')[1]?.split(' ')[0]?.split(':')[0]?.split('{')[0]?.trim();
                if (className) {
                    analysis.classes.push(className);
                }
            }
            // Using detection
            if (line.startsWith('using ')) {
                analysis.imports.push(line);
            }
        }
        analysis.complexity = this.calculateComplexity(content);
        return analysis;
    }
    analyzeGo(content, analysis) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Function detection
            if (line.startsWith('func ')) {
                const funcName = line.split('func ')[1]?.split('(')[0]?.trim();
                if (funcName) {
                    analysis.functions.push(funcName);
                }
            }
            // Import detection
            if (line.startsWith('import ')) {
                analysis.imports.push(line);
            }
        }
        analysis.complexity = this.calculateComplexity(content);
        return analysis;
    }
    analyzeRust(content, analysis) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Function detection
            if (line.startsWith('fn ')) {
                const funcName = line.split('fn ')[1]?.split('(')[0]?.trim();
                if (funcName) {
                    analysis.functions.push(funcName);
                }
            }
            // Struct detection
            if (line.startsWith('struct ')) {
                const structName = line.split('struct ')[1]?.split(' ')[0]?.split('{')[0]?.trim();
                if (structName) {
                    analysis.classes.push(structName);
                }
            }
            // Use detection
            if (line.startsWith('use ')) {
                analysis.imports.push(line);
            }
        }
        analysis.complexity = this.calculateComplexity(content);
        return analysis;
    }
    analyzeGeneric(content, analysis) {
        // Generic analysis for unknown file types
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Look for common patterns
            if (line.includes('function ') || line.includes('def ') || line.includes('func ')) {
                analysis.functions.push(`function_${i}`);
            }
            if (line.includes('class ') || line.includes('struct ')) {
                analysis.classes.push(`class_${i}`);
            }
        }
        analysis.complexity = this.calculateComplexity(content);
        return analysis;
    }
    isFunctionDeclaration(line) {
        return /^(export\s+)?(async\s+)?function\s+\w+/.test(line) ||
            /^(export\s+)?(async\s+)?\w+\s*=\s*(async\s+)?\(/.test(line) ||
            /^(export\s+)?(async\s+)?\w+\s*:\s*(async\s+)?\(/.test(line);
    }
    isClassDeclaration(line) {
        return /^(export\s+)?class\s+\w+/.test(line);
    }
    isImportStatement(line) {
        return line.startsWith('import ') || line.startsWith('require(');
    }
    isExportStatement(line) {
        return line.startsWith('export ') || line.includes('module.exports');
    }
    isJavaMethod(line) {
        return /^\s*(public|private|protected)?\s*(static\s+)?\s*\w+\s+\w+\s*\(/.test(line);
    }
    isCSharpMethod(line) {
        return /^\s*(public|private|protected|internal)?\s*(static\s+)?\s*\w+\s+\w+\s*\(/.test(line);
    }
    extractFunctionName(line) {
        const match = line.match(/(?:function\s+(\w+)|(\w+)\s*[=:]\s*(?:async\s+)?\()/);
        return match ? (match[1] || match[2]) : null;
    }
    extractClassName(line) {
        const match = line.match(/class\s+(\w+)/);
        return match ? match[1] : null;
    }
    extractJavaMethodName(line) {
        const match = line.match(/\w+\s+(\w+)\s*\(/);
        return match ? match[1] : null;
    }
    extractCSharpMethodName(line) {
        const match = line.match(/\w+\s+(\w+)\s*\(/);
        return match ? match[1] : null;
    }
    calculateComplexity(content) {
        // Simple complexity calculation based on control structures
        const complexityKeywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch', '&&', '||'];
        let complexity = 1; // Base complexity
        for (const keyword of complexityKeywords) {
            const matches = content.match(new RegExp(`\\b${keyword}\\b`, 'g'));
            if (matches) {
                complexity += matches.length;
            }
        }
        return complexity;
    }
}
exports.CodeAnalyzer = CodeAnalyzer;
//# sourceMappingURL=CodeAnalyzer.js.map