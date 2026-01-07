import * as vscode from 'vscode';
import * as path from 'path';
import { ImpactAnalyzer, ImpactAnalysisResult } from '../core/ImpactAnalyzer';
import { TestRunner } from '../test-runners/TestRunner';

export class ImpactViewProvider implements vscode.TreeDataProvider<ImpactViewItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ImpactViewItem | undefined | null | void> = new vscode.EventEmitter<ImpactViewItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ImpactViewItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private impactAnalyzer: ImpactAnalyzer;
    private testRunner: TestRunner;
    private analysisResults: ImpactAnalysisResult[] = [];
    private history: ImpactAnalysisResult[] = [];
    private outputChannel: vscode.OutputChannel;

    constructor(impactAnalyzer: ImpactAnalyzer, testRunner: TestRunner) {
        this.impactAnalyzer = impactAnalyzer;
        this.testRunner = testRunner;
        this.outputChannel = vscode.window.createOutputChannel('Impact Analyzer Navigation');
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ImpactViewItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ImpactViewItem): Thenable<ImpactViewItem[]> {
        if (!element) {
            return this.getRootItems();
        } else if (element.type === 'workspace') {
            return this.getWorkspaceItems();
        } else if (element.type === 'recent') {
            return this.getRecentItems();
        } else if (element.type === 'file') {
            return this.getFileItems(element);
        } else if (element.type === 'functions' || element.type === 'classes' || 
                   element.type === 'tests' || element.type === 'downstream' || 
                   element.type === 'metrics') {
            return this.getTestItems(element);
        }
        return Promise.resolve([]);
    }

    private async getRootItems(): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        
        // Workspace Analysis
        const workspaceItem = new ImpactViewItem(
            'Workspace Analysis',
            'workspace',
            vscode.TreeItemCollapsibleState.Collapsed,
            {
                command: 'impactAnalyzer.analyzeWorkspace',
                title: 'Analyze Workspace',
                arguments: []
            }
        );
        workspaceItem.iconPath = new vscode.ThemeIcon('folder');
        items.push(workspaceItem);

        // Recent Analysis
        if (this.analysisResults.length > 0) {
            const recentItem = new ImpactViewItem(
                'Recent Analysis',
                'recent',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            recentItem.iconPath = new vscode.ThemeIcon('history');
            items.push(recentItem);
        }

        // Quick Actions
        const quickActionsItem = new ImpactViewItem(
            'Quick Actions',
            'quick-actions',
            vscode.TreeItemCollapsibleState.Collapsed
        );
        quickActionsItem.iconPath = new vscode.ThemeIcon('zap');
        items.push(quickActionsItem);

        return items;
    }

    private async getWorkspaceItems(): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        
        for (const result of this.analysisResults) {
            const fileName = path.basename(result.filePath);
            const fileItem = new ImpactViewItem(
                fileName,
                'file',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            fileItem.filePath = result.filePath;
            fileItem.analysisResult = result;
            fileItem.iconPath = new vscode.ThemeIcon('file');
            fileItem.description = `${result.affectedTests.length} tests affected`;
            fileItem.contextValue = 'analyzedFile';
            
            // Add risk indicator
            if (result.riskLevel === 'high') {
                fileItem.iconPath = new vscode.ThemeIcon('warning');
            } else if (result.riskLevel === 'medium') {
                fileItem.iconPath = new vscode.ThemeIcon('info');
            }
            
            items.push(fileItem);
        }
        
        return items;
    }

    private async getRecentItems(): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        
        const recentResults = this.history.slice(-10);
        for (const result of recentResults) {
            const fileName = path.basename(result.filePath);
            const fileItem = new ImpactViewItem(
                fileName,
                'file',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            fileItem.filePath = result.filePath;
            fileItem.analysisResult = result;
            fileItem.iconPath = new vscode.ThemeIcon('file');
            fileItem.description = `${result.affectedTests.length} tests affected`;
            fileItem.contextValue = 'analyzedFile';
            items.push(fileItem);
        }
        
        return items;
    }

    private async getFileItems(fileElement: ImpactViewItem): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        const result = fileElement.analysisResult;
        
        if (!result) {
            return items;
        }

        // Changed Functions
        if (result.changedFunctions.length > 0) {
            const functionsItem = new ImpactViewItem(
                `Functions (${result.changedFunctions.length})`,
                'functions',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            functionsItem.analysisResult = result;
            functionsItem.iconPath = new vscode.ThemeIcon('symbol-function');
            items.push(functionsItem);
        }

        // Changed Classes
        if (result.changedClasses.length > 0) {
            const classesItem = new ImpactViewItem(
                `Classes (${result.changedClasses.length})`,
                'classes',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            classesItem.analysisResult = result;
            classesItem.iconPath = new vscode.ThemeIcon('symbol-class');
            items.push(classesItem);
        }

        // Affected Tests
        if (result.affectedTests.length > 0) {
            const testsItem = new ImpactViewItem(
                `Affected Tests (${result.affectedTests.length})`,
                'tests',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            testsItem.analysisResult = result;
            testsItem.iconPath = new vscode.ThemeIcon('beaker');
            items.push(testsItem);
        }

        // Downstream Components
        if (result.downstreamComponents.length > 0) {
            const downstreamItem = new ImpactViewItem(
                `Downstream Components (${result.downstreamComponents.length})`,
                'downstream',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            downstreamItem.analysisResult = result;
            downstreamItem.iconPath = new vscode.ThemeIcon('arrow-down');
            items.push(downstreamItem);
        }

        // Metrics
        const metricsItem = new ImpactViewItem(
            'Metrics',
            'metrics',
            vscode.TreeItemCollapsibleState.Collapsed
        );
        metricsItem.analysisResult = result;
        metricsItem.iconPath = new vscode.ThemeIcon('graph');
        items.push(metricsItem);

        return items;
    }

    private async getTestItems(testElement: ImpactViewItem): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        
        // Get the analysis result from the parent file element
        let result = testElement.analysisResult;
        if (!result) {
            // Try to find the result from the analysis results
            const fileName = testElement.filePath;
            if (fileName) {
                result = this.analysisResults.find(r => r.filePath === fileName);
            }
        }
        
        if (!result) {
            return items;
        }

        if (testElement.type === 'functions') {
            for (const funcName of result.changedFunctions) {
                const funcItem = new ImpactViewItem(
                    funcName,
                    'function',
                    vscode.TreeItemCollapsibleState.None
                );
                funcItem.iconPath = new vscode.ThemeIcon('symbol-function');
                items.push(funcItem);
            }
        } else if (testElement.type === 'classes') {
            for (const className of result.changedClasses) {
                const classItem = new ImpactViewItem(
                    className,
                    'class',
                    vscode.TreeItemCollapsibleState.None
                );
                classItem.iconPath = new vscode.ThemeIcon('symbol-class');
                items.push(classItem);
            }
        } else if (testElement.type === 'tests') {
            for (const testFile of result.affectedTests) {
                const testItem = new ImpactViewItem(
                    path.basename(testFile),
                    'test',
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'impactAnalyzer.runAffectedTests',
                        title: 'Run Test',
                        arguments: [testFile]
                    }
                );
                testItem.filePath = testFile;
                testItem.iconPath = new vscode.ThemeIcon('beaker');
                testItem.contextValue = 'testFile';
                items.push(testItem);
            }
        } else if (testElement.type === 'downstream') {
            // Get workspace root to resolve relative paths
            // Try all workspace folders, not just the first one
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            const fs = require('fs');
            
            // Show output channel immediately
            this.outputChannel.clear();
            this.outputChannel.appendLine(`\n[ImpactViewProvider] ========== Processing downstream components ==========`);
            this.outputChannel.appendLine(`[ImpactViewProvider] Result file: ${result.filePath}`);
            this.outputChannel.appendLine(`[ImpactViewProvider] Downstream components count: ${result.downstreamComponents.length}`);
            this.outputChannel.show();
            
            // Try to determine workspace root from result.filePath if available
            // For example, if result.filePath is C:\create-t3-turbo\packages\ui\src\index.ts
            // and component is apps\nextjs\src\app\layout.tsx, we need to find the common root
            let workspaceRoot = '';
            if (result.filePath) {
                const resultPath = path.dirname(result.filePath);
                // Try to find a common parent that would contain both the result file and the component
                // For monorepos, the root is usually where package.json or multiple apps/packages exist
                let currentDir = resultPath;
                for (let i = 0; i < 10; i++) {
                    const parentDir = path.dirname(currentDir);
                    if (parentDir === currentDir) break; // Reached root
                    // Check if this directory contains common monorepo indicators
                    const hasPackageJson = fs.existsSync(path.join(parentDir, 'package.json'));
                    const hasApps = fs.existsSync(path.join(parentDir, 'apps'));
                    const hasPackages = fs.existsSync(path.join(parentDir, 'packages'));
                    if (hasPackageJson && (hasApps || hasPackages)) {
                        workspaceRoot = parentDir;
                        this.outputChannel.appendLine(`[ImpactViewProvider] ✅ Detected workspace root: ${workspaceRoot}`);
                        break;
                    }
                    currentDir = parentDir;
                }
            }
            
            // Fallback to workspace folders
            const defaultWorkspacePath = workspaceRoot || workspaceFolders[0]?.uri.fsPath || '';
            
            this.outputChannel.appendLine(`[ImpactViewProvider] Workspace root detection:`);
            this.outputChannel.appendLine(`  - Detected root: ${workspaceRoot || 'none'}`);
            this.outputChannel.appendLine(`  - Workspace folders: ${workspaceFolders.map(f => f.uri.fsPath).join(', ') || 'none'}`);
            this.outputChannel.appendLine(`  - Using root: ${defaultWorkspacePath}`);
            this.outputChannel.show(); // Show output channel so user can see what's happening
            
            for (const component of result.downstreamComponents) {
                // Resolve to absolute path - component might be relative or absolute
                // Normalize component path separators first (handle Windows backslashes)
                const normalizedComponent = component.replace(/\\/g, '/');
                let absolutePath: string;
                
                if (path.isAbsolute(component)) {
                    absolutePath = path.normalize(component);
                } else {
                    // Try resolving relative to detected workspace root first
                    if (workspaceRoot) {
                        // Use normalized component with forward slashes, path.resolve will handle it
                        absolutePath = path.resolve(workspaceRoot, normalizedComponent);
                        if (fs.existsSync(absolutePath)) {
                            // Found it!
                        } else {
                            // Try workspace folders
                            let found = false;
                            for (const folder of workspaceFolders) {
                                const candidatePath = path.resolve(folder.uri.fsPath, normalizedComponent);
                                if (fs.existsSync(candidatePath)) {
                                    absolutePath = candidatePath;
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                absolutePath = path.resolve(defaultWorkspacePath, normalizedComponent);
                            }
                        }
                    } else {
                        // Try resolving relative to each workspace folder
                        let found = false;
                        absolutePath = path.resolve(defaultWorkspacePath, normalizedComponent); // Initialize with fallback
                        
                        for (const folder of workspaceFolders) {
                            const candidatePath = path.resolve(folder.uri.fsPath, normalizedComponent);
                            if (fs.existsSync(candidatePath)) {
                                absolutePath = candidatePath;
                                found = true;
                                break;
                            }
                        }
                    }
                }
                
                // Normalize path separators (ensure consistent format)
                absolutePath = path.normalize(absolutePath);
                
                // Log for debugging
                this.outputChannel.appendLine(`\n[ImpactViewProvider] Resolving component: ${component}`);
                this.outputChannel.appendLine(`  - Normalized component: ${normalizedComponent}`);
                this.outputChannel.appendLine(`  - Workspace root: ${defaultWorkspacePath}`);
                this.outputChannel.appendLine(`  - Resolved to: ${absolutePath}`);
                const fileExists = fs.existsSync(absolutePath);
                this.outputChannel.appendLine(`  - File exists: ${fileExists}`);
                
                // Verify the file exists, if not try alternative path resolutions
                if (!fileExists) {
                    this.outputChannel.appendLine(`  - ❌ File not found, trying alternative resolutions...`);
                    // Try with different path separators
                    const altPath1 = absolutePath.replace(/\//g, '\\');
                    const altPath2 = absolutePath.replace(/\\/g, '/');
                    this.outputChannel.appendLine(`  - Trying altPath1 (backslashes): ${altPath1} (exists: ${fs.existsSync(altPath1)})`);
                    this.outputChannel.appendLine(`  - Trying altPath2 (forward slashes): ${altPath2} (exists: ${fs.existsSync(altPath2)})`);
                    if (fs.existsSync(altPath1)) {
                        absolutePath = altPath1;
                        this.outputChannel.appendLine(`  - ✅ Found with backslashes: ${absolutePath}`);
                    } else if (fs.existsSync(altPath2)) {
                        absolutePath = altPath2;
                        this.outputChannel.appendLine(`  - ✅ Found with forward slashes: ${absolutePath}`);
                    } else {
                        // Try resolving from the result's filePath directory
                        const resultDir = path.dirname(result.filePath);
                        const altPath3 = path.resolve(resultDir, normalizedComponent);
                        this.outputChannel.appendLine(`  - Trying result dir: ${altPath3} (exists: ${fs.existsSync(altPath3)})`);
                        if (fs.existsSync(altPath3)) {
                            absolutePath = altPath3;
                            this.outputChannel.appendLine(`  - ✅ Found from result dir: ${absolutePath}`);
                        } else {
                            // Last resort: try resolving from each workspace root with normalized separators
                            for (const folder of workspaceFolders) {
                                const candidatePath = path.resolve(folder.uri.fsPath, normalizedComponent);
                                this.outputChannel.appendLine(`  - Trying workspace folder: ${candidatePath} (exists: ${fs.existsSync(candidatePath)})`);
                                if (fs.existsSync(candidatePath)) {
                                    absolutePath = candidatePath;
                                    this.outputChannel.appendLine(`  - ✅ Found from workspace folder: ${absolutePath}`);
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // Find line numbers for this component if available
                // Try matching by absolute path first, then by relative path
                const componentWithLines = result.downstreamComponentsWithLines?.find(c => {
                    let cAbsolute = c.filePath;
                    if (!path.isAbsolute(cAbsolute)) {
                        cAbsolute = path.resolve(defaultWorkspacePath, cAbsolute);
                    }
                    // Normalize both paths for comparison
                    const normalizedAbsolute = absolutePath.replace(/\\/g, '/').toLowerCase();
                    const normalizedC = cAbsolute.replace(/\\/g, '/').toLowerCase();
                    return normalizedC === normalizedAbsolute || c.filePath === component;
                });
                const lineNumbers = componentWithLines?.lines || [];
                const firstLine = lineNumbers.length > 0 ? lineNumbers[0] : undefined;
                
                // Final verification - if file still doesn't exist, log and show output
                if (!fs.existsSync(absolutePath)) {
                    this.outputChannel.appendLine(`  - ❌ ERROR: File does not exist at: ${absolutePath}`);
                    this.outputChannel.appendLine(`  - Component: ${component}`);
                    this.outputChannel.appendLine(`  - Normalized: ${normalizedComponent}`);
                    this.outputChannel.appendLine(`  - Workspace root: ${defaultWorkspacePath}`);
                    this.outputChannel.show();
                    vscode.window.showErrorMessage(`File not found: ${absolutePath}\nCheck "Impact Analyzer Navigation" output for details.`);
                } else {
                    this.outputChannel.appendLine(`  - ✅ File found! Opening: ${absolutePath}`);
                }
                
                const componentItem = new ImpactViewItem(
                    path.basename(absolutePath) + (firstLine ? ` (line ${firstLine})` : ''),
                    'component',
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'vscode.open',
                        title: 'Open File',
                        arguments: [
                            vscode.Uri.file(absolutePath),
                            firstLine !== undefined ? { selection: new vscode.Range(firstLine - 1, 0, firstLine - 1, 0) } : undefined
                        ].filter(Boolean)
                    }
                );
                componentItem.filePath = absolutePath;
                componentItem.lineNumber = firstLine;
                componentItem.iconPath = new vscode.ThemeIcon('file');
                items.push(componentItem);
            }
        } else if (testElement.type === 'metrics') {
            // Confidence
            const confidenceItem = new ImpactViewItem(
                `Confidence: ${Math.round(result.confidence * 100)}%`,
                'confidence',
                vscode.TreeItemCollapsibleState.None
            );
            confidenceItem.iconPath = new vscode.ThemeIcon('symbol-numeric');
            items.push(confidenceItem);

            // Estimated Test Time
            const timeItem = new ImpactViewItem(
                `Estimated Test Time: ${result.estimatedTestTime}ms`,
                'time',
                vscode.TreeItemCollapsibleState.None
            );
            timeItem.iconPath = new vscode.ThemeIcon('clock');
            items.push(timeItem);

            // Coverage Impact
            const coverageItem = new ImpactViewItem(
                `Coverage Impact: ${result.coverageImpact}%`,
                'coverage',
                vscode.TreeItemCollapsibleState.None
            );
            coverageItem.iconPath = new vscode.ThemeIcon('graph');
            items.push(coverageItem);

            // Risk Level
            const riskItem = new ImpactViewItem(
                `Risk Level: ${result.riskLevel.toUpperCase()}`,
                'risk',
                vscode.TreeItemCollapsibleState.None
            );
            riskItem.iconPath = new vscode.ThemeIcon(
                result.riskLevel === 'high' ? 'warning' : 
                result.riskLevel === 'medium' ? 'info' : 'check'
            );
            items.push(riskItem);
        }

        return items;
    }

    async updateAnalysisResult(result: ImpactAnalysisResult): Promise<void> {
        // Remove existing result for the same file
        this.analysisResults = this.analysisResults.filter(r => r.filePath !== result.filePath);
        this.analysisResults.unshift(result); // Add to beginning
        
        // Add to history
        this.history.unshift(result);
        
        // Keep only last 20 results
        if (this.analysisResults.length > 20) {
            this.analysisResults = this.analysisResults.slice(0, 20);
        }
        
        if (this.history.length > 50) {
            this.history = this.history.slice(0, 50);
        }
        
        this.refresh();
    }

    async updateAnalysisResults(results: ImpactAnalysisResult[]): Promise<void> {
        this.analysisResults = results;
        this.refresh();
    }

    showHistory(): void {
        // This could open a webview or show history in a different way
        vscode.window.showInformationMessage(`Showing ${this.history.length} analysis results in history`);
    }
}

export class ImpactViewItem extends vscode.TreeItem {
    public filePath?: string;
    public lineNumber?: number;
    public analysisResult?: ImpactAnalysisResult;

    constructor(
        public readonly label: string,
        public readonly type: 'workspace' | 'recent' | 'file' | 'function' | 'class' | 'test' | 'component' | 'functions' | 'classes' | 'tests' | 'downstream' | 'metrics' | 'confidence' | 'time' | 'coverage' | 'risk' | 'quick-actions',
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
    }
}
