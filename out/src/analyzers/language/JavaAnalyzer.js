"use strict";
/**
 * Java-specific analyzer using regex-based parsing.
 * Note: For production use, consider integrating with a Java AST parser like Eclipse JDT.
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
exports.JavaAnalyzer = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class JavaAnalyzer {
    getLanguage() {
        return 'java';
    }
    getSupportedExtensions() {
        return ['.java'];
    }
    async analyze(filePath, content) {
        const functions = [];
        const classes = [];
        const imports = [];
        const exports = [];
        const modules = [];
        const lines = content.split('\n');
        const classRegex = /^\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/;
        const methodRegex = /^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:abstract\s+)?(?:final\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)/;
        const importRegex = /^import\s+(?:static\s+)?([\w.]+)/;
        const packageRegex = /^package\s+([\w.]+)/;
        let currentClass = null;
        const allClasses = [];
        // First pass: Find all classes
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const classMatch = line.match(classRegex);
            if (classMatch) {
                allClasses.push({
                    name: classMatch[1],
                    startLine: i + 1,
                    methods: []
                });
            }
        }
        // Second pass: Find methods and imports
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            // Check for package declaration
            const packageMatch = line.match(packageRegex);
            if (packageMatch) {
                modules.push(packageMatch[1]);
            }
            // Check for imports
            const importMatch = line.match(importRegex);
            if (importMatch) {
                imports.push(importMatch[1]);
                modules.push(importMatch[1]);
            }
            // Check if we're entering a class
            const classMatch = line.match(classRegex);
            if (classMatch) {
                currentClass = {
                    name: classMatch[1],
                    startLine: lineNum
                };
            }
            // Check for method
            const methodMatch = line.match(methodRegex);
            if (methodMatch) {
                const returnType = methodMatch[1];
                const methodName = methodMatch[2];
                const params = methodMatch[3] || '';
                // Parse parameters
                const parameters = [];
                if (params.trim()) {
                    const paramList = params.split(',').map(p => p.trim());
                    for (const param of paramList) {
                        const paramMatch = param.match(/^\s*(\w+(?:<[^>]+>)?)\s+(\w+)/);
                        if (paramMatch) {
                            parameters.push({
                                name: paramMatch[2],
                                type: paramMatch[1],
                                optional: false,
                                defaultValue: undefined
                            });
                        }
                    }
                }
                const element = {
                    name: currentClass ? `${currentClass.name}.${methodName}` : methodName,
                    line: lineNum,
                    column: 1,
                    signature: `${methodName}(${params})`,
                    returnType: returnType,
                    parameters: parameters,
                    isExported: line.includes('public'),
                    isAsync: false // Java doesn't have async/await
                };
                if (currentClass) {
                    const cls = allClasses.find(c => c.name === currentClass.name);
                    if (cls) {
                        cls.methods.push(element);
                    }
                }
                else {
                    functions.push(element);
                }
            }
        }
        // Build class elements
        for (const cls of allClasses) {
            const properties = [];
            // Java properties are typically fields declared at class level
            // This would require more sophisticated parsing
            const classElement = {
                name: cls.name,
                line: cls.startLine,
                column: 1,
                methods: cls.methods.map(m => ({
                    ...m,
                    name: m.name.split('.').pop() || m.name
                })),
                properties,
                isExported: true // Java classes are public by default if in public package
            };
            classes.push(classElement);
        }
        return {
            functions,
            classes,
            imports,
            exports: [],
            modules
        };
    }
    async findReferences(symbolName, filePath, projectRoot) {
        const references = [];
        const escapedName = this.escapeRegex(symbolName);
        function walkDir(dir) {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (!['target', '.git', 'build', 'out', '.idea'].includes(entry.name)) {
                            walkDir(fullPath);
                        }
                    }
                    else if (entry.isFile() && entry.name.endsWith('.java')) {
                        try {
                            const content = fs.readFileSync(fullPath, 'utf8');
                            const patterns = [
                                new RegExp(`^import\\s+.*\\b${escapedName}\\b`, 'm'),
                                new RegExp(`\\b${escapedName}\\s*\\(`, 'g'),
                                new RegExp(`new\\s+${escapedName}\\s*\\(`, 'g')
                            ];
                            if (patterns.some(pattern => pattern.test(content))) {
                                references.push(fullPath);
                            }
                        }
                        catch {
                            // Skip if can't read
                        }
                    }
                }
            }
            catch {
                // Skip if can't read directory
            }
        }
        if (projectRoot && fs.existsSync(projectRoot)) {
            walkDir(projectRoot);
        }
        return [...new Set(references)];
    }
    async fileUsesSymbol(filePath, symbolName, projectRoot) {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const escapedName = this.escapeRegex(symbolName);
            const patterns = [
                new RegExp(`^import\\s+.*\\b${escapedName}\\b`, 'm'),
                new RegExp(`\\b${escapedName}\\s*\\(`, 'g'),
                new RegExp(`new\\s+${escapedName}\\s*\\(`, 'g')
            ];
            return patterns.some(pattern => pattern.test(content));
        }
        catch {
            return false;
        }
    }
    async findChangedElements(beforeContent, afterContent, filePath) {
        const beforeAnalysis = await this.analyze(filePath, beforeContent);
        const afterAnalysis = await this.analyze(filePath, afterContent);
        const changedFunctions = [];
        const changedClasses = [];
        // Compare functions/methods
        const beforeFuncMap = new Map(beforeAnalysis.functions.map(f => [f.name, f]));
        const afterFuncMap = new Map(afterAnalysis.functions.map(f => [f.name, f]));
        for (const [name, afterFunc] of afterFuncMap) {
            const beforeFunc = beforeFuncMap.get(name);
            if (!beforeFunc)
                continue;
            if (beforeFunc.signature !== afterFunc.signature ||
                beforeFunc.returnType !== afterFunc.returnType) {
                changedFunctions.push(name);
            }
        }
        for (const [name] of beforeFuncMap) {
            if (!afterFuncMap.has(name)) {
                changedFunctions.push(name);
            }
        }
        // Compare classes
        const beforeClassMap = new Map(beforeAnalysis.classes.map(c => [c.name, c]));
        const afterClassMap = new Map(afterAnalysis.classes.map(c => [c.name, c]));
        for (const [name, afterClass] of afterClassMap) {
            const beforeClass = beforeClassMap.get(name);
            if (!beforeClass)
                continue;
            if (beforeClass.methods.length !== afterClass.methods.length) {
                changedClasses.push(name);
            }
            else {
                const beforeMethodMap = new Map(beforeClass.methods.map(m => [m.name, m]));
                const afterMethodMap = new Map(afterClass.methods.map(m => [m.name, m]));
                for (const [methodName, afterMethod] of afterMethodMap) {
                    const beforeMethod = beforeMethodMap.get(methodName);
                    if (beforeMethod && beforeMethod.signature !== afterMethod.signature) {
                        changedClasses.push(name);
                        break;
                    }
                }
            }
        }
        for (const [name] of beforeClassMap) {
            if (!afterClassMap.has(name)) {
                changedClasses.push(name);
            }
        }
        return {
            changedFunctions: [...new Set(changedFunctions)],
            changedClasses: [...new Set(changedClasses)]
        };
    }
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
exports.JavaAnalyzer = JavaAnalyzer;
//# sourceMappingURL=JavaAnalyzer.js.map