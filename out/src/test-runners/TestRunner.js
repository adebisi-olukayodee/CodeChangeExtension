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
exports.TestRunner = void 0;
const vscode = __importStar(require("vscode"));
const child_process = __importStar(require("child_process"));
const path = __importStar(require("path"));
class TestRunner {
    constructor() {
        this.testResults = [];
        this.outputChannel = vscode.window.createOutputChannel('Impact Analyzer - Test Runner');
    }
    async runTests(testFiles) {
        const results = [];
        this.outputChannel.clear();
        this.outputChannel.appendLine(`Running ${testFiles.length} test files...`);
        for (const testFile of testFiles) {
            try {
                const result = await this.runSingleTest(testFile);
                results.push(result);
                this.testResults.push(result);
            }
            catch (error) {
                console.error(`Error running test ${testFile}:`, error);
                const errorResult = {
                    testFile,
                    status: 'error',
                    duration: 0,
                    errorMessage: error instanceof Error ? error.message : 'Unknown error'
                };
                results.push(errorResult);
                this.testResults.push(errorResult);
            }
        }
        this.logResults(results);
        return results;
    }
    async runSingleTest(testFile) {
        const startTime = Date.now();
        // Determine test framework and run appropriate command
        const framework = this.detectTestFramework(testFile);
        const command = this.getTestCommand(framework, testFile);
        this.outputChannel.appendLine(`\nRunning test: ${testFile}`);
        this.outputChannel.appendLine(`Framework: ${framework}`);
        this.outputChannel.appendLine(`Command: ${command}`);
        return new Promise((resolve, reject) => {
            const process = child_process.spawn(command, [], {
                shell: true,
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
            process.stdout?.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                this.outputChannel.append(output);
            });
            process.stderr?.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                this.outputChannel.append(output);
            });
            process.on('close', (code) => {
                const duration = Date.now() - startTime;
                const status = this.determineTestStatus(code || 0, stdout, stderr);
                const result = {
                    testFile,
                    status,
                    duration,
                    errorMessage: status === 'failed' || status === 'error' ? stderr : undefined,
                    output: stdout
                };
                this.outputChannel.appendLine(`\nTest completed with status: ${status} (${duration}ms)`);
                resolve(result);
            });
            process.on('error', (error) => {
                const duration = Date.now() - startTime;
                reject(new Error(`Failed to run test: ${error.message}`));
            });
        });
    }
    detectTestFramework(testFile) {
        const fileName = path.basename(testFile).toLowerCase();
        const ext = path.extname(testFile).toLowerCase();
        try {
            const content = require('fs').readFileSync(testFile, 'utf8');
            // Framework-specific detection
            if (fileName.includes('jest') || content.includes('jest') || content.includes('describe(') && content.includes('it(')) {
                return 'jest';
            }
            else if (fileName.includes('mocha') || content.includes('mocha')) {
                return 'mocha';
            }
            else if (fileName.includes('pytest') || content.includes('pytest') || content.includes('def test_')) {
                return 'pytest';
            }
            else if (fileName.includes('junit') || content.includes('junit') || content.includes('@Test')) {
                return 'junit';
            }
            else if (fileName.includes('cypress') || content.includes('cypress')) {
                return 'cypress';
            }
            else if (fileName.includes('playwright') || content.includes('playwright')) {
                return 'playwright';
            }
            else if (fileName.includes('vitest') || content.includes('vitest')) {
                return 'vitest';
            }
            // Default detection based on file extension and content
            if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx') {
                if (content.includes('describe') || content.includes('it') || content.includes('test')) {
                    return 'jest'; // Default to Jest for JS/TS files
                }
            }
            else if (ext === '.py') {
                if (content.includes('def test_') || content.includes('pytest')) {
                    return 'pytest';
                }
            }
            else if (ext === '.java') {
                if (content.includes('@Test') || content.includes('junit')) {
                    return 'junit';
                }
            }
            else if (ext === '.cs') {
                if (content.includes('[Test]') || content.includes('NUnit')) {
                    return 'nunit';
                }
            }
        }
        catch (error) {
            console.error('Error reading test file:', error);
        }
        return 'unknown';
    }
    getTestCommand(framework, testFile) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const relativePath = path.relative(workspaceFolder?.uri.fsPath || '', testFile);
        switch (framework) {
            case 'jest':
                return `npx jest ${relativePath} --verbose`;
            case 'mocha':
                return `npx mocha ${relativePath}`;
            case 'vitest':
                return `npx vitest run ${relativePath}`;
            case 'pytest':
                return `python -m pytest ${relativePath} -v`;
            case 'junit':
                return `mvn test -Dtest=${path.basename(testFile, '.java')}`;
            case 'nunit':
                return `dotnet test --filter ${path.basename(testFile, '.cs')}`;
            case 'cypress':
                return `npx cypress run --spec ${relativePath}`;
            case 'playwright':
                return `npx playwright test ${relativePath}`;
            default:
                // Try to run with node for JS files
                if (path.extname(testFile).toLowerCase() === '.js') {
                    return `node ${relativePath}`;
                }
                return `echo "Unknown test framework for ${testFile}"`;
        }
    }
    determineTestStatus(exitCode, stdout, stderr) {
        if (exitCode === 0) {
            return 'passed';
        }
        // Check for skipped tests
        if (stdout.includes('skipped') || stderr.includes('skipped')) {
            return 'skipped';
        }
        // Check for test failures
        if (stdout.includes('failed') || stderr.includes('failed') ||
            stdout.includes('FAIL') || stderr.includes('FAIL')) {
            return 'failed';
        }
        return 'error';
    }
    logResults(results) {
        const passed = results.filter(r => r.status === 'passed').length;
        const failed = results.filter(r => r.status === 'failed').length;
        const skipped = results.filter(r => r.status === 'skipped').length;
        const errors = results.filter(r => r.status === 'error').length;
        const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
        this.outputChannel.appendLine('\n' + '='.repeat(50));
        this.outputChannel.appendLine('TEST RESULTS SUMMARY');
        this.outputChannel.appendLine('='.repeat(50));
        this.outputChannel.appendLine(`Total: ${results.length}`);
        this.outputChannel.appendLine(`Passed: ${passed}`);
        this.outputChannel.appendLine(`Failed: ${failed}`);
        this.outputChannel.appendLine(`Skipped: ${skipped}`);
        this.outputChannel.appendLine(`Errors: ${errors}`);
        this.outputChannel.appendLine(`Total Time: ${totalTime}ms`);
        this.outputChannel.appendLine('='.repeat(50));
        // Show failed tests
        const failedTests = results.filter(r => r.status === 'failed' || r.status === 'error');
        if (failedTests.length > 0) {
            this.outputChannel.appendLine('\nFAILED TESTS:');
            failedTests.forEach(test => {
                this.outputChannel.appendLine(`- ${test.testFile}: ${test.errorMessage || 'Unknown error'}`);
            });
        }
    }
    showOutput() {
        this.outputChannel.show();
    }
    clearOutput() {
        this.outputChannel.clear();
    }
    getTestResults() {
        return this.testResults;
    }
    getLastTestResults() {
        return this.testResults.slice(-10); // Last 10 test runs
    }
}
exports.TestRunner = TestRunner;
//# sourceMappingURL=TestRunner.js.map