/**
 * Java-specific analyzer using regex-based parsing.
 * Note: For production use, consider integrating with a Java AST parser like Eclipse JDT.
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

export class JavaAnalyzer implements ILanguageAnalyzer {
    getLanguage(): string {
        return 'java';
    }

    getSupportedExtensions(): string[] {
        return ['.java'];
    }

    async analyze(filePath: string, content: string): Promise<LanguageAnalysisResult> {
        const functions: CodeElement[] = [];
        const classes: ClassElement[] = [];
        const imports: string[] = [];
        const exports: string[] = [];
        const modules: string[] = [];

        const lines = content.split('\n');
        const classRegex = /^\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/;
        const methodRegex = /^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:abstract\s+)?(?:final\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)/;
        const importRegex = /^import\s+(?:static\s+)?([\w.]+)/;
        const packageRegex = /^package\s+([\w.]+)/;

        let currentClass: { name: string; startLine: number } | null = null;
        const allClasses: Array<{ name: string; startLine: number; methods: CodeElement[] }> = [];

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
                const parameters: Parameter[] = [];
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

                const element: CodeElement = {
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
            // Java properties are typically fields declared at class level
            // This would require more sophisticated parsing

            const classElement: ClassElement = {
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
            exports: [], // Java doesn't have explicit exports
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
                        if (!['target', '.git', 'build', 'out', '.idea'].includes(entry.name)) {
                            walkDir(fullPath);
                        }
                    } else if (entry.isFile() && entry.name.endsWith('.java')) {
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
                new RegExp(`^import\\s+.*\\b${escapedName}\\b`, 'm'),
                new RegExp(`\\b${escapedName}\\s*\\(`, 'g'),
                new RegExp(`new\\s+${escapedName}\\s*\\(`, 'g')
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

        // Compare functions/methods
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

