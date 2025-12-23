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
exports.KeyboardNavigationManager = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Manages keyboard navigation for the Impact Analysis TreeView
 * Provides arrow key navigation, expand/collapse, and item selection
 */
class KeyboardNavigationManager {
    constructor(treeView, viewProvider, context) {
        this.disposables = [];
        this.treeView = treeView;
        this.viewProvider = viewProvider;
        this.registerKeyBindings(context);
    }
    registerKeyBindings(context) {
        // Up arrow: Move to previous item
        const upCommand = vscode.commands.registerCommand('impactAnalyzer.navUp', async () => {
            await this.navigateUp();
        });
        this.disposables.push(upCommand);
        // Down arrow: Move to next item
        const downCommand = vscode.commands.registerCommand('impactAnalyzer.navDown', async () => {
            await this.navigateDown();
        });
        this.disposables.push(downCommand);
        // Right arrow or Enter: Expand selected item
        const expandCommand = vscode.commands.registerCommand('impactAnalyzer.navExpand', async () => {
            await this.expandSelected();
        });
        this.disposables.push(expandCommand);
        // Left arrow: Collapse selected item
        const collapseCommand = vscode.commands.registerCommand('impactAnalyzer.navCollapse', async () => {
            await this.collapseSelected();
        });
        this.disposables.push(collapseCommand);
        // Space: Toggle expand/collapse
        const toggleCommand = vscode.commands.registerCommand('impactAnalyzer.navToggle', async () => {
            await this.toggleSelected();
        });
        this.disposables.push(toggleCommand);
        // 'R': Run tests for selected item
        const runTestsCommand = vscode.commands.registerCommand('impactAnalyzer.navRunTests', async () => {
            await this.runTestsForSelected();
        });
        this.disposables.push(runTestsCommand);
        // 'E': Edit selected item (open file)
        const editCommand = vscode.commands.registerCommand('impactAnalyzer.navEdit', async () => {
            await this.editSelected();
        });
        this.disposables.push(editCommand);
        // 'A': Analyze selected file
        const analyzeCommand = vscode.commands.registerCommand('impactAnalyzer.navAnalyze', async () => {
            await this.analyzeSelected();
        });
        this.disposables.push(analyzeCommand);
        // 'T': Open test file
        const openTestCommand = vscode.commands.registerCommand('impactAnalyzer.navOpenTest', async () => {
            await this.openTestSelected();
        });
        this.disposables.push(openTestCommand);
        // 'D': Show dependencies
        const depsCommand = vscode.commands.registerCommand('impactAnalyzer.navDeps', async () => {
            await this.showDependencies();
        });
        this.disposables.push(depsCommand);
        // 'G': Go to definition
        const gotoCommand = vscode.commands.registerCommand('impactAnalyzer.navGoto', async () => {
            await this.goToDefinition();
        });
        this.disposables.push(gotoCommand);
        context.subscriptions.push(...this.disposables);
    }
    async navigateUp() {
        // Implementation would depend on VSCode TreeView selection API
        // For now, this is a placeholder that can be enhanced with proper state tracking
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            vscode.window.showInformationMessage('📌 Navigate up', { modal: false });
        }
    }
    async navigateDown() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            vscode.window.showInformationMessage('📌 Navigate down', { modal: false });
        }
    }
    async expandSelected() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            const item = selection[0];
            if (item) {
                try {
                    // Expand command reveals the item
                    await vscode.commands.executeCommand('impactAnalyzerView.focus');
                }
                catch (e) {
                    console.error('Error expanding item:', e);
                }
            }
        }
    }
    async collapseSelected() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            const item = selection[0];
            if (item) {
                try {
                    // Collapse the item
                    await vscode.commands.executeCommand('impactAnalyzerView.focus');
                }
                catch (e) {
                    console.error('Error collapsing item:', e);
                }
            }
        }
    }
    async toggleSelected() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            const item = selection[0];
            if (item && item.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
                // Expand
                await this.expandSelected();
            }
            else {
                // Collapse
                await this.collapseSelected();
            }
        }
    }
    async runTestsForSelected() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            const item = selection[0];
            if (item && item.filePath) {
                vscode.window.showInformationMessage(`🧪 Running tests for ${item.label}...`);
                await vscode.commands.executeCommand('impactAnalyzer.runAffectedTests');
            }
        }
    }
    async editSelected() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            const item = selection[0];
            if (item && item.filePath) {
                const document = await vscode.workspace.openTextDocument(item.filePath);
                await vscode.window.showTextDocument(document);
            }
        }
    }
    async analyzeSelected() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            const item = selection[0];
            if (item && item.filePath) {
                vscode.window.showInformationMessage(`📊 Analyzing ${item.label}...`);
                // The viewProvider should have the file path from the item
                if (this.viewProvider && this.viewProvider.analyzeFile) {
                    await this.viewProvider.analyzeFile(item.filePath);
                }
            }
        }
    }
    async openTestSelected() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            const item = selection[0];
            if (item && item.type === 'tests') {
                if (item.filePath) {
                    const document = await vscode.workspace.openTextDocument(item.filePath);
                    await vscode.window.showTextDocument(document);
                }
            }
        }
    }
    async showDependencies() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            const item = selection[0];
            if (item && item.type === 'downstream') {
                if (item.filePath) {
                    const message = `Dependencies for ${item.label}`;
                    vscode.window.showInformationMessage(message);
                }
            }
        }
    }
    async goToDefinition() {
        const selection = this.treeView.selection;
        if (selection && selection.length > 0) {
            const item = selection[0];
            if (item && item.filePath) {
                // Open the file and place cursor at the appropriate location
                const document = await vscode.workspace.openTextDocument(item.filePath);
                const editor = await vscode.window.showTextDocument(document);
                // If item has line information, go to that line
                if (item.analysisResult?.lineNumber) {
                    const line = item.analysisResult.lineNumber - 1;
                    const position = new vscode.Position(line, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position));
                }
            }
        }
    }
    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
exports.KeyboardNavigationManager = KeyboardNavigationManager;
//# sourceMappingURL=KeyboardNavigationManager.js.map