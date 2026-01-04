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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASTImpactAnalyzer = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const parser_1 = require("@babel/parser");
const traverse_1 = __importDefault(require("@babel/traverse"));
const t = __importStar(require("@babel/types"));
class ASTImpactAnalyzer {
    constructor() {
        this.gitRoot = null;
        this.initializeGitRoot();
    }
    async initializeGitRoot() {
        try {
            const result = (0, child_process_1.execSync)('git rev-parse --show-toplevel', { encoding: 'utf8' });
            this.gitRoot = result.trim();
        }
        catch (error) {
            console.log('Not in a git repository or git not available');
            this.gitRoot = null;
        }
    }
    async analyzeFileImpact(filePath) {
        try {
            // 1. Get the actual changes using git diff
            const changedNodes = await this.extractChangedNodes(filePath);
            // 2. Find affected tests
            const affectedTests = await this.findAffectedTests(filePath, changedNodes);
            // 3. Calculate metrics
            const estimatedRunTimeSec = affectedTests.length * 2;
            const confidence = this.calculateConfidence(changedNodes, affectedTests);
            const coverageImpact = this.calculateCoverageImpact(changedNodes);
            const riskLevel = this.calculateRiskLevel(changedNodes, affectedTests);
            return {
                filePath,
                functionsChanged: changedNodes.functions,
                classesChanged: changedNodes.classes,
                affectedTests,
                estimatedRunTimeSec,
                confidence,
                coverageImpact,
                riskLevel,
                requiresReview: riskLevel === 'high'
            };
        }
        catch (error) {
            console.error('Error analyzing file impact:', error);
            return {
                filePath,
                functionsChanged: [],
                classesChanged: [],
                affectedTests: [],
                estimatedRunTimeSec: 0,
                confidence: 0,
                coverageImpact: 0,
                riskLevel: 'low'
            };
        }
    }
    async extractChangedNodes(filePath) {
        try {
            // Get current file content
            const currentContent = fs.readFileSync(filePath, 'utf8');
            // Get git diff to see what actually changed
            const diff = await this.getGitDiff(filePath);
            if (!diff || diff.trim() === '') {
                // No changes detected
                return { functions: [], classes: [] };
            }
            // Parse current file with AST
            const currentAST = this.parseFile(currentContent, filePath);
            // Parse the diff to find changed line numbers
            const changedLines = this.parseChangedLines(diff);
            // Find functions/classes that are in changed lines
            const changedFunctions = this.findNodesInLines(currentAST.functions, changedLines);
            const changedClasses = this.findNodesInLines(currentAST.classes, changedLines);
            return {
                functions: changedFunctions.map(f => f.name),
                classes: changedClasses.map(c => c.name)
            };
        }
        catch (error) {
            console.error('Error extracting changed nodes:', error);
            return { functions: [], classes: [] };
        }
    }
    parseFile(content, filePath) {
        const functions = [];
        const classes = [];
        try {
            const ext = path.extname(filePath).toLowerCase();
            if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
                return this.parseJavaScriptTypeScript(content);
            }
            else if (ext === '.py') {
                return this.parsePython(content);
            }
            else if (ext === '.java') {
                return this.parseJava(content);
            }
        }
        catch (error) {
            console.error('Error parsing file:', error);
        }
        return { functions, classes };
    }
    parseJavaScriptTypeScript(content) {
        const functions = [];
        const classes = [];
        try {
            const ast = (0, parser_1.parse)(content, {
                sourceType: 'module',
                allowImportExportEverywhere: true,
                allowReturnOutsideFunction: true,
                plugins: [
                    'jsx',
                    'typescript',
                    'decorators-legacy',
                    'classProperties',
                    'objectRestSpread',
                    'functionBind',
                    'exportDefaultFrom',
                    'exportNamespaceFrom',
                    'dynamicImport',
                    'nullishCoalescingOperator',
                    'optionalChaining'
                ]
            });
            (0, traverse_1.default)(ast, {
                FunctionDeclaration(path) {
                    if (path.node.id) {
                        functions.push({
                            type: 'FunctionDeclaration',
                            name: path.node.id.name,
                            start: path.node.start || 0,
                            end: path.node.end || 0,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0
                        });
                    }
                },
                FunctionExpression(path) {
                    if (t.isIdentifier(path.node.id)) {
                        functions.push({
                            type: 'FunctionExpression',
                            name: path.node.id.name,
                            start: path.node.start || 0,
                            end: path.node.end || 0,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0
                        });
                    }
                },
                ArrowFunctionExpression(path) {
                    // Arrow functions assigned to variables
                    if (t.isVariableDeclarator(path.parent) && t.isIdentifier(path.parent.id)) {
                        functions.push({
                            type: 'ArrowFunctionExpression',
                            name: path.parent.id.name,
                            start: path.node.start || 0,
                            end: path.node.end || 0,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0
                        });
                    }
                },
                ClassDeclaration(path) {
                    if (path.node.id) {
                        classes.push({
                            type: 'ClassDeclaration',
                            name: path.node.id.name,
                            start: path.node.start || 0,
                            end: path.node.end || 0,
                            line: path.node.loc?.start.line || 0,
                            column: path.node.loc?.start.column || 0
                        });
                    }
                }
            });
        }
        catch (error) {
            console.error('Error parsing JavaScript/TypeScript:', error);
        }
        return { functions, classes };
    }
    parsePython(content) {
        const functions = [];
        const classes = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Function detection
            if (line.startsWith('def ')) {
                const funcName = line.split('def ')[1]?.split('(')[0]?.trim();
                if (funcName) {
                    functions.push({
                        type: 'FunctionDefinition',
                        name: funcName,
                        start: 0,
                        end: 0,
                        line: i + 1,
                        column: 0
                    });
                }
            }
            // Class detection
            if (line.startsWith('class ')) {
                const className = line.split('class ')[1]?.split('(')[0]?.split(':')[0]?.trim();
                if (className) {
                    classes.push({
                        type: 'ClassDefinition',
                        name: className,
                        start: 0,
                        end: 0,
                        line: i + 1,
                        column: 0
                    });
                }
            }
        }
        return { functions, classes };
    }
    parseJava(content) {
        const functions = [];
        const classes = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Method detection (simplified)
            if (line.includes('(') && line.includes(')') &&
                (line.includes('public') || line.includes('private') || line.includes('protected')) &&
                !line.includes('class') && !line.includes('interface')) {
                const methodMatch = line.match(/(\w+)\s*\(/);
                if (methodMatch) {
                    functions.push({
                        type: 'MethodDeclaration',
                        name: methodMatch[1],
                        start: 0,
                        end: 0,
                        line: i + 1,
                        column: 0
                    });
                }
            }
            // Class detection
            if (line.includes('class ')) {
                const classMatch = line.match(/class\s+(\w+)/);
                if (classMatch) {
                    classes.push({
                        type: 'ClassDeclaration',
                        name: classMatch[1],
                        start: 0,
                        end: 0,
                        line: i + 1,
                        column: 0
                    });
                }
            }
        }
        return { functions, classes };
    }
    findNodesInLines(nodes, changedLines) {
        return nodes.filter(node => {
            // Check if the node's line is in the changed lines
            return changedLines.some(line => Math.abs(line - node.line) <= 2); // Allow some tolerance
        });
    }
    async getGitDiff(filePath) {
        if (!this.gitRoot) {
            return null;
        }
        try {
            const relativePath = path.relative(this.gitRoot, filePath);
            const result = (0, child_process_1.execSync)(`git diff HEAD -- "${relativePath}"`, {
                encoding: 'utf8',
                cwd: this.gitRoot
            });
            return result;
        }
        catch (error) {
            console.log('No git diff available for file:', filePath);
            return null;
        }
    }
    parseChangedLines(diff) {
        const changedLines = [];
        const lines = diff.split('\n');
        for (const line of lines) {
            // Look for lines that start with + or - (added/removed lines)
            if (line.startsWith('+') && !line.startsWith('+++')) {
                // Extract line number from diff format
                const match = line.match(/^\+(\d+)/);
                if (match) {
                    changedLines.push(parseInt(match[1]));
                }
            }
        }
        return changedLines;
    }
    async findAffectedTests(filePath, changedNodes) {
        // This is a simplified implementation
        // In a real scenario, you'd use tools like:
        // - jest --findRelatedTests
        // - Static analysis of test files
        // - Dependency mapping
        const testFiles = [];
        try {
            // Look for test files in the same directory and subdirectories
            const dir = path.dirname(filePath);
            const testPatterns = [
                '**/*.test.js',
                '**/*.test.ts',
                '**/*.spec.js',
                '**/*.spec.ts',
                '**/__tests__/**/*.js',
                '**/__tests__/**/*.ts'
            ];
            for (const pattern of testPatterns) {
                try {
                    const result = (0, child_process_1.execSync)(`find "${dir}" -name "${pattern.replace('**/', '')}" -type f`, {
                        encoding: 'utf8',
                        cwd: dir
                    });
                    const files = result.trim().split('\n').filter(f => f.trim());
                    testFiles.push(...files);
                }
                catch (error) {
                    // Pattern not found, continue
                }
            }
        }
        catch (error) {
            console.error('Error finding test files:', error);
        }
        return testFiles;
    }
    calculateConfidence(changedNodes, affectedTests) {
        // Higher confidence when we have specific changes and can find related tests
        if (changedNodes.functions.length === 0 && changedNodes.classes.length === 0) {
            return 0; // No changes detected
        }
        if (affectedTests.length === 0) {
            return 0.3; // Low confidence - no tests found
        }
        return Math.min(0.9, 0.5 + (affectedTests.length * 0.1)); // Higher confidence with more tests
    }
    calculateCoverageImpact(changedNodes) {
        // Simple calculation based on number of changed functions/classes
        const totalChanges = changedNodes.functions.length + changedNodes.classes.length;
        return Math.min(1.0, totalChanges * 0.1); // 10% per change, max 100%
    }
    calculateRiskLevel(changedNodes, affectedTests) {
        const totalChanges = changedNodes.functions.length + changedNodes.classes.length;
        if (totalChanges === 0)
            return 'low';
        if (totalChanges <= 2 && affectedTests.length > 0)
            return 'low';
        if (totalChanges <= 5)
            return 'medium';
        return 'high';
    }
}
exports.ASTImpactAnalyzer = ASTImpactAnalyzer;
//# sourceMappingURL=ASTImpactAnalyzer.js.map