/**
 * Python-specific analyzer using AST parsing.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
    ILanguageAnalyzer,
    LanguageAnalysisResult,
    CodeElement,
    ClassElement,
    Parameter,
    Property
} from '../ILanguageAnalyzer';

export class PythonAnalyzer implements ILanguageAnalyzer {
    getLanguage(): string {
        return 'python';
    }

    getSupportedExtensions(): string[] {
        return ['.py'];
    }

    async analyze(filePath: string, content: string): Promise<LanguageAnalysisResult> {
        const functions: CodeElement[] = [];
        const classes: ClassElement[] = [];
        const imports: string[] = [];
        const exports: string[] = [];
        const modules: string[] = [];

        const lines = content.split('\n');
        const functionRegex = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*[\w\[\],\s\.]+)?:/;
        const classRegex = /^(\s*)class\s+(\w+)\s*(\([^)]*\))?:/;
        const methodRegex = /^(\s+)def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*[\w\[\],\s\.]+)?:/;
        const importRegex = /^import\s+(\w+)/;
        const fromImportRegex = /^from\s+([\w.]+)\s+import/;

        let currentClass: { name: string; startLine: number; indent: number } | null = null;
        const allClasses: Array<{ name: string; startLine: number; indent: number; methods: CodeElement[] }> = [];

        // First pass: Find all classes
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const classMatch = line.match(classRegex);
            if (classMatch) {
                const indent = classMatch[1].length;
                allClasses.push({
                    name: classMatch[2],
                    startLine: i + 1,
                    indent: indent,
                    methods: []
                });
            }
        }

        // Second pass: Find functions and methods
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // Check for imports
            const importMatch = line.match(importRegex);
            if (importMatch) {
                imports.push(importMatch[1]);
                modules.push(importMatch[1]);
            }

            const fromImportMatch = line.match(fromImportRegex);
            if (fromImportMatch) {
                imports.push(fromImportMatch[1]);
                modules.push(fromImportMatch[1]);
            }

            // Check if we're entering a class
            const classMatch = line.match(classRegex);
            if (classMatch) {
                currentClass = {
                    name: classMatch[2],
                    startLine: lineNum,
                    indent: classMatch[1].length
                };
            }

            // Check if we're leaving a class
            if (currentClass && i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                if (nextLine.trim() && nextLine.length > 0) {
                    const nextIndent = nextLine.match(/^(\s*)/)?.[1].length || 0;
                    if (nextIndent <= currentClass.indent && nextLine.trim()) {
                        currentClass = null;
                    }
                }
            }

            // Check for function or method
            const funcMatch = line.match(functionRegex);
            const methodMatch = line.match(methodRegex);
            
            if (funcMatch || methodMatch) {
                const match = funcMatch || methodMatch;
                if (!match) continue;

                const funcName = match[2];
                const params = match[3] || '';
                const returnType = match[4] ? match[4].replace('->', '').trim() : 'Any';
                const indent = (match[1] || '').length;

                // Parse parameters
                const parameters: Parameter[] = [];
                if (params.trim()) {
                    const paramList = params.split(',').map(p => p.trim());
                    for (const param of paramList) {
                        if (param && param !== 'self' && param !== 'cls') {
                            const paramMatch = param.match(/^(\w+)(?::\s*([^=]+))?(?:\s*=\s*(.+))?$/);
                            if (paramMatch) {
                                parameters.push({
                                    name: paramMatch[1],
                                    type: paramMatch[2] || 'Any',
                                    optional: paramMatch[3] !== undefined,
                                    defaultValue: paramMatch[3]
                                });
                            }
                        }
                    }
                }

                const element: CodeElement = {
                    name: currentClass ? `${currentClass.name}.${funcName}` : funcName,
                    line: lineNum,
                    column: indent + 1,
                    signature: `${funcName}(${params})`,
                    returnType: returnType,
                    parameters: parameters,
                    isExported: indent === 0,
                    isAsync: line.includes('async def')
                };

                if (currentClass) {
                    // Find the class in allClasses and add method
                    const cls = allClasses.find(c => c.name === currentClass!.name);
                    if (cls) {
                        cls.methods.push(element);
                    }
                } else {
                    functions.push(element);
                }
            }
        }

        // Build class elements
        for (const cls of allClasses) {
            const properties: Property[] = [];
            // Python doesn't have explicit property declarations like TypeScript
            // Properties are typically assigned in __init__

            const classElement: ClassElement = {
                name: cls.name,
                line: cls.startLine,
                column: 1,
                methods: cls.methods.map(m => ({
                    ...m,
                    name: m.name.split('.').pop() || m.name
                })),
                properties,
                isExported: cls.indent === 0
            };
            classes.push(classElement);
        }

        return {
            functions,
            classes,
            imports,
            exports: [], // Python doesn't have explicit exports like ES modules
            modules
        };
    }

    async findReferences(
        symbolName: string,
        filePath: string,
        projectRoot: string
    ): Promise<string[]> {
        const references: string[] = [];
        const escapedName = this.escapeRegex(symbolName);

        function walkDir(dir: string): void {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    if (entry.isDirectory()) {
                        if (!['__pycache__', '.git', 'venv', 'env', '.venv'].includes(entry.name)) {
                            walkDir(fullPath);
                        }
                    } else if (entry.isFile() && entry.name.endsWith('.py')) {
                        try {
                            const content = fs.readFileSync(fullPath, 'utf8');
                            const patterns = [
                                new RegExp(`^import\\s+${escapedName}\\b`, 'm'),
                                new RegExp(`^from\\s+.*import\\s+.*\\b${escapedName}\\b`, 'm'),
                                new RegExp(`\\b${escapedName}\\s*\\(`, 'g')
                            ];

                            if (patterns.some(pattern => pattern.test(content))) {
                                references.push(fullPath);
                            }
                        } catch {
                            // Skip if can't read
                        }
                    }
                }
            } catch {
                // Skip if can't read directory
            }
        }

        if (projectRoot && fs.existsSync(projectRoot)) {
            walkDir(projectRoot);
        }

        return [...new Set(references)];
    }

    async fileUsesSymbol(
        filePath: string,
        symbolName: string,
        projectRoot: string
    ): Promise<boolean> {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }

            const content = fs.readFileSync(filePath, 'utf8');
            const escapedName = this.escapeRegex(symbolName);

            const patterns = [
                new RegExp(`^import\\s+${escapedName}\\b`, 'm'),
                new RegExp(`^from\\s+.*import\\s+.*\\b${escapedName}\\b`, 'm'),
                new RegExp(`\\b${escapedName}\\s*\\(`, 'g')
            ];

            return patterns.some(pattern => pattern.test(content));
        } catch {
            return false;
        }
    }

    async findChangedElements(
        beforeContent: string,
        afterContent: string,
        filePath: string
    ): Promise<{ changedFunctions: string[]; changedClasses: string[] }> {
        const beforeAnalysis = await this.analyze(filePath, beforeContent);
        const afterAnalysis = await this.analyze(filePath, afterContent);

        const changedFunctions: string[] = [];
        const changedClasses: string[] = [];

        // Compare functions
        const beforeFuncMap = new Map(beforeAnalysis.functions.map(f => [f.name, f]));
        const afterFuncMap = new Map(afterAnalysis.functions.map(f => [f.name, f]));

        for (const [name, afterFunc] of afterFuncMap) {
            const beforeFunc = beforeFuncMap.get(name);
            if (!beforeFunc) continue;

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
            if (!beforeClass) continue;

            if (beforeClass.methods.length !== afterClass.methods.length) {
                changedClasses.push(name);
            } else {
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

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

