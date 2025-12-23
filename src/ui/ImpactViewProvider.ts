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

    constructor(impactAnalyzer: ImpactAnalyzer, testRunner: TestRunner) {
        this.impactAnalyzer = impactAnalyzer;
        this.testRunner = testRunner;
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
            for (const component of result.downstreamComponents) {
                const componentItem = new ImpactViewItem(
                    path.basename(component),
                    'component',
                    vscode.TreeItemCollapsibleState.None
                );
                componentItem.filePath = component;
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
