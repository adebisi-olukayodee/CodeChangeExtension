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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestRunner = void 0;
const vscode = __importStar(require("vscode"));
const child_process = __importStar(require("child_process"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const TestFrameworkDetector_1 = require("../utils/TestFrameworkDetector");
const PackageManagerDetector_1 = require("../utils/PackageManagerDetector");
class TestRunner {
    constructor() {
        this.testResults = [];
        this.outputChannel = vscode.window.createOutputChannel('Impact Analyzer - Test Runner');
        this.testFrameworkDetector = new TestFrameworkDetector_1.TestFrameworkDetector();
        this.packageManagerDetector = new PackageManagerDetector_1.PackageManagerDetector();
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
        // Find project root by looking for package.json (more reliable than workspace folder)
        const projectRoot = this.findProjectRoot(testFile);
        this.outputChannel.appendLine(`\nRunning test: ${testFile}`);
        this.outputChannel.appendLine(`Project Root: ${projectRoot}`);
        // Detect package manager
        const pmInfo = this.packageManagerDetector.detect(projectRoot);
        // Detect test framework from repository (not just file content)
        const frameworkInfo = this.testFrameworkDetector.detect(projectRoot);
        const framework = frameworkInfo.framework;
        // Get test command using package manager and framework
        const command = this.getTestCommand(framework, testFile, projectRoot, pmInfo.manager);
        this.outputChannel.appendLine(`Package Manager: ${pmInfo.manager}`);
        this.outputChannel.appendLine(`Framework: ${framework} (confidence: ${frameworkInfo.confidence})`);
        if (frameworkInfo.evidence.length > 0) {
            this.outputChannel.appendLine(`Framework Evidence: ${frameworkInfo.evidence.join('; ')}`);
        }
        this.outputChannel.appendLine(`Command: ${command}`);
        return new Promise((resolve, reject) => {
            // Use projectRoot (where package.json is) as working directory, not workspace folder
            // This ensures we run tests in the correct project context
            const process = child_process.spawn(command, [], {
                shell: true,
                cwd: projectRoot, // Use detected project root, not workspace folder
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
                // Parse test output to extract error details
                const parsedError = this.parseTestOutput(stdout + stderr, framework, testFile);
                const result = {
                    testFile,
                    testCase: parsedError.testCase,
                    status,
                    duration,
                    errorMessage: parsedError.errorMessage || (status === 'failed' || status === 'error' ? stderr : undefined),
                    stackTrace: parsedError.stackTrace,
                    output: stdout + stderr
                };
                this.outputChannel.appendLine(`\nTest completed with status: ${status} (${duration}ms)`);
                if (result.errorMessage) {
                    this.outputChannel.appendLine(`Error: ${result.errorMessage}`);
                }
                resolve(result);
            });
            process.on('error', (error) => {
                const duration = Date.now() - startTime;
                reject(new Error(`Failed to run test: ${error.message}`));
            });
        });
    }
    /**
     * Find project root by looking for package.json
     * Walks up the directory tree until it finds package.json
     */
    findProjectRoot(filePath) {
        let currentDir = path.dirname(filePath);
        const root = path.parse(currentDir).root; // Get drive root (C:\) or / for Unix
        while (currentDir !== root) {
            const packageJsonPath = path.join(currentDir, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                return currentDir;
            }
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                break; // Reached root
            }
            currentDir = parentDir;
        }
        // Fallback: Use workspace folder or file's directory
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder?.uri.fsPath || path.dirname(filePath);
    }
    /**
     * Detect framework from test file content (fallback when repo detection fails)
     */
    detectFrameworkFromFile(testFile) {
        try {
            const content = fs.readFileSync(testFile, 'utf8');
            // Check for vitest-specific patterns (highest priority)
            if (content.includes('vi.') ||
                content.includes('import { vi }') ||
                content.includes('from \'vitest\'') ||
                content.includes('from "vitest"')) {
                return 'vitest';
            }
            // Check for jest-specific patterns
            if (content.includes('jest.mock') ||
                content.includes('jest.fn') ||
                content.includes('from \'@jest/globals\'') ||
                content.includes('from "@jest/globals"')) {
                return 'jest';
            }
            // Generic patterns (describe/it/expect) - could be either
            if (content.includes('describe') && content.includes('it') && content.includes('expect')) {
                // Check project root for hints
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const projectRoot = workspaceFolder.uri.fsPath;
                    // Try to detect from project (might have been missed)
                    const frameworkInfo = this.testFrameworkDetector.detect(projectRoot);
                    if (frameworkInfo.framework !== 'unknown') {
                        return frameworkInfo.framework;
                    }
                }
                // Default to vitest for modern projects
                return 'vitest';
            }
        }
        catch (error) {
            // Can't read file
        }
        return 'unknown';
    }
    getTestCommand(framework, testFile, projectRoot, packageManager) {
        const relativePath = path.relative(projectRoot, testFile);
        switch (framework) {
            case 'vitest':
                // Use local binary: <pm> vitest run <file>
                return this.packageManagerDetector.getCommand(projectRoot, 'vitest', ['run', relativePath]);
            case 'jest':
                // Use local binary: <pm> jest <file>
                return this.packageManagerDetector.getCommand(projectRoot, 'jest', [relativePath, '--verbose']);
            case 'mocha':
                return this.packageManagerDetector.getCommand(projectRoot, 'mocha', [relativePath]);
            case 'playwright':
                return this.packageManagerDetector.getCommand(projectRoot, 'playwright', ['test', relativePath]);
            case 'cypress':
                return this.packageManagerDetector.getCommand(projectRoot, 'cypress', ['run', '--spec', relativePath]);
            case 'ava':
                return this.packageManagerDetector.getCommand(projectRoot, 'ava', [relativePath]);
            case 'unknown':
                // Try to detect framework from test file content as fallback
                const detectedFromFile = this.detectFrameworkFromFile(testFile);
                if (detectedFromFile !== 'unknown') {
                    this.outputChannel.appendLine(`⚠️ Framework unknown from repo, but detected from file: ${detectedFromFile}`);
                    // Recursively call with detected framework
                    return this.getTestCommand(detectedFromFile, testFile, projectRoot, packageManager);
                }
                // Last resort: Try common test runners with the specific file
                // Try vitest first (common in modern projects)
                const vitestBin = path.join(projectRoot, 'node_modules', '.bin', 'vitest');
                if (fs.existsSync(vitestBin)) {
                    this.outputChannel.appendLine(`⚠️ Unknown framework, trying vitest (found binary)`);
                    return `"${vitestBin}" run ${relativePath}`;
                }
                // Try jest
                const jestBin = path.join(projectRoot, 'node_modules', '.bin', 'jest');
                if (fs.existsSync(jestBin)) {
                    this.outputChannel.appendLine(`⚠️ Unknown framework, trying jest (found binary)`);
                    return `"${jestBin}" ${relativePath} --verbose`;
                }
                // Final fallback: test script (but warn it might run all tests)
                this.outputChannel.appendLine(`⚠️ Unknown test framework - falling back to: ${packageManager} test (may run all tests, not just ${path.basename(testFile)})`);
                switch (packageManager) {
                    case 'pnpm':
                        return 'pnpm test';
                    case 'yarn':
                        return 'yarn test';
                    case 'npm':
                        return 'npm test';
                }
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
    /**
     * Strip ANSI color codes from string
     */
    stripAnsiCodes(text) {
        // Remove ANSI escape sequences (color codes, formatting, etc.)
        // Pattern: \x1b[ or \u001b[ followed by numbers and letters, ending with m
        return text.replace(/\u001b\[[0-9;]*m/g, '');
    }
    /**
     * Parse test output to extract error details (test case name, error message, stack trace)
     */
    parseTestOutput(output, framework, testFile) {
        const result = {};
        // Strip ANSI codes for easier parsing
        const cleanOutput = this.stripAnsiCodes(output);
        if (framework === 'vitest' || framework === 'jest') {
            // Parse vitest/jest output format
            // Example: "FAIL src/cn-impact.test.ts > cn() > returns a string"
            // Or: "❯ src/cn-impact.test.ts > cn() > returns a string"
            const testCasePatterns = [
                /(?:FAIL|❌)\s+[^\s]+\s+>\s+([^>\n]+(?:\s+>\s+[^>\n]+)*)/, // FAIL file > suite > test
                /❯\s+[^\s]+\s+>\s+([^>\n]+(?:\s+>\s+[^>\n]+)*)/, // ❯ file > suite > test
                /×\s+([^\n]+)/, // × test name
            ];
            for (const pattern of testCasePatterns) {
                const match = cleanOutput.match(pattern);
                if (match) {
                    result.testCase = match[1].trim();
                    break;
                }
            }
            // Extract error message (TypeError, AssertionError, etc.)
            // Look for patterns like: "TypeError: message" or "TypeError message"
            const errorPatterns = [
                /(TypeError|AssertionError|Error|ReferenceError|SyntaxError)[:\s]+([^\n]+)/,
                /(TypeError|AssertionError|Error|ReferenceError|SyntaxError)\s*\(([^)]+)\)/,
            ];
            for (const pattern of errorPatterns) {
                const match = cleanOutput.match(pattern);
                if (match) {
                    const errorType = match[1];
                    const errorMsg = match[2]?.trim();
                    if (errorMsg) {
                        result.errorMessage = `${errorType}: ${errorMsg}`;
                        break;
                    }
                }
            }
            // Extract stack trace (file path and line number)
            // Example: "❯ src/cn-impact.test.ts:6:19"
            const stackPatterns = [
                /❯\s+([^\s:]+):(\d+):(\d+)/, // ❯ file:line:column
                /at\s+([^\s:]+):(\d+):(\d+)/, // at file:line:column
                /([^\s:]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)/, // file:line:column (anywhere)
            ];
            for (const pattern of stackPatterns) {
                const match = cleanOutput.match(pattern);
                if (match) {
                    const filePath = match[1];
                    const line = match[2];
                    const column = match[3];
                    result.stackTrace = `${filePath}:${line}:${column}`;
                    break;
                }
            }
            // Extract full error details from vitest format
            // Look for the error block between "⎯⎯⎯" markers or in "Failed Tests" section
            const errorBlockPatterns = [
                /⎯⎯⎯[^⎯]*\n([^⎯]+)\n⎯⎯⎯/s, // Between ⎯⎯⎯ markers
                /Failed Tests[^\n]*\n([^]*?)(?=\n\n|\nTest Files|$)/s, // Failed Tests section
            ];
            for (const pattern of errorBlockPatterns) {
                const match = cleanOutput.match(pattern);
                if (match) {
                    const errorBlock = match[1];
                    // Extract error type and message from block
                    if (!result.errorMessage) {
                        const errorTypeMatch = errorBlock.match(/(TypeError|AssertionError|Error|ReferenceError|SyntaxError)[:\s]+([^\n]+)/);
                        if (errorTypeMatch) {
                            result.errorMessage = `${errorTypeMatch[1]}: ${errorTypeMatch[2].trim()}`;
                        }
                    }
                    // Extract file location from error block if not found yet
                    if (!result.stackTrace) {
                        const locationMatch = errorBlock.match(/([^\s:]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)/);
                        if (locationMatch) {
                            result.stackTrace = `${locationMatch[1]}:${locationMatch[2]}:${locationMatch[3]}`;
                        }
                    }
                    // Extract test case from error block if not found yet
                    if (!result.testCase) {
                        const testCaseMatch = errorBlock.match(/>\s+([^>\n]+(?:\s+>\s+[^>\n]+)*)/);
                        if (testCaseMatch) {
                            result.testCase = testCaseMatch[1].trim();
                        }
                    }
                }
            }
        }
        // Fallback: Extract any error-like message
        if (!result.errorMessage) {
            const genericErrorMatch = cleanOutput.match(/(TypeError|AssertionError|Error|ReferenceError|SyntaxError)[:\s]+([^\n]+)/);
            if (genericErrorMatch) {
                result.errorMessage = `${genericErrorMatch[1]}: ${genericErrorMatch[2].trim()}`;
            }
        }
        // Enhance error message for common cases - detect root causes
        if (result.errorMessage) {
            // Check if error is "is not a function" - this often means export was removed
            // Pattern: "(0 , __vite_ssr_import_1__.cn) is not a function"
            // or: "cn is not a function"
            if (result.errorMessage.includes('is not a function')) {
                // Try to extract the symbol name from various patterns
                const symbolPatterns = [
                    /\(0\s*,\s*[^_]*_import_\d+__\.(\w+)\)\s+is not a function/, // (0 , __vite_ssr_import_1__.cn) is not a function
                    /(\w+)\s+is not a function/, // cn is not a function
                    /\(0\s*,\s*[^_]*_import_\d+__\[['"](\w+)['"]\]\)\s+is not a function/, // (0 , __import_1__["cn"]) is not a function
                ];
                let symbolName = null;
                for (const pattern of symbolPatterns) {
                    const match = result.errorMessage.match(pattern);
                    if (match) {
                        symbolName = match[1];
                        break;
                    }
                }
                if (symbolName) {
                    result.errorMessage = `Export '${symbolName}' was removed or is not exported. The import resolves to undefined, causing "is not a function" error.`;
                }
                else {
                    // Keep original but add context
                    result.errorMessage = `Possible missing export (original: ${result.errorMessage})`;
                }
            }
            // Check for "Cannot read property" - might indicate missing export
            if (result.errorMessage.includes('Cannot read property') || result.errorMessage.includes('Cannot read properties')) {
                const propMatch = result.errorMessage.match(/Cannot read (?:properties of undefined \(reading '(\w+)'\)|property '(\w+)')/);
                if (propMatch) {
                    const propName = propMatch[1] || propMatch[2];
                    result.errorMessage = `Export '${propName}' was removed or is not exported. Cannot read property of undefined.`;
                }
            }
        }
        return result;
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
        // Show failed tests with detailed error information
        const failedTests = results.filter(r => r.status === 'failed' || r.status === 'error');
        if (failedTests.length > 0) {
            this.outputChannel.appendLine('\nFAILED TESTS:');
            failedTests.forEach(test => {
                this.outputChannel.appendLine(`- ${test.testFile}`);
                if (test.testCase) {
                    this.outputChannel.appendLine(`  Test: ${test.testCase}`);
                }
                if (test.errorMessage) {
                    // Strip ANSI codes from error message for cleaner output
                    const cleanError = this.stripAnsiCodes(test.errorMessage);
                    this.outputChannel.appendLine(`  Error: ${cleanError}`);
                }
                else {
                    this.outputChannel.appendLine(`  Error: Unknown error`);
                }
                if (test.stackTrace) {
                    this.outputChannel.appendLine(`  Location: ${test.stackTrace}`);
                }
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