import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';

export interface TestResult {
    testFile: string;
    testCase?: string;
    status: 'passed' | 'failed' | 'skipped' | 'error';
    duration: number;
    errorMessage?: string;
    stackTrace?: string;
    output?: string;
}

export class TestRunner {
    private outputChannel: vscode.OutputChannel;
    private testResults: TestResult[] = [];

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Impact Analyzer - Test Runner');
    }

    async runTests(testFiles: string[]): Promise<TestResult[]> {
        const results: TestResult[] = [];
        
        this.outputChannel.clear();
        this.outputChannel.appendLine(`Running ${testFiles.length} test files...`);
        this.outputChannel.appendLine(`Test files: ${testFiles.join(', ')}`);
        
        for (const testFile of testFiles) {
            try {
                // Resolve to absolute path if relative
                const absolutePath = path.isAbsolute(testFile) 
                    ? testFile 
                    : path.resolve(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', testFile);
                
                this.outputChannel.appendLine(`[TestRunner] Resolved test file path: ${absolutePath}`);
                this.outputChannel.appendLine(`[TestRunner] File exists: ${require('fs').existsSync(absolutePath)}`);
                
                const result = await this.runSingleTest(absolutePath);
                results.push(result);
                this.testResults.push(result);
            } catch (error) {
                this.outputChannel.appendLine(`[TestRunner] ❌ Error running test ${testFile}: ${error}`);
                console.error(`Error running test ${testFile}:`, error);
                const errorResult: TestResult = {
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

    private async runSingleTest(testFile: string): Promise<TestResult> {
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
                
                // For TypeScript test files, also check for type errors
                let hasTypeErrors = false;
                if (framework === 'vitest' && (testFile.endsWith('.ts') || testFile.endsWith('.tsx'))) {
                    // Check if there are TypeScript errors in the output
                    // Look for TypeScript error patterns in both stdout and stderr
                    const typeErrorPatterns = [
                        /error TS\d+:/i,
                        /Type error:/i,
                        /Argument of type/i,
                        /Expected \d+ arguments/i,
                        /but got \d+/i,
                        /Expected \d+ argument/i,  // singular
                        /but got \d+\./i,  // with period
                        /TypeError:/i,
                        /is not a function/i,
                        /TS2554/i,  // Specific error code for wrong number of arguments
                        /TS2345/i   // Specific error code for type mismatch
                    ];
                    
                    hasTypeErrors = typeErrorPatterns.some(pattern => 
                        pattern.test(stdout) || pattern.test(stderr)
                    );
                    
                    if (hasTypeErrors) {
                        this.outputChannel.appendLine(`[TestRunner] ⚠️ TypeScript errors detected in test output`);
                        // Log a snippet of the error for debugging
                        const errorSnippet = (stdout + stderr).substring(0, 1000);
                        this.outputChannel.appendLine(`[TestRunner] Error snippet: ${errorSnippet}`);
                    }
                }
                
                // If the command failed (non-zero exit code), it's likely a type check failure
                // For chained commands (tsc && vitest), if tsc fails, the exit code will be non-zero
                // and vitest won't run, so we should mark the test as failed
                const status = this.determineTestStatus(code || 0, stdout, stderr, hasTypeErrors);
                
                // Extract TypeScript error message for the test file specifically
                let errorMessage: string | undefined = undefined;
                if (status === 'failed' || status === 'error') {
                    if (hasTypeErrors) {
                        // Extract TypeScript errors related to the test file
                        const testFileName = path.basename(testFile);
                        const testFileErrors = (stdout + stderr)
                            .split('\n')
                            .filter(line => line.includes(testFileName) && line.includes('error TS'))
                            .join('\n');
                        
                        if (testFileErrors) {
                            errorMessage = `TypeScript type errors detected:\n${testFileErrors}`;
                        } else {
                            // Fall back to first few TypeScript errors
                            const allErrors = (stdout + stderr)
                                .split('\n')
                                .filter(line => line.includes('error TS'))
                                .slice(0, 5)
                                .join('\n');
                            errorMessage = `TypeScript type errors detected:\n${allErrors}`;
                        }
                    } else {
                        errorMessage = stderr || stdout || 'Unknown error';
                    }
                }
                
                const result: TestResult = {
                    testFile,
                    status,
                    duration,
                    errorMessage,
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

    private detectTestFramework(testFile: string): string {
        // Resolve to absolute path if relative
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const absolutePath = path.isAbsolute(testFile) 
            ? testFile 
            : workspaceFolder 
                ? path.resolve(workspaceFolder, testFile)
                : testFile;
        
        const fileName = path.basename(absolutePath).toLowerCase();
        const ext = path.extname(absolutePath).toLowerCase();
        
        // Log to output channel for visibility
        this.outputChannel.appendLine(`[TestRunner] Detecting framework for: ${testFile}`);
        this.outputChannel.appendLine(`[TestRunner] Resolved to absolute path: ${absolutePath}`);
        this.outputChannel.appendLine(`[TestRunner] File name: ${fileName}, Extension: ${ext}`);
        
        try {
            const fs = require('fs');
            if (!fs.existsSync(absolutePath)) {
                this.outputChannel.appendLine(`[TestRunner] ❌ ERROR: Test file does not exist: ${absolutePath}`);
                this.outputChannel.appendLine(`[TestRunner] Workspace folder: ${workspaceFolder}`);
                return 'unknown';
            }
            
            const content = fs.readFileSync(absolutePath, 'utf8');
            this.outputChannel.appendLine(`[TestRunner] File read successfully, length: ${content.length}`);
            this.outputChannel.appendLine(`[TestRunner] Content preview: ${content.substring(0, 200).replace(/\n/g, ' ')}`);
            
            // Framework-specific detection
            // Check for Vitest FIRST (before Jest) since Vitest also uses describe/it
            // Look for explicit vitest imports - check for various import patterns
            const hasVitestImport = content.includes('from "vitest"') || 
                                   content.includes("from 'vitest'") ||
                                   content.includes('from "vitest/') ||
                                   content.includes("from 'vitest/") ||
                                   content.includes('require("vitest"') ||
                                   content.includes("require('vitest'");
            
            this.outputChannel.appendLine(`[TestRunner] Has vitest import: ${hasVitestImport}`);
            this.outputChannel.appendLine(`[TestRunner] Content includes 'vitest': ${content.includes('vitest')}`);
            this.outputChannel.appendLine(`[TestRunner] Checking 'from "vitest"': ${content.includes('from "vitest"')}`);
            
            if (fileName.includes('vitest') || hasVitestImport || content.includes('vitest')) {
                this.outputChannel.appendLine(`[TestRunner] ✅ Detected Vitest framework for ${testFile}`);
                return 'vitest';
            } else if (fileName.includes('jest') || content.includes('jest') || (content.includes('describe(') && content.includes('it('))) {
                return 'jest';
            } else if (fileName.includes('mocha') || content.includes('mocha')) {
                return 'mocha';
            } else if (fileName.includes('pytest') || content.includes('pytest') || content.includes('def test_')) {
                return 'pytest';
            } else if (fileName.includes('junit') || content.includes('junit') || content.includes('@Test')) {
                return 'junit';
            } else if (fileName.includes('cypress') || content.includes('cypress')) {
                return 'cypress';
            } else if (fileName.includes('playwright') || content.includes('playwright')) {
                return 'playwright';
            }
            
            // Default detection based on file extension and content
            if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx') {
                if (content.includes('describe') || content.includes('it') || content.includes('test')) {
                    return 'jest'; // Default to Jest for JS/TS files
                }
            } else if (ext === '.py') {
                if (content.includes('def test_') || content.includes('pytest')) {
                    return 'pytest';
                }
            } else if (ext === '.java') {
                if (content.includes('@Test') || content.includes('junit')) {
                    return 'junit';
                }
            } else if (ext === '.cs') {
                if (content.includes('[Test]') || content.includes('NUnit')) {
                    return 'nunit';
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`[TestRunner] ❌ ERROR reading test file ${testFile}: ${error}`);
            this.outputChannel.appendLine(`[TestRunner] Error details: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                this.outputChannel.appendLine(`[TestRunner] Stack: ${error.stack}`);
            }
        }
        
        this.outputChannel.appendLine(`[TestRunner] ⚠️ Could not detect framework for ${testFile}, returning 'unknown'`);
        return 'unknown';
    }

    private getTestCommand(framework: string, testFile: string): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const workspacePath = workspaceFolder?.uri.fsPath || '';
        
        // Resolve test file to absolute path
        const absoluteTestFile = path.isAbsolute(testFile) ? testFile : path.resolve(workspacePath, testFile);
        const relativePath = path.relative(workspacePath, absoluteTestFile);
        
        // For Windows, use forward slashes in paths (works better with npx commands)
        const normalizedRelativePath = relativePath.replace(/\\/g, '/');
        
        this.outputChannel.appendLine(`[TestRunner] Generating command for framework: ${framework}`);
        this.outputChannel.appendLine(`[TestRunner] Test file: ${absoluteTestFile}`);
        this.outputChannel.appendLine(`[TestRunner] Relative path: ${normalizedRelativePath}`);
        this.outputChannel.appendLine(`[TestRunner] Workspace: ${workspacePath}`);
        
        switch (framework) {
            case 'jest':
                return `npx jest "${normalizedRelativePath}" --verbose`;
                
            case 'mocha':
                return `npx mocha "${normalizedRelativePath}"`;
                
            case 'vitest':
                // Vitest: In monorepos, vitest might be in a package's node_modules
                // Try to find the package directory for this test file
                const fs = require('fs');
                let testDir = path.dirname(absoluteTestFile);
                let packageDir = workspacePath;
                
                // Walk up from test file to find package.json
                for (let i = 0; i < 10; i++) {
                    const packageJsonPath = path.join(testDir, 'package.json');
                    if (fs.existsSync(packageJsonPath)) {
                        packageDir = testDir;
                        break;
                    }
                    const parent = path.dirname(testDir);
                    if (parent === testDir) break;
                    testDir = parent;
                }
                
                // Check for vitest in package's node_modules or workspace root
                const localVitest = path.join(packageDir, 'node_modules', '.bin', 'vitest');
                const rootVitest = path.join(workspacePath, 'node_modules', '.bin', 'vitest');
                
                let vitestCommand = 'npx vitest';
                if (fs.existsSync(localVitest)) {
                    vitestCommand = process.platform === 'win32' 
                        ? path.join(packageDir, 'node_modules', '.bin', 'vitest.cmd')
                        : localVitest;
                    this.outputChannel.appendLine(`[TestRunner] Using local vitest from: ${vitestCommand}`);
                } else if (fs.existsSync(rootVitest)) {
                    vitestCommand = process.platform === 'win32' 
                        ? path.join(workspacePath, 'node_modules', '.bin', 'vitest.cmd')
                        : rootVitest;
                    this.outputChannel.appendLine(`[TestRunner] Using root vitest from: ${vitestCommand}`);
                } else {
                    this.outputChannel.appendLine(`[TestRunner] Vitest not found locally, using npx`);
                }
                
                // Use relative path from package directory (or workspace root)
                const pathFromPackage = path.relative(packageDir, absoluteTestFile).replace(/\\/g, '/');
                
                // For TypeScript files, run type checking first to catch breaking changes
                // This ensures tests fail when function signatures change (e.g., parameter count)
                const isTypeScript = absoluteTestFile.endsWith('.ts') || absoluteTestFile.endsWith('.tsx');
                if (isTypeScript) {
                    // Check if tsc is available in the package
                    const tscPath = path.join(packageDir, 'node_modules', '.bin', 'tsc');
                    const tscCmd = process.platform === 'win32' 
                        ? path.join(packageDir, 'node_modules', '.bin', 'tsc.cmd')
                        : tscPath;
                    
                    if (fs.existsSync(tscPath) || fs.existsSync(tscCmd)) {
                        // Run type checking first, then vitest
                        // Use && to chain commands - if type check fails, vitest won't run
                        const tscCommand = process.platform === 'win32' ? tscCmd : 'npx tsc';
                        this.outputChannel.appendLine(`[TestRunner] Running TypeScript type check before test`);
                        // Run tsc from package directory to use correct tsconfig.json
                        // Use --skipLibCheck to avoid dependency type errors
                        return `cd "${packageDir}" && "${tscCommand}" --noEmit --skipLibCheck && cd "${packageDir}" && "${vitestCommand}" run "${pathFromPackage}"`;
                    } else {
                        // Fallback: just run vitest (it might have type checking enabled)
                        this.outputChannel.appendLine(`[TestRunner] TypeScript compiler not found, running vitest without type check`);
                    }
                }
                
                return `"${vitestCommand}" run "${pathFromPackage}"`;
                
            case 'pytest':
                return `python -m pytest "${relativePath}" -v`;
                
            case 'junit':
                return `mvn test -Dtest=${path.basename(testFile, '.java')}`;
                
            case 'nunit':
                return `dotnet test --filter ${path.basename(testFile, '.cs')}`;
                
            case 'cypress':
                return `npx cypress run --spec "${normalizedRelativePath}"`;
                
            case 'playwright':
                return `npx playwright test "${normalizedRelativePath}"`;
                
            default:
                // Try to run with node for JS files
                if (path.extname(testFile).toLowerCase() === '.js') {
                    return `node "${relativePath}"`;
                }
                return `echo "Unknown test framework for ${testFile}"`;
        }
    }

    private determineTestStatus(exitCode: number, stdout: string, stderr: string, hasTypeErrors: boolean = false): 'passed' | 'failed' | 'skipped' | 'error' {
        // If TypeScript errors are detected, mark as failed even if exit code is 0
        if (hasTypeErrors) {
            this.outputChannel.appendLine(`[TestRunner] TypeScript errors detected - marking test as failed`);
            return 'failed';
        }
        
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

    private logResults(results: TestResult[]): void {
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

    showOutput(): void {
        this.outputChannel.show();
    }

    clearOutput(): void {
        this.outputChannel.clear();
    }

    getTestResults(): TestResult[] {
        return this.testResults;
    }

    getLastTestResults(): TestResult[] {
        return this.testResults.slice(-10); // Last 10 test runs
    }
}
