import * as vscode from 'vscode';
import { ProfessionalImpactAnalyzer as ImpactAnalyzer } from './core/ProfessionalImpactAnalyzer';
import { SimpleImpactViewProvider } from './ui/SimpleImpactViewProvider';
import { TestRunner } from './test-runners/TestRunner';
import { FileWatcher } from './core/FileWatcher';
import { ConfigurationManager } from './core/ConfigurationManager';
import { GitAnalyzer } from './analyzers/GitAnalyzer';
import { WelcomeViewProvider } from './ui/WelcomeViewProvider';
import { KeyboardNavigationManager } from './ui/KeyboardNavigationManager';
import { InlineDecorationsManager } from './ui/InlineDecorationsManager';
import { ImpactSummaryFormatter } from './utils/ImpactSummaryFormatter';
import { ConfidenceMetricsExplainer } from './utils/ConfidenceMetricsExplainer';

/**
 * Extract breaking issues from analysis result
 * Focuses on impact analysis: what code depends on changes and could break
 */
function extractBreakingIssues(result: any): Array<{ severity: string; message: string; line: number; category: string; file?: string; recommendedFixes?: string[] }> {
    const breakingIssues: Array<{ severity: string; message: string; line: number; category: string; file?: string; recommendedFixes?: string[] }> = [];
    
    // Get fix recommendations from Contracts & Architecture metric
    let contractsMetric: any = null;
    if (result.confidenceResult) {
        const confidence = result.confidenceResult;
        for (const metric of confidence.metrics || []) {
            if (metric.name === 'Contracts & Architecture') {
                contractsMetric = metric;
                // Contracts & Architecture - Breaking changes
                if (metric.subMetrics?.breakingChanges) {
                    for (const breakingChange of metric.subMetrics.breakingChanges) {
                        breakingIssues.push({
                            severity: '⚠️ Breaking',
                            message: breakingChange || 'Breaking API change',
                            line: 0,
                            category: 'API Breaking Change',
                            file: result.filePath,
                            recommendedFixes: metric.suggestions || [
                                'Maintain backward-compatible function signatures',
                                'Add deprecated annotation with migration path',
                                'Update all call sites before removing old API',
                                'Document breaking changes in CHANGELOG',
                                'Consider version bump if breaking change is necessary'
                            ]
                        });
                    }
                }
                break;
            }
        }
    }
    
    // Impact Analysis - Code that depends on changes and could break
    
    // Downstream components that depend on changed code
    if (result.downstreamComponents && result.downstreamComponents.length > 0) {
        for (const component of result.downstreamComponents) {
            const path = require('path');
            breakingIssues.push({
                severity: '⚠️ Risk',
                message: `Depends on changed code: ${path.basename(component)}`,
                line: 0,
                category: 'Downstream Impact',
                file: component,
                recommendedFixes: [
                    `Review ${path.basename(component)} to ensure compatibility`,
                    'Run tests for dependent components',
                    'Update dependent code if API contract changed',
                    'Check for compilation/runtime errors in dependent files',
                    'Consider staging changes to avoid cascading failures'
                ]
            });
        }
    }
    
    // Test Impact - Affected tests that might fail (included in "What Will Break")
    if (result.affectedTests && result.affectedTests.length > 0) {
        for (const test of result.affectedTests) {
            const path = require('path');
            breakingIssues.push({
                severity: '🧪 Test Risk',
                message: `Test may fail: ${path.basename(test)}`,
                line: 0,
                category: 'Test Impact',
                file: test,
                recommendedFixes: [
                    `Run ${path.basename(test)} to verify it passes`,
                    'Update test expectations if behavior changed intentionally',
                    'Add test coverage for new functionality if missing',
                    'Fix test assertions if they are now incorrect',
                    'Consider adding integration tests for affected workflows'
                ]
            });
        }
    }
    
    // Changed functions/classes that other code depends on
    if (result.changedFunctions && result.changedFunctions.length > 0) {
        // Only show if there are downstream components (indicating other code depends on it)
        if (result.downstreamComponents && result.downstreamComponents.length > 0) {
            for (const func of result.changedFunctions) {
                breakingIssues.push({
                    severity: '⚠️ Breaking Change',
                    message: `Function changed: ${func} (may break callers)`,
                    line: 0,
                    category: 'Function Impact',
                    file: result.filePath,
                    recommendedFixes: [
                        `Find all call sites of ${func}() and update them`,
                        'Maintain backward compatibility by adding overloads',
                        'Add parameter defaults if possible',
                        'Update function signature documentation',
                        'Run tests for all callers to verify compatibility'
                    ]
                });
            }
        }
    }
    
    if (result.changedClasses && result.changedClasses.length > 0) {
        // Only show if there are downstream components (indicating other code depends on it)
        if (result.downstreamComponents && result.downstreamComponents.length > 0) {
            for (const cls of result.changedClasses) {
                breakingIssues.push({
                    severity: '⚠️ Breaking Change',
                    message: `Class changed: ${cls} (may break dependents)`,
                    line: 0,
                    category: 'Class Impact',
                    file: result.filePath,
                    recommendedFixes: [
                        `Find all usages of ${cls} class and verify compatibility`,
                        'Maintain backward compatibility by preserving existing methods/properties',
                        'Add deprecation warnings before removing features',
                        'Update class documentation with migration guide',
                        'Run tests for all dependent classes'
                    ]
                });
            }
        }
    }
    
    return breakingIssues;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Real-Time Impact Analyzer extension is now active!');

    try {
        // Initialize core services
        const configManager = new ConfigurationManager();
        // Baseline cache is session-only (in-memory) - starts fresh on each extension reload
        const impactAnalyzer = new ImpactAnalyzer(configManager);
        const testRunner = new TestRunner();
        const gitAnalyzer = new GitAnalyzer();

        // Initialize UI
        const viewProvider = new SimpleImpactViewProvider(impactAnalyzer, testRunner);
        vscode.window.registerTreeDataProvider('impactAnalyzerView', viewProvider);

        // Initialize Welcome Panel (Month 1 Quick Win #1)
        const welcomeViewProvider = new WelcomeViewProvider(context);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('impactAnalyzer.welcome', welcomeViewProvider)
        );

        // Initialize Inline Decorations Manager (Month 1 Quick Win #3)
        const inlineDecorationsManager = new InlineDecorationsManager(context);
        context.subscriptions.push(inlineDecorationsManager);

        // Initialize Keyboard Navigation Manager (Month 1 Quick Win #2)
        const treeView = vscode.window.createTreeView('impactAnalyzerView', {
            treeDataProvider: viewProvider
        });
        const keyboardNavigationManager = new KeyboardNavigationManager(treeView, viewProvider, context);
        context.subscriptions.push(treeView, keyboardNavigationManager);


        const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cs', '.go', '.rs'];

        // Initialize baseline when file is opened (before first save)
        // This ensures baseline is ready for first analysis after save
        const openDisposable = vscode.workspace.onDidOpenTextDocument(async (document) => {
            const fileExt = require('path').extname(document.fileName).toLowerCase();
            if (supportedExtensions.includes(fileExt) && document.uri.scheme === 'file') {
                console.log(`[Impact Analyzer] File opened: ${document.fileName} - initializing baseline`);
                try {
                    // Initialize baseline from disk (saved state at open)
                    await impactAnalyzer.initializeBaselineIfNeeded(document.fileName);
                } catch (error) {
                    console.error(`[Impact Analyzer] Failed to initialize baseline: ${error}`);
                }
            }
        });
        context.subscriptions.push(openDisposable);

        // Also initialize baseline for already-open files on extension activation
        vscode.workspace.textDocuments.forEach(async (document) => {
            const fileExt = require('path').extname(document.fileName).toLowerCase();
            if (supportedExtensions.includes(fileExt) && document.uri.scheme === 'file') {
                try {
                    await impactAnalyzer.initializeBaselineIfNeeded(document.fileName);
                } catch (error) {
                    // Silently fail for already-open files
                }
            }
        });

        // Auto-analysis on save (legacy, configurable)
        const autoAnalysisEnabled = configManager.isAutoAnalysisEnabled();
        if (autoAnalysisEnabled) {
            console.log('[Impact Analyzer] Auto-analysis on save is ENABLED');
            const saveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
                const fileExt = require('path').extname(document.fileName).toLowerCase();
                if (supportedExtensions.includes(fileExt)) {
                    console.log(`[Impact Analyzer] Auto-analyzing on save: ${document.fileName}`);
                    try {
                        // Pass document to read from buffer (includes unsaved changes)
                        const result = await impactAnalyzer.analyzeFile(document.fileName, document);
                        if (result.hasActualChanges !== false) {
                            await viewProvider.updateAnalysisResult(result);

                            // Month 1 Quick Win #4: Show formatted impact summary
                            const quickSummary = ImpactSummaryFormatter.formatQuickSummary(result);
                            const detailedSummary = ImpactSummaryFormatter.formatDetailedSummary(result);

                            // Log detailed summary to output channel
                            const outputChannel = vscode.window.createOutputChannel('Impact Analyzer');
                            outputChannel.appendLine(detailedSummary);

                            // Also update inline decorations
                            inlineDecorationsManager.updateDecorations(result);

                            const breakingIssues = extractBreakingIssues(result);
                            if (breakingIssues.length > 0) {
                                vscode.window.showWarningMessage(
                                    quickSummary,
                                    'View Details'
                                ).then(selection => {
                                    if (selection === 'View Details') {
                                        outputChannel.show();
                                        vscode.commands.executeCommand('impactAnalyzerView.focus');
                                    }
                                });
                            } else {
                                // Show info message if no issues (safe to commit)
                                vscode.window.showInformationMessage(quickSummary);
                            }
                        }
                    } catch (error) {
                        console.error('Auto-analysis on save failed:', error);
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        vscode.window.showWarningMessage(
                            `Impact Analyzer: Analysis failed for ${require('path').basename(document.fileName)}. ${errorMessage}`,
                            'View Details'
                        ).then(selection => {
                            if (selection === 'View Details') {
                                const outputChannel = vscode.window.createOutputChannel('Impact Analyzer');
                                outputChannel.appendLine(`Analysis failed for ${document.fileName}:`);
                                outputChannel.appendLine(errorMessage);
                                if (error instanceof Error && error.stack) {
                                    outputChannel.appendLine(error.stack);
                                }
                                outputChannel.show();
                            }
                        });
                    }
                }
            });
            context.subscriptions.push(saveDisposable);
        } else {
            console.log('[Impact Analyzer] Auto-analysis on save is DISABLED - analysis is manual only');
        }

        // Auto-refresh on save (opt-in, view only)
        let autoRefreshDisposable: vscode.Disposable | undefined;
        const pendingAutoRefreshTimers = new Map<string, NodeJS.Timeout>();

        const disposeAutoRefreshListener = () => {
            pendingAutoRefreshTimers.forEach(timer => clearTimeout(timer));
            pendingAutoRefreshTimers.clear();
            if (autoRefreshDisposable) {
                autoRefreshDisposable.dispose();
                autoRefreshDisposable = undefined;
            }
        };

        const runAutoRefresh = async (filePath: string, document?: vscode.TextDocument) => {
            try {
                // Try to get document if not provided
                let doc = document;
                if (!doc) {
                    const uri = vscode.Uri.file(filePath);
                    doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
                }
                const result = await impactAnalyzer.analyzeFile(filePath, doc);
                await viewProvider.updateAnalysisResult(result);
                console.log(`[Impact Analyzer] Auto-refresh completed for ${filePath}`);
            } catch (error) {
                console.error('[Impact Analyzer] Auto-refresh failed:', error);
                // Auto-refresh failures are less critical, log but don't show notification
                // to avoid spamming users during rapid edits
            }
        };

        const registerAutoRefreshListener = () => {
            disposeAutoRefreshListener();

            if (!configManager.isAutoRefreshEnabled()) {
                console.log('[Impact Analyzer] Auto-refresh on save is DISABLED');
                return;
            }

            console.log('[Impact Analyzer] Auto-refresh on save is ENABLED');
            autoRefreshDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
                const fileExt = require('path').extname(document.fileName).toLowerCase();
                if (!supportedExtensions.includes(fileExt)) {
                    return;
                }

                const delay = Math.max(0, configManager.getAutoRefreshDelay());
                const filePath = document.fileName;

                if (pendingAutoRefreshTimers.has(filePath)) {
                    clearTimeout(pendingAutoRefreshTimers.get(filePath) as NodeJS.Timeout);
                }

                const timer = setTimeout(() => {
                    pendingAutoRefreshTimers.delete(filePath);
                    // Pass document to read from buffer
                    runAutoRefresh(filePath, document);
                }, delay);

                pendingAutoRefreshTimers.set(filePath, timer);
            });

            context.subscriptions.push(autoRefreshDisposable);
        };

        registerAutoRefreshListener();

        const configurationChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
            let refreshConfig = false;
            let refreshAuto = false;
            let refreshCi = false;

            if (event.affectsConfiguration('impactAnalyzer.autoRefreshOnSave') || event.affectsConfiguration('impactAnalyzer.autoRefreshDelay')) {
                refreshConfig = true;
                refreshAuto = true;
            }

            if (refreshConfig) {
                configManager.refresh();
            }

            if (refreshAuto) {
                registerAutoRefreshListener();
            }
        });

        context.subscriptions.push(configurationChangeDisposable);

        // Register commands (manual workflow entry points)
        const commands = [
            vscode.commands.registerCommand('impactAnalyzer.openDownstreamFile', async (filePath: string, line?: number | string) => {
                const fs = require('fs');
                const path = require('path');
                console.error(`[extension] ========== openDownstreamFile CALLED ==========`);
                console.error(`[extension] Received filePath: ${filePath}`);
                console.error(`[extension] Received line (raw): ${line} (type: ${typeof line})`);
                
                if (!filePath) {
                    console.error(`[extension] ❌ No filePath provided`);
                    return;
                }

                // Resolve path
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
                const absPath = path.isAbsolute(filePath)
                    ? path.normalize(filePath)
                    : path.normalize(path.resolve(root, filePath));

                console.error(`[extension] Resolved path: ${absPath}`);
                console.error(`[extension] File exists: ${fs.existsSync(absPath)}`);

                if (!fs.existsSync(absPath)) {
                    vscode.window.showWarningMessage(`Impact Analyzer: File not found: ${absPath}`);
                    console.error(`[extension] ❌ File does not exist: ${absPath}`);
                    return;
                }

                const uri = vscode.Uri.file(absPath);

                // Normalize line: accept strings, clamp, and handle 1-based input.
                const raw = typeof line === 'string' ? parseInt(line, 10) : line;
                const requested = Number.isFinite(raw as number) ? (raw as number) : undefined;
                
                console.error(`[extension] Line normalization:`);
                console.error(`  - Raw: ${raw}`);
                console.error(`  - Requested: ${requested}`);
                console.error(`  - IsFinite: ${Number.isFinite(raw as number)}`);

                const doc = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(doc, { preview: false });

                // If line number is provided, navigate to it (assuming 1-based input from analyzer)
                if (requested !== undefined && requested > 0) {
                    // Convert from 1-based to 0-based and clamp
                    let lineIndex = Math.max(requested - 1, 0);
                    // Clamp to document length
                    lineIndex = Math.min(lineIndex, Math.max(doc.lineCount - 1, 0));
                    
                    console.error(`[extension] Navigating to line:`);
                    console.error(`  - Requested (1-based): ${requested}`);
                    console.error(`  - LineIndex (0-based): ${lineIndex}`);
                    console.error(`  - Document lineCount: ${doc.lineCount}`);

                    // Get the full line range to highlight the entire line
                    const line = doc.lineAt(lineIndex);
                    const startPos = new vscode.Position(lineIndex, 0);
                    const endPos = new vscode.Position(lineIndex, line.text.length);
                    const fullLineRange = new vscode.Range(startPos, endPos);

                    // Select the entire line to highlight it
                    editor.selection = new vscode.Selection(startPos, endPos);
                    // Reveal the line in the center of the viewport
                    editor.revealRange(fullLineRange, vscode.TextEditorRevealType.InCenter);
                    
                    console.error(`[extension] ✅ Navigated to and highlighted line ${requested} (0-based: ${lineIndex})`);
                } else {
                    console.error(`[extension] No line number provided, opening file at top`);
                }
                
                console.error(`[extension] ✅ File opened successfully: ${absPath}`);
            }),
            // Analysis commands - ONLY way to trigger analysis
            vscode.commands.registerCommand('impactAnalyzer.analyzeCurrentFile', async () => {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active editor found');
                    return;
                }

                console.log(`[Impact Analyzer] User explicitly requested analysis for: ${activeEditor.document.uri.fsPath}`);
                            try {
                                // Pass document to read from buffer (includes unsaved changes)
                                const result = await impactAnalyzer.analyzeFile(activeEditor.document.uri.fsPath, activeEditor.document);

                    // Check if no changes were detected
                    if (result.hasActualChanges === false) {
                        vscode.window.showInformationMessage('ℹ️ No code change detected - analysis skipped.');
                        await viewProvider.updateAnalysisResult(result);
                        return;
                    }

                                await viewProvider.updateAnalysisResult(result);

                    // Month 1 Quick Win #4: Show formatted impact summary
                    const outputChannel = vscode.window.createOutputChannel('Impact Analyzer');
                    const detailedSummary = ImpactSummaryFormatter.formatDetailedSummary(result);
                    const confidenceExplanation = result.confidenceResult
                        ? ConfidenceMetricsExplainer.generateExplanation(result.confidenceResult)
                        : '';

                    outputChannel.clear();
                    outputChannel.appendLine(detailedSummary);
                    if (confidenceExplanation) {
                        outputChannel.appendLine('\n' + confidenceExplanation);
                    }
                    outputChannel.show();

                    // Update inline decorations
                    inlineDecorationsManager.updateDecorations(result);

                    // Show breaking issues immediately
                    const breakingIssues = extractBreakingIssues(result);
                    if (breakingIssues.length > 0) {
                        const criticalCount = breakingIssues.filter(i => i.severity.includes('❌')).length;
                        const quickSummary = ImpactSummaryFormatter.formatQuickSummary(result);
                        const message = criticalCount > 0
                            ? `🚨 ${criticalCount} critical issue(s) will break your code! Check "What Will Break" in Impact Analyzer view.`
                            : `⚠️ ${breakingIssues.length} issue(s) detected. Check "What Will Break" in Impact Analyzer view.`;
                        vscode.window.showWarningMessage(message, 'Open Impact Analyzer').then(selection => {
                            if (selection === 'Open Impact Analyzer') {
                                vscode.commands.executeCommand('impactAnalyzerView.focus');
                            }
                        });
                    } else if (result.confidenceResult) {
                        const conf = result.confidenceResult;
                        vscode.window.showInformationMessage(
                            `${conf.statusIcon} Confidence: ${conf.total}/100 (${conf.status}) - ` +
                            `${result.changedFunctions.length} functions, ${result.changedClasses.length} classes changed.`
                        );
                    } else {
                                vscode.window.showInformationMessage(`Analysis completed! Found ${result.changedFunctions.length} functions, ${result.changedClasses.length} classes changed.`);
                    }
                            } catch (error) {
                                vscode.window.showErrorMessage(`Analysis failed: ${error}`);
                            }
            }),

            vscode.commands.registerCommand('impactAnalyzer.analyzeWorkspace', async () => {
                try {
                    vscode.window.showInformationMessage('Analyzing workspace...');
                    const results = await impactAnalyzer.analyzeWorkspace();
                    await viewProvider.updateAnalysisResults(results);
                    vscode.window.showInformationMessage(`Workspace analysis completed! Found ${results.length} files.`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Workspace analysis failed: ${error}`);
                }
            }),

            // Test execution commands
            vscode.commands.registerCommand('impactAnalyzer.runAffectedTests', async (testItems?: any[]) => {
                try {
                    // Handle both array of strings and array of objects with file property
                    let tests: string[] = [];
                    if (Array.isArray(testItems)) {
                        tests = testItems.map(item => 
                            typeof item === 'string' ? item : (item?.file || item?.testFile || '')
                        ).filter(Boolean);
                    }
                    
                    if (tests.length === 0) {
                        vscode.window.showInformationMessage('No affected tests found');
                        return;
                    }

                    // Show progress
                    const progressMessage = vscode.window.setStatusBarMessage(`Running ${tests.length} test(s)...`, 3000);
                    
                    // Show output channel
                    testRunner.showOutput();
                    
                    // Run tests
                    const results = await testRunner.runTests(tests);
                    
                    // Update view provider with test results
                    viewProvider.updateTestResults(results);
                    
                    // Clear progress
                    progressMessage.dispose();
                    
                    // Show summary
                    const passed = results.filter(r => r.status === 'passed').length;
                    const failed = results.filter(r => r.status === 'failed' || r.status === 'error').length;
                    const skipped = results.filter(r => r.status === 'skipped').length;
                    
                    if (failed > 0) {
                        vscode.window.showErrorMessage(
                            `Tests completed: ${failed} failed, ${passed} passed, ${skipped} skipped`,
                            'View Results'
                        ).then(selection => {
                            if (selection === 'View Results') {
                                testRunner.showOutput();
                            }
                        });
                    } else if (skipped > 0) {
                        vscode.window.showWarningMessage(
                            `Tests completed: ${passed} passed, ${skipped} skipped`
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            `✅ All tests passed! (${passed}/${results.length})`
                        );
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Test execution failed: ${error instanceof Error ? error.message : String(error)}`);
                    testRunner.showOutput();
                }
            }),

            vscode.commands.registerCommand('impactAnalyzer.runPreCommitTests', async () => {
                try {
                    vscode.window.showInformationMessage('Running pre-commit tests...');
                    const tests: string[] = [];
                    const results = await testRunner.runTests(tests);
                    
                    const failedTests = results.filter(r => r.status === 'failed');
                    if (failedTests.length > 0) {
                        vscode.window.showErrorMessage(`${failedTests.length} tests failed. Commit blocked.`);
                    } else {
                        vscode.window.showInformationMessage('All tests passed! Ready to commit.');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Pre-commit tests failed: ${error}`);
                }
            }),


            // Utility commands
            vscode.commands.registerCommand('impactAnalyzer.toggleAutoAnalysis', () => {
                const current = configManager.isAutoAnalysisEnabled();
                configManager.set('autoAnalysis', !current);
                configManager.refresh();
                vscode.window.showInformationMessage(`Auto-analysis ${!current ? 'enabled' : 'disabled'}`);
            }),

            vscode.commands.registerCommand('impactAnalyzer.toggleAutoRefresh', () => {
                const current = configManager.isAutoRefreshEnabled();
                configManager.set('autoRefreshOnSave', !current);
                configManager.refresh();
                registerAutoRefreshListener();
                vscode.window.showInformationMessage(`Auto-refresh on save ${!current ? 'enabled' : 'disabled'}`);
            }),

            vscode.commands.registerCommand('impactAnalyzer.clearCache', () => {
                impactAnalyzer.clearCache();
                vscode.window.showInformationMessage('Analysis cache cleared');
            }),

            vscode.commands.registerCommand('impactAnalyzer.showSettings', () => {
                vscode.commands.executeCommand('workbench.action.openSettings', 'impactAnalyzer');
            }),

            vscode.commands.registerCommand('impactAnalyzer.showImpactHistory', () => {
                viewProvider.showHistory();
            })
        ];

        // Register all commands
        context.subscriptions.push(...commands);

        // Show welcome message
        vscode.window.showInformationMessage('Real-Time Impact Analyzer is ready! Use Ctrl+Shift+I to analyze current file.');
    } catch (error) {
        console.error('Failed to activate Real-Time Impact Analyzer:', error);
        vscode.window.showErrorMessage('Failed to activate Real-Time Impact Analyzer. Check the console for details.');
    }
}

export function deactivate() {
    console.log('Real-Time Impact Analyzer extension is now deactivated');
}