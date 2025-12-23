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
exports.ImpactViewItem = exports.ImpactViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
class ImpactViewProvider {
    constructor(impactAnalyzer, testRunner) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.analysisResults = [];
        this.history = [];
        this.impactAnalyzer = impactAnalyzer;
        this.testRunner = testRunner;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            return this.getRootItems();
        }
        else if (element.type === 'workspace') {
            return this.getWorkspaceItems();
        }
        else if (element.type === 'recent') {
            return this.getRecentItems();
        }
        else if (element.type === 'file') {
            return this.getFileItems(element);
        }
        else if (element.type === 'functions' || element.type === 'classes' ||
            element.type === 'tests' || element.type === 'downstream' ||
            element.type === 'metrics') {
            return this.getTestItems(element);
        }
        return Promise.resolve([]);
    }
    async getRootItems() {
        const items = [];
        // Workspace Analysis
        const workspaceItem = new ImpactViewItem('Workspace Analysis', 'workspace', vscode.TreeItemCollapsibleState.Collapsed, {
            command: 'impactAnalyzer.analyzeWorkspace',
            title: 'Analyze Workspace',
            arguments: []
        });
        workspaceItem.iconPath = new vscode.ThemeIcon('folder');
        items.push(workspaceItem);
        // Recent Analysis
        if (this.analysisResults.length > 0) {
            const recentItem = new ImpactViewItem('Recent Analysis', 'recent', vscode.TreeItemCollapsibleState.Collapsed);
            recentItem.iconPath = new vscode.ThemeIcon('history');
            items.push(recentItem);
        }
        // Quick Actions
        const quickActionsItem = new ImpactViewItem('Quick Actions', 'quick-actions', vscode.TreeItemCollapsibleState.Collapsed);
        quickActionsItem.iconPath = new vscode.ThemeIcon('zap');
        items.push(quickActionsItem);
        return items;
    }
    async getWorkspaceItems() {
        const items = [];
        for (const result of this.analysisResults) {
            const fileName = path.basename(result.filePath);
            const fileItem = new ImpactViewItem(fileName, 'file', vscode.TreeItemCollapsibleState.Collapsed);
            fileItem.filePath = result.filePath;
            fileItem.analysisResult = result;
            fileItem.iconPath = new vscode.ThemeIcon('file');
            fileItem.description = `${result.affectedTests.length} tests affected`;
            fileItem.contextValue = 'analyzedFile';
            // Add risk indicator
            if (result.riskLevel === 'high') {
                fileItem.iconPath = new vscode.ThemeIcon('warning');
            }
            else if (result.riskLevel === 'medium') {
                fileItem.iconPath = new vscode.ThemeIcon('info');
            }
            items.push(fileItem);
        }
        return items;
    }
    async getRecentItems() {
        const items = [];
        const recentResults = this.history.slice(-10);
        for (const result of recentResults) {
            const fileName = path.basename(result.filePath);
            const fileItem = new ImpactViewItem(fileName, 'file', vscode.TreeItemCollapsibleState.Collapsed);
            fileItem.filePath = result.filePath;
            fileItem.analysisResult = result;
            fileItem.iconPath = new vscode.ThemeIcon('file');
            fileItem.description = `${result.affectedTests.length} tests affected`;
            fileItem.contextValue = 'analyzedFile';
            items.push(fileItem);
        }
        return items;
    }
    async getFileItems(fileElement) {
        const items = [];
        const result = fileElement.analysisResult;
        if (!result) {
            return items;
        }
        // Changed Functions
        if (result.changedFunctions.length > 0) {
            const functionsItem = new ImpactViewItem(`Functions (${result.changedFunctions.length})`, 'functions', vscode.TreeItemCollapsibleState.Collapsed);
            functionsItem.analysisResult = result;
            functionsItem.iconPath = new vscode.ThemeIcon('symbol-function');
            items.push(functionsItem);
        }
        // Changed Classes
        if (result.changedClasses.length > 0) {
            const classesItem = new ImpactViewItem(`Classes (${result.changedClasses.length})`, 'classes', vscode.TreeItemCollapsibleState.Collapsed);
            classesItem.analysisResult = result;
            classesItem.iconPath = new vscode.ThemeIcon('symbol-class');
            items.push(classesItem);
        }
        // Affected Tests
        if (result.affectedTests.length > 0) {
            const testsItem = new ImpactViewItem(`Affected Tests (${result.affectedTests.length})`, 'tests', vscode.TreeItemCollapsibleState.Collapsed);
            testsItem.analysisResult = result;
            testsItem.iconPath = new vscode.ThemeIcon('beaker');
            items.push(testsItem);
        }
        // Downstream Components
        if (result.downstreamComponents.length > 0) {
            const downstreamItem = new ImpactViewItem(`Downstream Components (${result.downstreamComponents.length})`, 'downstream', vscode.TreeItemCollapsibleState.Collapsed);
            downstreamItem.analysisResult = result;
            downstreamItem.iconPath = new vscode.ThemeIcon('arrow-down');
            items.push(downstreamItem);
        }
        // Metrics
        const metricsItem = new ImpactViewItem('Metrics', 'metrics', vscode.TreeItemCollapsibleState.Collapsed);
        metricsItem.analysisResult = result;
        metricsItem.iconPath = new vscode.ThemeIcon('graph');
        items.push(metricsItem);
        return items;
    }
    async getTestItems(testElement) {
        const items = [];
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
                const funcItem = new ImpactViewItem(funcName, 'function', vscode.TreeItemCollapsibleState.None);
                funcItem.iconPath = new vscode.ThemeIcon('symbol-function');
                items.push(funcItem);
            }
        }
        else if (testElement.type === 'classes') {
            for (const className of result.changedClasses) {
                const classItem = new ImpactViewItem(className, 'class', vscode.TreeItemCollapsibleState.None);
                classItem.iconPath = new vscode.ThemeIcon('symbol-class');
                items.push(classItem);
            }
        }
        else if (testElement.type === 'tests') {
            for (const testFile of result.affectedTests) {
                const testItem = new ImpactViewItem(path.basename(testFile), 'test', vscode.TreeItemCollapsibleState.None, {
                    command: 'impactAnalyzer.runAffectedTests',
                    title: 'Run Test',
                    arguments: [testFile]
                });
                testItem.filePath = testFile;
                testItem.iconPath = new vscode.ThemeIcon('beaker');
                testItem.contextValue = 'testFile';
                items.push(testItem);
            }
        }
        else if (testElement.type === 'downstream') {
            for (const component of result.downstreamComponents) {
                const componentItem = new ImpactViewItem(path.basename(component), 'component', vscode.TreeItemCollapsibleState.None);
                componentItem.filePath = component;
                componentItem.iconPath = new vscode.ThemeIcon('file');
                items.push(componentItem);
            }
        }
        else if (testElement.type === 'metrics') {
            // Confidence
            const confidenceItem = new ImpactViewItem(`Confidence: ${Math.round(result.confidence * 100)}%`, 'confidence', vscode.TreeItemCollapsibleState.None);
            confidenceItem.iconPath = new vscode.ThemeIcon('symbol-numeric');
            items.push(confidenceItem);
            // Estimated Test Time
            const timeItem = new ImpactViewItem(`Estimated Test Time: ${result.estimatedTestTime}ms`, 'time', vscode.TreeItemCollapsibleState.None);
            timeItem.iconPath = new vscode.ThemeIcon('clock');
            items.push(timeItem);
            // Coverage Impact
            const coverageItem = new ImpactViewItem(`Coverage Impact: ${result.coverageImpact}%`, 'coverage', vscode.TreeItemCollapsibleState.None);
            coverageItem.iconPath = new vscode.ThemeIcon('graph');
            items.push(coverageItem);
            // Risk Level
            const riskItem = new ImpactViewItem(`Risk Level: ${result.riskLevel.toUpperCase()}`, 'risk', vscode.TreeItemCollapsibleState.None);
            riskItem.iconPath = new vscode.ThemeIcon(result.riskLevel === 'high' ? 'warning' :
                result.riskLevel === 'medium' ? 'info' : 'check');
            items.push(riskItem);
        }
        return items;
    }
    async updateAnalysisResult(result) {
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
    async updateAnalysisResults(results) {
        this.analysisResults = results;
        this.refresh();
    }
    showHistory() {
        // This could open a webview or show history in a different way
        vscode.window.showInformationMessage(`Showing ${this.history.length} analysis results in history`);
    }
}
exports.ImpactViewProvider = ImpactViewProvider;
class ImpactViewItem extends vscode.TreeItem {
    constructor(label, type, collapsibleState, command) {
        super(label, collapsibleState);
        this.label = label;
        this.type = type;
        this.collapsibleState = collapsibleState;
        this.command = command;
    }
}
exports.ImpactViewItem = ImpactViewItem;
//# sourceMappingURL=ImpactViewProvider.js.map