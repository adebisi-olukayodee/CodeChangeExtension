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
exports.SimpleImpactViewProvider = exports.ImpactViewItem = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class ImpactViewItem extends vscode.TreeItem {
    constructor(label, type, collapsibleState) {
        super(label, collapsibleState);
        this.type = type;
    }
}
exports.ImpactViewItem = ImpactViewItem;
class SimpleImpactViewProvider {
    constructor(impactAnalyzer, testRunner) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.analysisEntries = [];
        this.testResults = new Map(); // Store test results by test file path
        this.latestEntriesByFile = new Map();
        this.impactAnalyzer = impactAnalyzer;
        this.testRunner = testRunner;
        this.outputChannel = vscode.window.createOutputChannel('Impact Analyzer Navigation');
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    /**
     * Resolves a file path to an absolute path.
     * If the path is already absolute, it's normalized and returned.
     * If relative, it's resolved relative to the workspace root.
     */
    resolveWorkspacePath(filePath) {
        if (path.isAbsolute(filePath)) {
            return path.normalize(filePath);
        }
        const folders = vscode.workspace.workspaceFolders;
        const root = folders?.[0]?.uri.fsPath ?? process.cwd();
        return path.normalize(path.resolve(root, filePath));
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            return this.getRootItems();
        }
        else if (element.type === 'recent') {
            return this.getRecentItems(element);
        }
        else if (element.type === 'actions') {
            return this.getActionItems();
        }
        else if (element.type === 'file') {
            return this.getFileItems(element);
        }
        else if (element.type === 'functions' || element.type === 'classes' ||
            element.type === 'tests' || element.type === 'downstream' ||
            element.type === 'impacted-classes' ||
            element.type === 'metrics' || element.type === 'confidence' ||
            element.type === 'confidence-metric' || element.type === 'suggestions' ||
            element.type === 'sub-metrics' || element.type === 'sub-metric-detail' ||
            element.type === 'breaking-issues' || element.type === 'breaking-issue' ||
            element.type === 'breaking-category' || element.type === 'breaking-fixes' ||
            element.type === 'fix' || element.type === 'run-tests' ||
            element.type === 'run-single-test' || element.type === 'separator' ||
            element.type === 'test-result-error' || element.type === 'test-result-stack' ||
            element.type === 'test-result-output' || element.type === 'test-result-status' ||
            element.type === 'test-result-error-line' || element.type === 'test-result-stack-line' ||
            element.type === 'test-result-output-line' || element.type === 'test-result-more' ||
            element.type === 'delta-summary' || element.type === 'delta-section' ||
            element.type === 'delta-change') {
            return this.getDetailItems(element);
        }
        return Promise.resolve([]);
    }
    async getRootItems() {
        const items = [];
        // Recent Analysis Results
        if (this.analysisEntries.length > 0) {
            const recentItem = new ImpactViewItem('Recent Analysis', 'recent', vscode.TreeItemCollapsibleState.Collapsed);
            recentItem.iconPath = new vscode.ThemeIcon('history');
            const latestEntry = this.analysisEntries[0];
            recentItem.description = `Last run ${this.formatRelativeTime(latestEntry.analyzedAt)}`;
            recentItem.tooltip = `Last analyzed at ${new Date(latestEntry.analyzedAt).toLocaleString()}`;
            items.push(recentItem);
        }
        // Quick Actions
        const actionsItem = new ImpactViewItem('Quick Actions', 'actions', vscode.TreeItemCollapsibleState.Collapsed);
        actionsItem.iconPath = new vscode.ThemeIcon('rocket');
        items.push(actionsItem);
        return items;
    }
    async getFileItems(fileElement) {
        const items = [];
        const analysisPayload = fileElement.analysisResult;
        const result = analysisPayload?.result ?? analysisPayload;
        const entry = analysisPayload?.entry;
        if (!result) {
            return items;
        }
        if (entry) {
            const timestampItem = new ImpactViewItem(`Analyzed ${this.formatRelativeTime(entry.analyzedAt)}`, 'analysis-timestamp', vscode.TreeItemCollapsibleState.None);
            timestampItem.iconPath = new vscode.ThemeIcon('clock');
            timestampItem.description = new Date(entry.analyzedAt).toLocaleString();
            items.push(timestampItem);
        }
        if (entry?.delta && this.deltaHasChanges(entry.delta)) {
            const deltaItem = new ImpactViewItem('Change Highlights', 'delta-summary', vscode.TreeItemCollapsibleState.Collapsed);
            deltaItem.iconPath = new vscode.ThemeIcon('diff');
            deltaItem.analysisResult = { delta: entry.delta, result };
            deltaItem.description = this.buildDeltaSummary(entry.delta);
            items.push(deltaItem);
        }
        // Check if no changes were detected
        if (result.hasActualChanges === false) {
            const noChangesItem = new ImpactViewItem('ℹ️ No code change detected', 'no-changes', vscode.TreeItemCollapsibleState.None);
            noChangesItem.iconPath = new vscode.ThemeIcon('info');
            noChangesItem.description = 'No changes to analyze';
            noChangesItem.tooltip = 'This file has no uncommitted changes. Make changes to the file and try again.';
            items.push(noChangesItem);
            return items;
        }
        // Show warning for JavaScript files (weaker guarantees)
        const fileExt = require('path').extname(result.filePath).toLowerCase();
        if (['.js', '.jsx'].includes(fileExt)) {
            const jsWarningItem = new ImpactViewItem('⚠️ JavaScript File - Weaker Analysis Guarantees', 'js-warning', vscode.TreeItemCollapsibleState.None);
            jsWarningItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
            jsWarningItem.description = 'TypeScript recommended for best accuracy';
            jsWarningItem.tooltip = 'JavaScript files are analyzed with weaker guarantees due to lack of type information. Breaking change detection and dependency analysis are less reliable than TypeScript. Consider using .ts/.tsx files for best results.';
            items.push(jsWarningItem);
        }
        // WHAT WILL BREAK - Show critical issues first (EXPANDED by default)
        const breakingIssues = this.extractBreakingIssues(result);
        if (breakingIssues.length > 0) {
            const breakingItem = new ImpactViewItem(`🚨 What Will Break (${breakingIssues.length})`, 'breaking-issues', vscode.TreeItemCollapsibleState.Expanded // Expanded by default to show immediately
            );
            breakingItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
            breakingItem.analysisResult = { breakingIssues, result };
            breakingItem.description = `${breakingIssues.length} critical issue(s)`;
            items.push(breakingItem);
        }
        else {
            // Show success message if no issues
            const noIssuesItem = new ImpactViewItem('✅ No Breaking Issues Detected', 'breaking-issues', vscode.TreeItemCollapsibleState.None);
            noIssuesItem.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            noIssuesItem.analysisResult = { breakingIssues: [], result };
            items.push(noIssuesItem);
        }
        // Changed Classes
        if (result.changedClasses && result.changedClasses.length > 0) {
            const classesItem = new ImpactViewItem(`Classes (${result.changedClasses.length})`, 'classes', vscode.TreeItemCollapsibleState.Collapsed);
            classesItem.analysisResult = result;
            classesItem.iconPath = new vscode.ThemeIcon('symbol-class');
            items.push(classesItem);
        }
        // Changed Functions
        if (result.changedFunctions && result.changedFunctions.length > 0) {
            const functionsItem = new ImpactViewItem(`Functions (${result.changedFunctions.length})`, 'functions', vscode.TreeItemCollapsibleState.Collapsed);
            functionsItem.analysisResult = result;
            functionsItem.iconPath = new vscode.ThemeIcon('symbol-function');
            items.push(functionsItem);
        }
        // Tests
        if (result.affectedTests && result.affectedTests.length > 0) {
            const testsItem = new ImpactViewItem(`Tests (${result.affectedTests.length})`, 'tests', vscode.TreeItemCollapsibleState.Collapsed);
            testsItem.analysisResult = result;
            testsItem.iconPath = new vscode.ThemeIcon('beaker');
            items.push(testsItem);
        }
        else {
            const noTestsItem = new ImpactViewItem('✅ No Tests Detected', 'no-impacted-tests', vscode.TreeItemCollapsibleState.None);
            noTestsItem.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            noTestsItem.description = 'No tests found to be affected by this change.';
            noTestsItem.tooltip = 'This means your changes do not affect any existing tests, or the test discovery could not find any relevant tests.';
            items.push(noTestsItem);
        }
        // Impacted Classes
        if (result.changedClasses && result.changedClasses.length > 0) {
            const impactedClassesItem = new ImpactViewItem(`Impacted Classes (${result.changedClasses.length})`, 'impacted-classes', vscode.TreeItemCollapsibleState.Collapsed);
            impactedClassesItem.analysisResult = result;
            impactedClassesItem.iconPath = new vscode.ThemeIcon('symbol-class');
            items.push(impactedClassesItem);
        }
        return items;
    }
    async getRecentItems(recentElement) {
        const items = [];
        for (const entry of this.analysisEntries) {
            const result = entry.result;
            const fileName = require('path').basename(result.filePath);
            const fileItem = new ImpactViewItem(fileName, 'file', vscode.TreeItemCollapsibleState.Collapsed);
            fileItem.filePath = result.filePath;
            fileItem.analysisResult = { result, entry };
            const breakingIssues = this.extractBreakingIssues(result);
            const hasBreakingIssues = breakingIssues.length > 0;
            fileItem.iconPath = hasBreakingIssues
                ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'))
                : new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            const summaryParts = [];
            summaryParts.push(hasBreakingIssues
                ? `${breakingIssues.length} issue${breakingIssues.length !== 1 ? 's' : ''}`
                : 'No issues');
            const changeSummary = this.buildChangeSummary(result);
            if (changeSummary) {
                summaryParts.push(changeSummary);
            }
            if (entry.delta && this.deltaHasChanges(entry.delta)) {
                summaryParts.push(`Δ ${this.buildDeltaSummary(entry.delta)}`);
            }
            summaryParts.push(`analyzed ${this.formatRelativeTime(entry.analyzedAt)}`);
            fileItem.description = summaryParts.join(' • ');
            fileItem.tooltip = this.buildFileTooltip(result, entry);
            items.push(fileItem);
        }
        return items;
    }
    async getActionItems() {
        const items = [];
        const analyzeItem = new ImpactViewItem('Analyze Current File', 'action', vscode.TreeItemCollapsibleState.None);
        analyzeItem.iconPath = new vscode.ThemeIcon('search');
        analyzeItem.command = {
            command: 'impactAnalyzer.analyzeCurrentFile',
            title: 'Analyze Current File'
        };
        items.push(analyzeItem);
        const workspaceItem = new ImpactViewItem('Analyze Workspace', 'action', vscode.TreeItemCollapsibleState.None);
        workspaceItem.iconPath = new vscode.ThemeIcon('folder');
        workspaceItem.command = {
            command: 'impactAnalyzer.analyzeWorkspace',
            title: 'Analyze Workspace'
        };
        items.push(workspaceItem);
        return items;
    }
    /**
     * Extract breaking issues from analysis result
     * Focuses on impact analysis: what code depends on changes and could break
     */
    extractBreakingIssues(result) {
        const breakingIssues = [];
        // Get fix recommendations from Contracts & Architecture metric
        let contractsMetric = null;
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
        const uniqueDownstream = Array.isArray(result.downstreamComponents)
            ? Array.from(new Set(result.downstreamComponents
                .filter((value) => typeof value === 'string')))
            : [];
        const uniqueAffectedTests = Array.isArray(result.affectedTests)
            ? Array.from(new Set(result.affectedTests
                .filter((value) => typeof value === 'string')))
            : [];
        const uniqueChangedFunctions = Array.isArray(result.changedFunctions)
            ? Array.from(new Set(result.changedFunctions
                .filter((value) => typeof value === 'string')))
            : [];
        const uniqueChangedClasses = Array.isArray(result.changedClasses)
            ? Array.from(new Set(result.changedClasses
                .filter((value) => typeof value === 'string')))
            : [];
        // Downstream components that depend on changed code
        if (uniqueDownstream.length > 0) {
            const changedFilePath = result.filePath;
            // Get line numbers from downstreamComponentsWithLines if available
            const downstreamWithLines = result.downstreamComponentsWithLines || [];
            for (const component of uniqueDownstream) {
                // Try to find line numbers from downstreamComponentsWithLines first
                let usageLine = 0;
                // Resolve component to absolute path for comparison
                const workspaceFolders = vscode.workspace.workspaceFolders;
                const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
                    ? workspaceFolders[0].uri.fsPath
                    : process.cwd();
                const componentAbsolute = path.isAbsolute(component)
                    ? path.normalize(component)
                    : path.normalize(path.resolve(workspaceRoot, component));
                const componentWithLines = downstreamWithLines.find((c) => {
                    if (!c.filePath)
                        return false;
                    // Resolve c.filePath to absolute path
                    const cAbsolute = path.isAbsolute(c.filePath)
                        ? path.normalize(c.filePath)
                        : path.normalize(path.resolve(workspaceRoot, c.filePath));
                    // Normalize both paths (remove case sensitivity for comparison)
                    const normalizedComponent = componentAbsolute.replace(/\\/g, '/').toLowerCase();
                    const normalizedC = cAbsolute.replace(/\\/g, '/').toLowerCase();
                    // Check exact match or if one ends with the other
                    return normalizedC === normalizedComponent ||
                        normalizedC.endsWith(normalizedComponent) ||
                        normalizedComponent.endsWith(normalizedC) ||
                        // Also check basename match as fallback
                        path.basename(componentAbsolute).toLowerCase() === path.basename(cAbsolute).toLowerCase();
                });
                if (componentWithLines && componentWithLines.lines && componentWithLines.lines.length > 0) {
                    // Use the first usage line (not import line) - more useful for navigation
                    usageLine = componentWithLines.lines[0];
                    console.error(`[SimpleImpactViewProvider] Found line number ${usageLine} for ${component} from downstreamComponentsWithLines`);
                }
                else {
                    // Fallback to finding import line if no usage lines found
                    usageLine = this.findImportLine(component, changedFilePath);
                    if (usageLine > 0) {
                        console.error(`[SimpleImpactViewProvider] Found import line ${usageLine} for ${component} using findImportLine`);
                    }
                }
                breakingIssues.push({
                    severity: '⚠️ Risk',
                    message: `Depends on changed code: ${require('path').basename(component)}`,
                    line: usageLine,
                    category: 'Downstream Impact',
                    file: component,
                    recommendedFixes: [
                        `Review ${require('path').basename(component)} to ensure compatibility`,
                        'Run tests for dependent components',
                        'Update dependent code if API contract changed',
                        'Check for compilation/runtime errors in dependent files',
                        'Consider staging changes to avoid cascading failures'
                    ]
                });
            }
        }
        // Test Impact - Affected tests that might fail (included in "What Will Break")
        if (uniqueAffectedTests.length > 0) {
            for (const test of uniqueAffectedTests) {
                breakingIssues.push({
                    severity: '🧪 Test Risk',
                    message: `Test may fail: ${require('path').basename(test)}`,
                    line: 0,
                    category: 'Test Impact',
                    file: test,
                    recommendedFixes: [
                        `Run ${require('path').basename(test)} to verify it passes`,
                        'Update test expectations if behavior changed intentionally',
                        'Add test coverage for new functionality if missing',
                        'Fix test assertions if they are now incorrect',
                        'Consider adding integration tests for affected workflows'
                    ]
                });
            }
        }
        // API Breaking Changes - These are about the public contract changing, 
        // NOT about whether we found downstream dependencies in this workspace.
        // A breaking change exists if the API surface became stricter/incompatible,
        // regardless of whether this workspace contains callers.
        const isHighRiskBreakingChange = result.riskLevel === 'high';
        // Always show breaking changes if API contract changed (riskLevel === 'high')
        // This is independent of whether we found downstream dependencies
        if (isHighRiskBreakingChange) {
            // Show breaking changes for changed functions (API signature changes)
            if (uniqueChangedFunctions.length > 0) {
                for (const func of uniqueChangedFunctions) {
                    breakingIssues.push({
                        severity: '🚨 Breaking Change',
                        message: `API breaking change: ${func} (signature/parameter change detected)`,
                        line: 0,
                        category: 'API Breaking Change',
                        file: result.filePath,
                        recommendedFixes: [
                            `Breaking change: ${func} signature became stricter/incompatible`,
                            'This may break existing callers (even if none found in this workspace)',
                            'Review all call sites and update them before deploying',
                            'Consider maintaining backward compatibility with overloads or defaults',
                            'Document breaking change in CHANGELOG',
                            'Consider version bump if breaking change is necessary'
                        ]
                    });
                }
            }
            // Show breaking changes for changed classes (API contract changes)
            if (uniqueChangedClasses.length > 0) {
                for (const cls of uniqueChangedClasses) {
                    breakingIssues.push({
                        severity: '🚨 Breaking Change',
                        message: `API breaking change: ${cls} (contract changed)`,
                        line: 0,
                        category: 'API Breaking Change',
                        file: result.filePath,
                        recommendedFixes: [
                            `Breaking change: ${cls} contract became stricter/incompatible`,
                            'This may break existing code (even if none found in this workspace)',
                            'Review all usages and update them before deploying',
                            'Consider maintaining backward compatibility',
                            'Document breaking change in CHANGELOG',
                            'Consider version bump if breaking change is necessary'
                        ]
                    });
                }
            }
            // Fallback: If risk is HIGH but no specific functions/classes captured, 
            // still show a breaking change warning
            if (uniqueChangedFunctions.length === 0 && uniqueChangedClasses.length === 0) {
                breakingIssues.push({
                    severity: '🚨 Breaking Change',
                    message: `API breaking change detected in ${result.filePath}`,
                    line: 0,
                    category: 'API Breaking Change',
                    file: result.filePath,
                    recommendedFixes: [
                        'Breaking API change detected (signature/contract became stricter)',
                        'This may break existing callers (even if none found in this workspace)',
                        'Review changes for backward compatibility',
                        'Update all call sites before deploying',
                        'Document breaking changes in CHANGELOG',
                        'Consider version bump if breaking change is necessary'
                    ]
                });
            }
        }
        else {
            // Non-breaking changes: Only show if there are downstream dependencies
            // These are "impact" warnings, not breaking API changes
            if (uniqueChangedFunctions.length > 0 && uniqueDownstream.length > 0) {
                for (const func of uniqueChangedFunctions) {
                    breakingIssues.push({
                        severity: '⚠️ Risk',
                        message: `Function changed: ${func} (may affect downstream code)`,
                        line: 0,
                        category: 'Function Impact',
                        file: result.filePath,
                        recommendedFixes: [
                            `Review call sites of ${func}() to ensure compatibility`,
                            'Run tests for dependent components',
                            'Check for compilation/runtime errors in dependent files'
                        ]
                    });
                }
            }
            if (uniqueChangedClasses.length > 0 && uniqueDownstream.length > 0) {
                for (const cls of uniqueChangedClasses) {
                    breakingIssues.push({
                        severity: '⚠️ Risk',
                        message: `Class changed: ${cls} (may affect dependent code)`,
                        line: 0,
                        category: 'Class Impact',
                        file: result.filePath,
                        recommendedFixes: [
                            `Review usages of ${cls} class to ensure compatibility`,
                            'Run tests for dependent components',
                            'Check for compilation/runtime errors in dependent files'
                        ]
                    });
                }
            }
        }
        const seenIssues = new Set();
        const dedupedIssues = [];
        for (const issue of breakingIssues) {
            const key = `${issue.category}|${issue.message}|${issue.file || ''}`;
            if (seenIssues.has(key)) {
                continue;
            }
            seenIssues.add(key);
            dedupedIssues.push(issue);
        }
        return dedupedIssues;
    }
    async getDetailItems(detailElement) {
        const items = [];
        const context = detailElement.analysisResult || {};
        const inferredResult = context.result
            || context.analysisResult
            || (typeof context.filePath === 'string' ? context : undefined)
            || (detailElement.filePath ? this.latestEntriesByFile.get(detailElement.filePath)?.result : undefined);
        if (!inferredResult && detailElement.type !== 'delta-summary' && detailElement.type !== 'test-result-error' && detailElement.type !== 'test-result-stack' && detailElement.type !== 'test-result-output') {
            return items;
        }
        // What Will Break - Show breaking issues
        const result = inferredResult;
        if (detailElement.type === 'breaking-issues') {
            const breakingIssues = context.breakingIssues || [];
            const filePath = context.result?.filePath || inferredResult?.filePath || '';
            if (breakingIssues.length === 0) {
                const noIssuesItem = new ImpactViewItem('✅ No breaking issues detected', 'breaking-issue', vscode.TreeItemCollapsibleState.None);
                noIssuesItem.iconPath = new vscode.ThemeIcon('check');
                items.push(noIssuesItem);
            }
            else {
                // Group by category
                const byCategory = new Map();
                for (const issue of breakingIssues) {
                    if (!byCategory.has(issue.category)) {
                        byCategory.set(issue.category, []);
                    }
                    byCategory.get(issue.category).push(issue);
                }
                // Show issues grouped by category
                for (const [category, categoryIssues] of byCategory.entries()) {
                    const categoryItem = new ImpactViewItem(`${category} (${categoryIssues.length})`, 'breaking-category', vscode.TreeItemCollapsibleState.Collapsed);
                    // Use appropriate icons based on category type (matching main tree icons)
                    if (category === 'Function Impact') {
                        categoryItem.iconPath = new vscode.ThemeIcon('symbol-function');
                    }
                    else if (category === 'Test Impact') {
                        categoryItem.iconPath = new vscode.ThemeIcon('beaker');
                    }
                    else if (category === 'Class Impact') {
                        categoryItem.iconPath = new vscode.ThemeIcon('symbol-class');
                    }
                    else if (category === 'Downstream Impact') {
                        categoryItem.iconPath = new vscode.ThemeIcon('arrow-down');
                    }
                    else {
                        categoryItem.iconPath = new vscode.ThemeIcon('warning');
                    }
                    categoryItem.analysisResult = { issues: categoryIssues, filePath, category };
                    items.push(categoryItem);
                }
            }
        }
        else if (detailElement.type === 'breaking-category') {
            // Show issues in this category
            const issues = context.issues || [];
            const filePath = context.filePath || inferredResult?.filePath || '';
            const categoryName = context.category || '';
            // For Test Impact category, add a "Run All Tests" option at the top
            if (categoryName === 'Test Impact' && issues.length > 0) {
                const testFiles = issues
                    .filter((issue) => issue.file && issue.category === 'Test Impact')
                    .map((issue) => issue.file)
                    .filter((file, index, self) => file && self.indexOf(file) === index);
                if (testFiles.length > 0) {
                    const runAllTestsItem = new ImpactViewItem(`▶️ Run All Tests (${testFiles.length})`, 'run-tests', vscode.TreeItemCollapsibleState.None);
                    runAllTestsItem.iconPath = new vscode.ThemeIcon('play');
                    runAllTestsItem.description = 'Run all affected tests';
                    runAllTestsItem.analysisResult = { testFiles, category: 'Test Impact' };
                    runAllTestsItem.command = {
                        command: 'impactAnalyzer.runAffectedTests',
                        title: 'Run All Tests',
                        arguments: [testFiles]
                    };
                    items.push(runAllTestsItem);
                    // Add separator
                    const separatorItem = new ImpactViewItem('─'.repeat(40), 'separator', vscode.TreeItemCollapsibleState.None);
                    separatorItem.description = '';
                    items.push(separatorItem);
                }
            }
            for (const issue of issues) {
                // For impact issues (no line number), show file path instead
                const label = issue.line > 0
                    ? `Line ${issue.line}: ${issue.message}`
                    : `${issue.message}${issue.file ? ` (${require('path').basename(issue.file)})` : ''}`;
                // Check if this issue has recommended fixes
                const hasFixes = issue.recommendedFixes && issue.recommendedFixes.length > 0;
                // For Test Impact issues, make them collapsible to show test results and "Run Test" option
                const isTestImpact = issue.category === 'Test Impact';
                const hasTestResult = isTestImpact && issue.file && this.testResults.has(issue.file);
                const collapsibleState = (isTestImpact && hasTestResult) || hasFixes
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : isTestImpact || hasFixes
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None;
                const issueItem = new ImpactViewItem(label, 'breaking-issue', collapsibleState);
                // Use appropriate icons based on category type
                if (issue.category === 'Test Impact') {
                    // Show test result status icon if test has been run
                    const testResult = issue.file ? this.testResults.get(issue.file) : undefined;
                    if (testResult) {
                        issueItem.iconPath = new vscode.ThemeIcon(testResult.status === 'passed' ? 'check' :
                            testResult.status === 'failed' ? 'error' :
                                testResult.status === 'skipped' ? 'circle-slash' : 'warning');
                        issueItem.description = `${testResult.status.toUpperCase()} (${testResult.duration}ms)`;
                    }
                    else {
                        issueItem.iconPath = new vscode.ThemeIcon('beaker');
                        issueItem.description = `${issue.severity} - ${issue.category}`;
                    }
                }
                else if (issue.category === 'Function Impact') {
                    issueItem.iconPath = new vscode.ThemeIcon('symbol-function');
                    issueItem.description = `${issue.severity} - ${issue.category}`;
                }
                else if (issue.category === 'Class Impact') {
                    issueItem.iconPath = new vscode.ThemeIcon('symbol-class');
                    issueItem.description = `${issue.severity} - ${issue.category}`;
                }
                else if (issue.category === 'Downstream Impact') {
                    issueItem.iconPath = new vscode.ThemeIcon('arrow-down');
                    issueItem.description = `${issue.severity} - ${issue.category}`;
                }
                else {
                    issueItem.iconPath = new vscode.ThemeIcon('error');
                    issueItem.description = `${issue.severity} - ${issue.category}`;
                }
                issueItem.analysisResult = { issue, filePath };
                // For issues with line numbers, add navigation command
                if (issue.line > 0 && (issue.file || filePath)) {
                    const targetPath = issue.file || filePath;
                    const absPath = this.resolveWorkspacePath(targetPath);
                    // Ensure line is a number
                    const lineNumber = Number(issue.line);
                    console.error(`[SimpleImpactViewProvider] Breaking issue line: ${issue.line} -> ${lineNumber} (type: ${typeof lineNumber})`);
                    // Use custom command that properly handles line numbers
                    issueItem.command = {
                        command: 'impactAnalyzer.openDownstreamFile',
                        title: 'Go to Line',
                        arguments: [absPath, lineNumber]
                    };
                }
                else if (issue.file) {
                    // For impact issues with file path, open file
                    const absPath = this.resolveWorkspacePath(issue.file);
                    // Use custom command for consistency
                    issueItem.command = {
                        command: 'impactAnalyzer.openDownstreamFile',
                        title: 'Open File',
                        arguments: [absPath]
                    };
                }
                items.push(issueItem);
            }
        }
        else if (detailElement.type === 'delta-summary') {
            const delta = context.delta;
            const deltaResult = context.result || inferredResult;
            if (!delta || !this.deltaHasChanges(delta)) {
                return items;
            }
            const deltaSections = [
                { title: 'Functions', added: delta.newFunctions, removed: delta.removedFunctions, icon: 'symbol-function', type: 'delta-functions' },
                { title: 'Classes', added: delta.newClasses, removed: delta.removedClasses, icon: 'symbol-class', type: 'delta-classes' },
                { title: 'Tests', added: delta.newTests, removed: delta.removedTests, icon: 'beaker', type: 'delta-tests' },
                { title: 'Downstream', added: delta.newDownstream, removed: delta.removedDownstream, icon: 'arrow-down', type: 'delta-downstream' }
            ];
            for (const section of deltaSections) {
                if (section.added.length === 0 && section.removed.length === 0) {
                    continue;
                }
                const sectionLabelParts = [section.title];
                if (section.added.length > 0) {
                    sectionLabelParts.push(`+${section.added.length}`);
                }
                if (section.removed.length > 0) {
                    sectionLabelParts.push(`-${section.removed.length}`);
                }
                const sectionItem = new ImpactViewItem(sectionLabelParts.join(' '), 'delta-section', vscode.TreeItemCollapsibleState.Collapsed);
                sectionItem.iconPath = new vscode.ThemeIcon(section.icon);
                sectionItem.analysisResult = {
                    added: section.added,
                    removed: section.removed,
                    result: deltaResult,
                    label: section.title
                };
                items.push(sectionItem);
            }
        }
        else if (detailElement.type === 'delta-section') {
            const added = context.added || [];
            const removed = context.removed || [];
            const label = context.label || 'Changes';
            if (added.length === 0 && removed.length === 0) {
                return items;
            }
            if (added.length > 0) {
                const addedHeader = new ImpactViewItem(`Added (${added.length})`, 'delta-change', vscode.TreeItemCollapsibleState.Collapsed);
                addedHeader.iconPath = new vscode.ThemeIcon('diff-added');
                addedHeader.analysisResult = { items: added, changeType: 'added', label };
                items.push(addedHeader);
            }
            if (removed.length > 0) {
                const removedHeader = new ImpactViewItem(`Removed (${removed.length})`, 'delta-change', vscode.TreeItemCollapsibleState.Collapsed);
                removedHeader.iconPath = new vscode.ThemeIcon('diff-removed');
                removedHeader.analysisResult = { items: removed, changeType: 'removed', label };
                items.push(removedHeader);
            }
        }
        else if (detailElement.type === 'delta-change') {
            const changeItems = context.items || [];
            const changeType = context.changeType || 'changed';
            const changeIcon = changeType === 'added' ? 'diff-added' : 'diff-removed';
            for (const item of changeItems) {
                const changeItem = new ImpactViewItem(item, 'delta-entry', vscode.TreeItemCollapsibleState.None);
                changeItem.iconPath = new vscode.ThemeIcon(changeIcon);
                items.push(changeItem);
            }
            return items;
        }
        const resultOptionalTypes = new Set([
            'test-result-error',
            'test-result-stack',
            'test-result-output',
            'test-result-error-line',
            'test-result-stack-line',
            'test-result-output-line',
            'test-result-more'
        ]);
        if (!result && !resultOptionalTypes.has(detailElement.type)) {
            return items;
        }
        const safeResult = (result || {});
        if (detailElement.type === 'breaking-issue') {
            // Show recommended fixes for this breaking issue
            const issue = context.issue;
            const filePath = context.filePath || safeResult.filePath || '';
            // For Test Impact issues, show test results if available, otherwise show "Run Test" option
            if (issue && issue.category === 'Test Impact' && issue.file) {
                const testResult = this.testResults.get(issue.file);
                if (testResult) {
                    // Show test results as subtree
                    const statusIcon = testResult.status === 'passed' ? '✅' :
                        testResult.status === 'failed' ? '❌' :
                            testResult.status === 'skipped' ? '⏭️' : '⚠️';
                    const statusItem = new ImpactViewItem(`${statusIcon} Status: ${testResult.status.toUpperCase()}`, 'test-result-status', vscode.TreeItemCollapsibleState.None);
                    statusItem.iconPath = new vscode.ThemeIcon(testResult.status === 'passed' ? 'check' :
                        testResult.status === 'failed' ? 'error' :
                            testResult.status === 'skipped' ? 'circle-slash' : 'warning');
                    statusItem.description = `${testResult.duration}ms`;
                    items.push(statusItem);
                    if (testResult.errorMessage) {
                        const errorItem = new ImpactViewItem(`Error: ${testResult.errorMessage.substring(0, 100)}${testResult.errorMessage.length > 100 ? '...' : ''}`, 'test-result-error', vscode.TreeItemCollapsibleState.Collapsed);
                        errorItem.iconPath = new vscode.ThemeIcon('error');
                        errorItem.description = 'Click to expand';
                        errorItem.analysisResult = { errorMessage: testResult.errorMessage, stackTrace: testResult.stackTrace };
                        items.push(errorItem);
                    }
                    if (testResult.stackTrace) {
                        const stackItem = new ImpactViewItem('Stack Trace', 'test-result-stack', vscode.TreeItemCollapsibleState.Collapsed);
                        stackItem.iconPath = new vscode.ThemeIcon('list');
                        stackItem.description = 'Click to expand';
                        stackItem.analysisResult = { stackTrace: testResult.stackTrace };
                        items.push(stackItem);
                    }
                    if (testResult.output) {
                        const outputItem = new ImpactViewItem('Test Output', 'test-result-output', vscode.TreeItemCollapsibleState.Collapsed);
                        outputItem.iconPath = new vscode.ThemeIcon('output');
                        outputItem.description = 'Click to expand';
                        outputItem.analysisResult = { output: testResult.output };
                        items.push(outputItem);
                    }
                    // Add separator before run test option
                    const separatorItem = new ImpactViewItem('─', 'separator', vscode.TreeItemCollapsibleState.None);
                    separatorItem.description = '';
                    items.push(separatorItem);
                }
                // Always show "Run Test" option (to re-run or run if not run yet)
                const runTestItem = new ImpactViewItem(testResult ? `🔄 Run Test Again: ${require('path').basename(issue.file)}` : `▶️ Run Test: ${require('path').basename(issue.file)}`, 'run-single-test', vscode.TreeItemCollapsibleState.None);
                runTestItem.iconPath = new vscode.ThemeIcon('play');
                runTestItem.description = 'Execute this test file';
                runTestItem.analysisResult = { testFile: issue.file };
                runTestItem.command = {
                    command: 'impactAnalyzer.runAffectedTests',
                    title: 'Run Test',
                    arguments: [[issue.file]]
                };
                items.push(runTestItem);
                // Add separator if there are also fixes
                if (issue.recommendedFixes && issue.recommendedFixes.length > 0) {
                    const separatorItem2 = new ImpactViewItem('─', 'separator', vscode.TreeItemCollapsibleState.None);
                    separatorItem2.description = '';
                    items.push(separatorItem2);
                }
            }
            if (issue && issue.recommendedFixes && issue.recommendedFixes.length > 0) {
                const fixesItem = new ImpactViewItem(`Recommended Fixes (${issue.recommendedFixes.length})`, 'breaking-fixes', vscode.TreeItemCollapsibleState.Collapsed);
                fixesItem.iconPath = new vscode.ThemeIcon('lightbulb');
                fixesItem.description = 'Click to view';
                fixesItem.analysisResult = { fixes: issue.recommendedFixes };
                items.push(fixesItem);
            }
        }
        else if (detailElement.type === 'test-result-error') {
            // Show full error message
            const errorMessage = detailElement.analysisResult.errorMessage || '';
            const errorLines = errorMessage.split('\n').filter((line) => line.trim().length > 0);
            for (const line of errorLines) {
                const errorLineItem = new ImpactViewItem(line.substring(0, 200), 'test-result-error-line', vscode.TreeItemCollapsibleState.None);
                errorLineItem.iconPath = new vscode.ThemeIcon('circle-small');
                items.push(errorLineItem);
            }
        }
        else if (detailElement.type === 'test-result-stack') {
            // Show stack trace
            const stackTrace = detailElement.analysisResult.stackTrace || '';
            const stackLines = stackTrace.split('\n').filter((line) => line.trim().length > 0);
            for (const line of stackLines) {
                const stackLineItem = new ImpactViewItem(line.substring(0, 200), 'test-result-stack-line', vscode.TreeItemCollapsibleState.None);
                stackLineItem.iconPath = new vscode.ThemeIcon('circle-small');
                items.push(stackLineItem);
            }
        }
        else if (detailElement.type === 'test-result-output') {
            // Show test output
            const output = detailElement.analysisResult.output || '';
            const outputLines = output.split('\n').filter((line) => line.trim().length > 0);
            // Limit to first 50 lines to avoid overwhelming the UI
            const displayLines = outputLines.slice(0, 50);
            for (const line of displayLines) {
                const outputLineItem = new ImpactViewItem(line.substring(0, 200), 'test-result-output-line', vscode.TreeItemCollapsibleState.None);
                outputLineItem.iconPath = new vscode.ThemeIcon('circle-small');
                items.push(outputLineItem);
            }
            if (outputLines.length > 50) {
                const moreItem = new ImpactViewItem(`... and ${outputLines.length - 50} more lines (see output channel)`, 'test-result-more', vscode.TreeItemCollapsibleState.None);
                moreItem.iconPath = new vscode.ThemeIcon('info');
                items.push(moreItem);
            }
        }
        else if (detailElement.type === 'breaking-fixes') {
            // Show individual fix recommendations
            const fixes = context.fixes || [];
            for (let i = 0; i < fixes.length; i++) {
                const fixItem = new ImpactViewItem(`${i + 1}. ${fixes[i]}`, 'fix', vscode.TreeItemCollapsibleState.None);
                fixItem.iconPath = new vscode.ThemeIcon('check');
                fixItem.description = 'Recommended fix';
                items.push(fixItem);
            }
        }
        else if (detailElement.type === 'functions') {
            for (const func of safeResult.changedFunctions || []) {
                const funcItem = new ImpactViewItem(func, 'function', vscode.TreeItemCollapsibleState.None);
                funcItem.iconPath = new vscode.ThemeIcon('symbol-function');
                items.push(funcItem);
            }
        }
        else if (detailElement.type === 'classes') {
            for (const cls of safeResult.changedClasses || []) {
                const classItem = new ImpactViewItem(cls, 'class', vscode.TreeItemCollapsibleState.None);
                classItem.iconPath = new vscode.ThemeIcon('symbol-class');
                items.push(classItem);
            }
        }
        else if (detailElement.type === 'impacted-classes') {
            for (const cls of safeResult.changedClasses || []) {
                const classItem = new ImpactViewItem(cls, 'impacted-class', vscode.TreeItemCollapsibleState.None);
                classItem.iconPath = new vscode.ThemeIcon('symbol-class');
                items.push(classItem);
            }
        }
        else if (detailElement.type === 'tests') {
            const affectedTests = safeResult.affectedTests || [];
            if (affectedTests.length === 0) {
                const noTestsItem = new ImpactViewItem('No impacted tests detected', 'no-tests', vscode.TreeItemCollapsibleState.None);
                noTestsItem.iconPath = new vscode.ThemeIcon('info');
                noTestsItem.description = 'No tests found that import or reference the changed code';
                noTestsItem.tooltip = 'The analysis did not find any test files that import or reference the changed code in this workspace.';
                items.push(noTestsItem);
            }
            else {
                for (const test of affectedTests) {
                    const testItem = new ImpactViewItem(require('path').basename(test), 'test', vscode.TreeItemCollapsibleState.None);
                    testItem.iconPath = new vscode.ThemeIcon('beaker');
                    testItem.description = test;
                    items.push(testItem);
                }
            }
        }
        else if (detailElement.type === 'downstream') {
            // Get workspace root to resolve relative paths
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            // Log immediately to verify this code path is executing
            console.error(`[SimpleImpactViewProvider] ========== DOWNSTREAM TYPE DETECTED ==========`);
            console.error(`[SimpleImpactViewProvider] safeResult:`, safeResult);
            console.error(`[SimpleImpactViewProvider] safeResult.downstreamComponents:`, safeResult.downstreamComponents);
            this.outputChannel.clear();
            this.outputChannel.appendLine(`\n[SimpleImpactViewProvider] ========== Processing downstream components ==========`);
            this.outputChannel.appendLine(`[SimpleImpactViewProvider] Result file: ${safeResult.filePath}`);
            this.outputChannel.appendLine(`[SimpleImpactViewProvider] Downstream components count: ${safeResult.downstreamComponents?.length || 0}`);
            this.outputChannel.appendLine(`[SimpleImpactViewProvider] Downstream components: ${JSON.stringify(safeResult.downstreamComponents || [], null, 2)}`);
            this.outputChannel.show();
            console.error(`[SimpleImpactViewProvider] Processing downstream components: ${safeResult.downstreamComponents?.length || 0}`);
            // Try to determine workspace root from result.filePath if available
            let workspaceRoot = '';
            if (safeResult.filePath) {
                const resultPath = path.dirname(safeResult.filePath);
                let currentDir = resultPath;
                for (let i = 0; i < 10; i++) {
                    const parentDir = path.dirname(currentDir);
                    if (parentDir === currentDir)
                        break; // Reached root
                    const hasPackageJson = fs.existsSync(path.join(parentDir, 'package.json'));
                    const hasApps = fs.existsSync(path.join(parentDir, 'apps'));
                    const hasPackages = fs.existsSync(path.join(parentDir, 'packages'));
                    if (hasPackageJson && (hasApps || hasPackages)) {
                        workspaceRoot = parentDir;
                        this.outputChannel.appendLine(`[SimpleImpactViewProvider] ✅ Detected workspace root: ${workspaceRoot}`);
                        break;
                    }
                    currentDir = parentDir;
                }
            }
            const defaultWorkspacePath = workspaceRoot || workspaceFolders[0]?.uri.fsPath || '';
            this.outputChannel.appendLine(`[SimpleImpactViewProvider] Using workspace root: ${defaultWorkspacePath}`);
            const downstreamComponents = safeResult.downstreamComponents || [];
            if (downstreamComponents.length === 0) {
                const noDownstreamItem = new ImpactViewItem('No downstream impact found in this workspace', 'no-downstream', vscode.TreeItemCollapsibleState.None);
                noDownstreamItem.iconPath = new vscode.ThemeIcon('info');
                noDownstreamItem.description = 'No files found that import or use the changed code';
                noDownstreamItem.tooltip = 'The analysis did not find any files in this workspace that import or reference the changed code. This does not mean the change is safe - external consumers may still be affected.';
                items.push(noDownstreamItem);
                return items;
            }
            for (const component of downstreamComponents) {
                this.outputChannel.appendLine(`\n[SimpleImpactViewProvider] ========== Processing component: ${component} ==========`);
                console.error(`[SimpleImpactViewProvider] Processing component: ${component}`);
                // Normalize component path separators first (handle Windows backslashes)
                const normalizedComponent = component.replace(/\\/g, '/');
                let absolutePath;
                if (path.isAbsolute(component)) {
                    absolutePath = path.normalize(component);
                }
                else {
                    // Try resolving relative to detected workspace root first
                    if (workspaceRoot) {
                        absolutePath = path.resolve(workspaceRoot, normalizedComponent);
                        if (!fs.existsSync(absolutePath)) {
                            // Try workspace folders
                            for (const folder of workspaceFolders) {
                                const candidatePath = path.resolve(folder.uri.fsPath, normalizedComponent);
                                if (fs.existsSync(candidatePath)) {
                                    absolutePath = candidatePath;
                                    break;
                                }
                            }
                        }
                    }
                    else {
                        absolutePath = path.resolve(defaultWorkspacePath, normalizedComponent);
                        for (const folder of workspaceFolders) {
                            const candidatePath = path.resolve(folder.uri.fsPath, normalizedComponent);
                            if (fs.existsSync(candidatePath)) {
                                absolutePath = candidatePath;
                                break;
                            }
                        }
                    }
                }
                absolutePath = path.normalize(absolutePath);
                // Find line numbers for this component if available
                const componentWithLines = safeResult.downstreamComponentsWithLines?.find((c) => {
                    let cAbsolute = c.filePath;
                    if (!path.isAbsolute(cAbsolute)) {
                        cAbsolute = path.resolve(defaultWorkspacePath, cAbsolute);
                    }
                    const normalizedAbsolute = absolutePath.replace(/\\/g, '/').toLowerCase();
                    const normalizedC = cAbsolute.replace(/\\/g, '/').toLowerCase();
                    return normalizedC === normalizedAbsolute || c.filePath === component;
                });
                const lineNumbers = componentWithLines?.lines || [];
                // Ensure firstLine is a number, not undefined
                const firstLine = lineNumbers.length > 0 ? Number(lineNumbers[0]) : undefined;
                // Log for debugging
                this.outputChannel.appendLine(`\n[SimpleImpactViewProvider] Resolving component: ${component}`);
                this.outputChannel.appendLine(`  - Normalized: ${normalizedComponent}`);
                this.outputChannel.appendLine(`  - Workspace root: ${defaultWorkspacePath}`);
                this.outputChannel.appendLine(`  - Resolved to: ${absolutePath}`);
                const fileExists = fs.existsSync(absolutePath);
                this.outputChannel.appendLine(`  - File exists: ${fileExists}`);
                if (firstLine) {
                    this.outputChannel.appendLine(`  - Line number: ${firstLine}`);
                }
                // Verify the file exists, if not try alternative path resolutions
                if (!fileExists) {
                    this.outputChannel.appendLine(`  - ❌ File not found, trying alternative resolutions...`);
                    const altPath1 = absolutePath.replace(/\//g, '\\');
                    const altPath2 = absolutePath.replace(/\\/g, '/');
                    if (fs.existsSync(altPath1)) {
                        absolutePath = altPath1;
                        this.outputChannel.appendLine(`  - ✅ Found with backslashes: ${absolutePath}`);
                    }
                    else if (fs.existsSync(altPath2)) {
                        absolutePath = altPath2;
                        this.outputChannel.appendLine(`  - ✅ Found with forward slashes: ${absolutePath}`);
                    }
                    else {
                        const resultDir = path.dirname(safeResult.filePath);
                        const altPath3 = path.resolve(resultDir, normalizedComponent);
                        if (fs.existsSync(altPath3)) {
                            absolutePath = altPath3;
                            this.outputChannel.appendLine(`  - ✅ Found from result dir: ${absolutePath}`);
                        }
                        else {
                            for (const folder of workspaceFolders) {
                                const candidatePath = path.resolve(folder.uri.fsPath, normalizedComponent);
                                if (fs.existsSync(candidatePath)) {
                                    absolutePath = candidatePath;
                                    this.outputChannel.appendLine(`  - ✅ Found from workspace folder: ${absolutePath}`);
                                    break;
                                }
                            }
                        }
                    }
                }
                // Final check before creating command
                const finalPath = path.normalize(absolutePath);
                const finalExists = fs.existsSync(finalPath);
                this.outputChannel.appendLine(`[SimpleImpactViewProvider] Final path check: ${finalPath}`);
                this.outputChannel.appendLine(`[SimpleImpactViewProvider] Final path exists: ${finalExists}`);
                console.error(`[SimpleImpactViewProvider] Final path: ${finalPath}, exists: ${finalExists}`);
                if (!finalExists) {
                    this.outputChannel.appendLine(`[SimpleImpactViewProvider] ❌ SKIPPING: File does not exist at ${finalPath}`);
                    this.outputChannel.show();
                    // Still add the item but with a warning
                    const errorItem = new ImpactViewItem(path.basename(finalPath) + ' (FILE NOT FOUND)', 'component', vscode.TreeItemCollapsibleState.None);
                    errorItem.description = `File not found: ${finalPath}`;
                    errorItem.iconPath = new vscode.ThemeIcon('warning');
                    items.push(errorItem);
                    continue;
                }
                const componentItem = new ImpactViewItem(path.basename(finalPath) + (firstLine ? ` (line ${firstLine})` : ''), 'component', vscode.TreeItemCollapsibleState.None);
                // Create URI and verify it's valid
                let fileUri;
                try {
                    fileUri = vscode.Uri.file(finalPath);
                    this.outputChannel.appendLine(`[SimpleImpactViewProvider] Created URI: ${fileUri.fsPath}`);
                    this.outputChannel.appendLine(`[SimpleImpactViewProvider] URI scheme: ${fileUri.scheme}, path: ${fileUri.path}`);
                    console.error(`[SimpleImpactViewProvider] Created URI: ${fileUri.fsPath}`);
                    console.error(`[SimpleImpactViewProvider] URI toString: ${fileUri.toString()}`);
                    // Double-check file exists using the URI path
                    const uriPathExists = fs.existsSync(fileUri.fsPath);
                    this.outputChannel.appendLine(`[SimpleImpactViewProvider] File exists at URI path: ${uriPathExists}`);
                    console.error(`[SimpleImpactViewProvider] File exists at URI path: ${uriPathExists}`);
                    if (!uriPathExists) {
                        this.outputChannel.appendLine(`[SimpleImpactViewProvider] ❌ WARNING: File does not exist at URI path: ${fileUri.fsPath}`);
                        console.error(`[SimpleImpactViewProvider] ❌ WARNING: File does not exist at URI path: ${fileUri.fsPath}`);
                        // Try to find the actual file
                        const stats = fs.statSync(finalPath);
                        this.outputChannel.appendLine(`[SimpleImpactViewProvider] But file exists at finalPath: ${finalPath}, isFile: ${stats.isFile()}`);
                    }
                }
                catch (error) {
                    this.outputChannel.appendLine(`[SimpleImpactViewProvider] ❌ ERROR creating URI: ${error}`);
                    console.error(`[SimpleImpactViewProvider] ERROR creating URI:`, error);
                    continue;
                }
                // Use a custom command that will log the exact path being opened
                const commandId = `impactAnalyzer.openDownstreamFile`;
                // Verify command exists before using it
                const commands = await vscode.commands.getCommands();
                const commandExists = commands.includes(commandId);
                this.outputChannel.appendLine(`[SimpleImpactViewProvider] Command exists: ${commandExists}`);
                console.error(`[SimpleImpactViewProvider] Command '${commandId}' exists: ${commandExists}`);
                if (!commandExists) {
                    this.outputChannel.appendLine(`[SimpleImpactViewProvider] ❌ WARNING: Command ${commandId} not found! Available commands: ${commands.filter(c => c.includes('impactAnalyzer')).join(', ')}`);
                    console.error(`[SimpleImpactViewProvider] ❌ WARNING: Command ${commandId} not found!`);
                }
                componentItem.command = {
                    command: commandId,
                    title: 'Open File',
                    arguments: [finalPath, firstLine]
                };
                this.outputChannel.appendLine(`[SimpleImpactViewProvider] ✅ Command set: ${commandId}`);
                this.outputChannel.appendLine(`[SimpleImpactViewProvider]   - Path: ${finalPath}`);
                this.outputChannel.appendLine(`[SimpleImpactViewProvider]   - Line: ${firstLine || 'none'} (type: ${typeof firstLine}, isNumber: ${typeof firstLine === 'number'})`);
                this.outputChannel.appendLine(`[SimpleImpactViewProvider]   - File exists: ${fs.existsSync(finalPath)}`);
                this.outputChannel.appendLine(`[SimpleImpactViewProvider]   - Command args: [${finalPath}, ${firstLine || 'undefined'}]`);
                console.error(`[SimpleImpactViewProvider] ✅ Command set: ${commandId} with path: ${finalPath}, line: ${firstLine} (type: ${typeof firstLine})`);
                console.error(`[SimpleImpactViewProvider] Command object:`, JSON.stringify(componentItem.command, null, 2));
                componentItem.filePath = finalPath;
                componentItem.iconPath = new vscode.ThemeIcon('arrow-down');
                componentItem.description = component;
                this.outputChannel.appendLine(`[SimpleImpactViewProvider] ✅ Created component item for: ${finalPath}${firstLine ? ` (line ${firstLine})` : ''}`);
                console.error(`[SimpleImpactViewProvider] ✅ Created component item for: ${finalPath}`);
                items.push(componentItem);
            }
        }
        else if (detailElement.type === 'confidence') {
            // Display all 6 confidence metrics
            const confidenceResult = safeResult.confidenceResult;
            if (!confidenceResult) {
                return items;
            }
            for (const metric of confidenceResult.metrics) {
                const metricItem = new ImpactViewItem(`${metric.statusIcon} ${metric.name}: ${metric.score}/100`, 'confidence-metric', metric.weight > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
                metricItem.analysisResult = { metric, confidenceResult, filePath: safeResult.filePath };
                metricItem.iconPath = new vscode.ThemeIcon('circle-outline');
                metricItem.description = `Weight: ${(metric.weight * 100).toFixed(0)}%`;
                metricItem.tooltip = metric.summary;
                // Add context value for sorting/grouping
                metricItem.contextValue = `confidence-metric-${metric.name.toLowerCase().replace(/\s+/g, '-')}`;
                items.push(metricItem);
            }
        }
        else if (detailElement.type === 'confidence-metric') {
            // Show sub-metrics and suggestions for each metric
            const metric = detailElement.analysisResult.metric;
            const filePath = detailElement.analysisResult.filePath || safeResult.filePath || '';
            // Summary
            const summaryItem = new ImpactViewItem(`Summary: ${metric.summary}`, 'metric-detail', vscode.TreeItemCollapsibleState.None);
            summaryItem.iconPath = new vscode.ThemeIcon('info');
            items.push(summaryItem);
            // Issues with line numbers (for Code Correctness sub-metrics)
            if (metric.subMetrics) {
                // Check if this is Code Correctness metric with sub-metrics
                const subMetricKeys = Object.keys(metric.subMetrics);
                const hasLineNumbers = subMetricKeys.some(key => {
                    const subValue = metric.subMetrics[key];
                    return subValue?.issues || subValue?.lineNumbers;
                });
                if (hasLineNumbers && metric.name === 'Code Correctness') {
                    // Show sub-metrics with issues
                    for (const [subKey, subValue] of Object.entries(metric.subMetrics)) {
                        const subMetric = subValue;
                        if (subMetric && (subMetric.issues || subMetric.lineNumbers)) {
                            const subMetricItem = new ImpactViewItem(`${subKey}: ${subMetric.score}/100`, 'sub-metric-detail', (subMetric.issues && subMetric.issues.length > 0)
                                ? vscode.TreeItemCollapsibleState.Collapsed
                                : vscode.TreeItemCollapsibleState.None);
                            subMetricItem.analysisResult = {
                                subMetric: subMetric,
                                subMetricName: subKey,
                                filePath: filePath
                            };
                            subMetricItem.iconPath = new vscode.ThemeIcon('circle-outline');
                            subMetricItem.description = `Weight: ${((subMetric.weight || 0) * 100).toFixed(0)}%`;
                            if (subMetric.issues && subMetric.issues.length > 0) {
                                subMetricItem.description += ` | ${subMetric.issues.length} issue(s)`;
                            }
                            items.push(subMetricItem);
                        }
                    }
                }
                else {
                    // Generic sub-metrics display
                    const subMetricsItem = new ImpactViewItem('Details', 'sub-metrics', vscode.TreeItemCollapsibleState.Collapsed);
                    subMetricsItem.iconPath = new vscode.ThemeIcon('list-unordered');
                    subMetricsItem.analysisResult = { subMetrics: metric.subMetrics };
                    items.push(subMetricsItem);
                }
            }
            // Suggestions
            if (metric.suggestions && metric.suggestions.length > 0) {
                const suggestionsItem = new ImpactViewItem(`Suggestions (${metric.suggestions.length})`, 'suggestions', vscode.TreeItemCollapsibleState.Collapsed);
                suggestionsItem.iconPath = new vscode.ThemeIcon('lightbulb');
                suggestionsItem.analysisResult = { suggestions: metric.suggestions };
                items.push(suggestionsItem);
            }
        }
        else if (detailElement.type === 'sub-metric-detail') {
            // Show issues with line numbers for Code Correctness sub-metrics
            const subMetric = detailElement.analysisResult.subMetric;
            const subMetricName = detailElement.analysisResult.subMetricName;
            const filePath = detailElement.analysisResult.filePath;
            if (subMetric.issues && Array.isArray(subMetric.issues)) {
                for (const issue of subMetric.issues) {
                    if (typeof issue === 'object' && issue.message && issue.line) {
                        const issueItem = new ImpactViewItem(`Line ${issue.line}: ${issue.message}`, 'issue', vscode.TreeItemCollapsibleState.None);
                        issueItem.iconPath = new vscode.ThemeIcon('warning');
                        issueItem.description = `Line ${issue.line}`;
                        const absPath = this.resolveWorkspacePath(filePath);
                        // Ensure line is a number
                        const lineNumber = Number(issue.line);
                        // Use custom command that properly handles line numbers
                        issueItem.command = {
                            command: 'impactAnalyzer.openDownstreamFile',
                            title: 'Go to Line',
                            arguments: [absPath, lineNumber]
                        };
                        items.push(issueItem);
                    }
                    else if (typeof issue === 'string') {
                        // Fallback for string issues
                        const issueItem = new ImpactViewItem(issue, 'issue', vscode.TreeItemCollapsibleState.None);
                        issueItem.iconPath = new vscode.ThemeIcon('warning');
                        items.push(issueItem);
                    }
                }
            }
            // Show line numbers if available but no issues
            if ((!subMetric.issues || subMetric.issues.length === 0) && subMetric.lineNumbers) {
                const lineNumbersItem = new ImpactViewItem(`Affected lines: ${subMetric.lineNumbers.join(', ')}`, 'metric-detail', vscode.TreeItemCollapsibleState.None);
                lineNumbersItem.iconPath = new vscode.ThemeIcon('list-unordered');
                items.push(lineNumbersItem);
            }
        }
        else if (detailElement.type === 'suggestions') {
            const suggestions = detailElement.analysisResult.suggestions;
            for (let i = 0; i < suggestions.length; i++) {
                const suggestionItem = new ImpactViewItem(`${i + 1}. ${suggestions[i]}`, 'suggestion', vscode.TreeItemCollapsibleState.None);
                suggestionItem.iconPath = new vscode.ThemeIcon('lightbulb');
                items.push(suggestionItem);
            }
        }
        else if (detailElement.type === 'sub-metrics') {
            const subMetrics = detailElement.analysisResult.subMetrics;
            for (const [key, value] of Object.entries(subMetrics)) {
                const subMetricItem = new ImpactViewItem(`${key}: ${Array.isArray(value) ? value.length : value}`, 'sub-metric', vscode.TreeItemCollapsibleState.None);
                subMetricItem.iconPath = new vscode.ThemeIcon('circle-small');
                subMetricItem.description = typeof value === 'object' ? JSON.stringify(value).substring(0, 50) : String(value);
                items.push(subMetricItem);
            }
        }
        else if (detailElement.type === 'metrics') {
            // Legacy metrics display
            const confidenceItem = new ImpactViewItem(`Confidence: ${Math.round(safeResult.confidence * 100)}%`, 'metric', vscode.TreeItemCollapsibleState.None);
            confidenceItem.iconPath = new vscode.ThemeIcon('graph');
            items.push(confidenceItem);
            const timeItem = new ImpactViewItem(`Estimated Test Time: ${safeResult.estimatedTestTime}s`, 'metric', vscode.TreeItemCollapsibleState.None);
            timeItem.iconPath = new vscode.ThemeIcon('clock');
            items.push(timeItem);
            const riskItem = new ImpactViewItem(`Risk Level: ${safeResult.riskLevel}`, 'metric', vscode.TreeItemCollapsibleState.None);
            riskItem.iconPath = new vscode.ThemeIcon('warning');
            items.push(riskItem);
        }
        return items;
    }
    async updateAnalysisResult(result) {
        const previousEntry = this.latestEntriesByFile.get(result.filePath);
        const delta = this.computeDelta(previousEntry?.result, result);
        const entry = {
            result,
            analyzedAt: Date.now(),
            delta
        };
        this.analysisEntries = this.analysisEntries.filter(existing => existing.result.filePath !== result.filePath);
        this.analysisEntries.unshift(entry);
        if (this.analysisEntries.length > 10) {
            this.analysisEntries = this.analysisEntries.slice(0, 10);
        }
        this.latestEntriesByFile.set(result.filePath, entry);
        this.refresh();
    }
    async updateAnalysisResults(results) {
        if (!Array.isArray(results) || results.length === 0) {
            return;
        }
        const newEntries = [];
        const seenFiles = new Set();
        for (const result of results) {
            const previousEntry = this.latestEntriesByFile.get(result.filePath);
            const delta = this.computeDelta(previousEntry?.result, result);
            const entry = {
                result,
                analyzedAt: Date.now(),
                delta
            };
            newEntries.push(entry);
            this.latestEntriesByFile.set(result.filePath, entry);
            seenFiles.add(result.filePath);
        }
        const remainingEntries = this.analysisEntries.filter(entry => !seenFiles.has(entry.result.filePath));
        this.analysisEntries = [...newEntries, ...remainingEntries].slice(0, 10);
        this.refresh();
    }
    getAffectedFiles() {
        const affectedFiles = [];
        for (const entry of this.analysisEntries) {
            const result = entry.result;
            if (result.affectedTests) {
                affectedFiles.push(...result.affectedTests);
            }
        }
        return [...new Set(affectedFiles)];
    }
    showHistory() {
        vscode.window.showInformationMessage(`Analysis History: ${this.analysisEntries.length} recent analyses`);
    }
    formatRelativeTime(timestamp) {
        const diffMs = Date.now() - timestamp;
        const absSeconds = Math.round(Math.abs(diffMs) / 1000);
        if (absSeconds < 60) {
            return `${absSeconds}s ago`;
        }
        const absMinutes = Math.round(absSeconds / 60);
        if (absMinutes < 60) {
            return `${absMinutes}m ago`;
        }
        const absHours = Math.round(absMinutes / 60);
        if (absHours < 24) {
            return `${absHours}h ago`;
        }
        const absDays = Math.round(absHours / 24);
        return `${absDays}d ago`;
    }
    computeDelta(previous, current) {
        if (!previous) {
            return undefined;
        }
        const functionDelta = this.computeArrayDelta(previous.changedFunctions || [], current.changedFunctions || []);
        const classDelta = this.computeArrayDelta(previous.changedClasses || [], current.changedClasses || []);
        const testDelta = this.computeArrayDelta(previous.affectedTests || [], current.affectedTests || []);
        const downstreamDelta = this.computeArrayDelta(previous.downstreamComponents || [], current.downstreamComponents || []);
        if (functionDelta.added.length === 0 && functionDelta.removed.length === 0 &&
            classDelta.added.length === 0 && classDelta.removed.length === 0 &&
            testDelta.added.length === 0 && testDelta.removed.length === 0 &&
            downstreamDelta.added.length === 0 && downstreamDelta.removed.length === 0) {
            return undefined;
        }
        return {
            newFunctions: functionDelta.added,
            removedFunctions: functionDelta.removed,
            newClasses: classDelta.added,
            removedClasses: classDelta.removed,
            newTests: testDelta.added,
            removedTests: testDelta.removed,
            newDownstream: downstreamDelta.added,
            removedDownstream: downstreamDelta.removed
        };
    }
    computeArrayDelta(previous, current) {
        const previousSet = new Set(previous.map(item => item.trim()));
        const currentSet = new Set(current.map(item => item.trim()));
        const added = Array.from(currentSet).filter(item => !previousSet.has(item));
        const removed = Array.from(previousSet).filter(item => !currentSet.has(item));
        return { added, removed };
    }
    deltaHasChanges(delta) {
        return (delta.newFunctions.length > 0 ||
            delta.removedFunctions.length > 0 ||
            delta.newClasses.length > 0 ||
            delta.removedClasses.length > 0 ||
            delta.newTests.length > 0 ||
            delta.removedTests.length > 0 ||
            delta.newDownstream.length > 0 ||
            delta.removedDownstream.length > 0);
    }
    buildDeltaSummary(delta) {
        const parts = [];
        const append = (label, added, removed) => {
            if (added === 0 && removed === 0) {
                return;
            }
            const tokens = [];
            if (added > 0) {
                tokens.push(`+${added}`);
            }
            if (removed > 0) {
                tokens.push(`-${removed}`);
            }
            parts.push(`${label} ${tokens.join('/')}`);
        };
        append('fn', delta.newFunctions.length, delta.removedFunctions.length);
        append('cls', delta.newClasses.length, delta.removedClasses.length);
        append('tests', delta.newTests.length, delta.removedTests.length);
        append('deps', delta.newDownstream.length, delta.removedDownstream.length);
        return parts.join(', ');
    }
    buildChangeSummary(result) {
        const parts = [];
        if (result.changedFunctions && result.changedFunctions.length > 0) {
            parts.push(`${result.changedFunctions.length} function${result.changedFunctions.length !== 1 ? 's' : ''}`);
        }
        if (result.changedClasses && result.changedClasses.length > 0) {
            parts.push(`${result.changedClasses.length} class${result.changedClasses.length !== 1 ? 'es' : ''}`);
        }
        if (result.affectedTests && result.affectedTests.length > 0) {
            parts.push(`${result.affectedTests.length} test${result.affectedTests.length !== 1 ? 's' : ''}`);
        }
        if (result.downstreamComponents && result.downstreamComponents.length > 0) {
            parts.push(`${result.downstreamComponents.length} downstream`);
        }
        return parts.join(', ');
    }
    buildFileTooltip(result, entry) {
        const lines = [];
        lines.push(result.filePath);
        const changeSummary = this.buildChangeSummary(result);
        if (changeSummary) {
            lines.push(`Changes: ${changeSummary}`);
        }
        if (result.confidenceResult) {
            lines.push(`Confidence: ${result.confidenceResult.statusIcon} ${result.confidenceResult.total}/100 (${result.confidenceResult.status})`);
        }
        if (entry.delta && this.deltaHasChanges(entry.delta)) {
            lines.push(`Δ ${this.buildDeltaSummary(entry.delta)}`);
        }
        lines.push(`Last analyzed: ${new Date(entry.analyzedAt).toLocaleString()}`);
        return lines.join('\n');
    }
    /**
     * Update test results for a test file
     */
    updateTestResults(testResults) {
        for (const result of testResults) {
            this.testResults.set(result.testFile, result);
        }
        this.refresh();
    }
    /**
     * Find the line number of the import statement in a downstream file that imports from the changed file
     * Returns 0 if no import is found
     */
    findImportLine(downstreamFile, changedFile) {
        try {
            // Resolve paths to absolute if they're relative
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
                ? workspaceFolders[0].uri.fsPath
                : process.cwd();
            const resolvedDownstreamFile = path.isAbsolute(downstreamFile)
                ? downstreamFile
                : path.resolve(workspaceRoot, downstreamFile);
            const resolvedChangedFile = path.isAbsolute(changedFile)
                ? changedFile
                : path.resolve(workspaceRoot, changedFile);
            if (!fs.existsSync(resolvedDownstreamFile)) {
                return 0;
            }
            const content = fs.readFileSync(resolvedDownstreamFile, 'utf8');
            const lines = content.split('\n');
            // Calculate relative path from downstream file to changed file
            const downstreamDir = path.dirname(resolvedDownstreamFile);
            const changedDir = path.dirname(resolvedChangedFile);
            const changedFileName = path.basename(resolvedChangedFile, path.extname(resolvedChangedFile));
            // Try multiple relative path formats
            const relativePath = path.relative(downstreamDir, resolvedChangedFile).replace(/\\/g, '/');
            const relativePathWithoutExt = relativePath.replace(/\.(ts|tsx|js|jsx)$/, '');
            // Also try directory-relative import (e.g., './utils' if changedFile is './utils/index.ts')
            const relativeDir = path.relative(downstreamDir, changedDir).replace(/\\/g, '/');
            const relativeDirWithFileName = relativeDir ? `${relativeDir}/${changedFileName}` : changedFileName;
            // Try to find package name from changed file's package.json
            let packageName = null;
            try {
                let currentDir = changedDir;
                for (let i = 0; i < 10; i++) {
                    const packageJsonPath = path.join(currentDir, 'package.json');
                    if (fs.existsSync(packageJsonPath)) {
                        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                        if (packageJson.name) {
                            packageName = packageJson.name;
                            break;
                        }
                    }
                    const parentDir = path.dirname(currentDir);
                    if (parentDir === currentDir)
                        break;
                    currentDir = parentDir;
                }
            }
            catch (error) {
                // Ignore errors reading package.json
            }
            // Patterns to match:
            // - import ... from './relative/path'
            // - import ... from '../relative/path'
            // - import ... from '@package/name' (package imports)
            // - import('...') or require('...')
            const importPatterns = [
                new RegExp(`from\\s+['"]${this.escapeRegex(relativePathWithoutExt)}['"]`),
                new RegExp(`from\\s+['"]${this.escapeRegex(relativePath)}['"]`),
                new RegExp(`from\\s+['"]${this.escapeRegex(relativeDirWithFileName)}['"]`),
                new RegExp(`import\\s*\\(\\s*['"]${this.escapeRegex(relativePathWithoutExt)}['"]`),
                new RegExp(`require\\s*\\(\\s*['"]${this.escapeRegex(relativePathWithoutExt)}['"]`),
            ];
            // Add package name pattern if found
            if (packageName) {
                const escapedPackageName = this.escapeRegex(packageName);
                importPatterns.push(new RegExp(`from\\s+['"]${escapedPackageName}['"]`), new RegExp(`import\\s*\\(\\s*['"]${escapedPackageName}['"]`), new RegExp(`require\\s*\\(\\s*['"]${escapedPackageName}['"]`));
            }
            // Find the first matching import line
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                for (const pattern of importPatterns) {
                    if (pattern.test(line)) {
                        return i + 1; // Line numbers are 1-based
                    }
                }
            }
        }
        catch (error) {
            // If there's an error, just return 0 (will open file without line navigation)
            console.warn(`[SimpleImpactViewProvider] Error finding import line in ${downstreamFile}:`, error);
        }
        return 0;
    }
    /**
     * Escape special regex characters in a string
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
exports.SimpleImpactViewProvider = SimpleImpactViewProvider;
//# sourceMappingURL=SimpleImpactViewProvider.js.map