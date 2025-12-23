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
exports.InlineDecorationsManager = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Manages inline decorations and badges in the editor
 * Shows impact information directly in the code editor
 */
class InlineDecorationsManager {
    constructor(context) {
        this.disposables = [];
        // Create decoration types
        this.setupDecorations();
        // Listen for editor changes
        const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
            this.editor = editor;
            if (editor && this.lastResult && editor.document.fileName === this.lastResult.filePath) {
                this.applyDecorations(editor, this.lastResult);
            }
            else {
                this.clearDecorations();
            }
        });
        this.disposables.push(editorChangeDisposable);
        context.subscriptions.push(...this.disposables);
    }
    setupDecorations() {
        // Decoration for risky lines
        const riskDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: false,
            backgroundColor: new vscode.ThemeColor('editor.lineHighlightBackground'),
            borderStyle: 'solid',
            borderColor: new vscode.ThemeColor('editorError.foreground'),
            borderWidth: '1px',
            borderRadius: '2px',
        });
        // Decoration for function/class changes
        const changeDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.modifiedBackground'),
            isWholeLine: false,
        });
        // Store the primary decoration type
        this.decorationType = riskDecorationType;
    }
    /**
     * Apply inline decorations to the editor based on analysis result
     */
    applyDecorations(editor, result) {
        if (!result.hasActualChanges) {
            this.clearDecorations();
            return;
        }
        this.lastResult = result;
        this.editor = editor;
        // Create decorations for each affected element
        const decorations = [];
        // Add decorations for changed functions and classes
        const changedElements = [...(result.changedFunctions || []), ...(result.changedClasses || [])];
        if (changedElements.length > 0) {
            const content = editor.document.getText();
            const lines = content.split('\n');
            changedElements.forEach(element => {
                // Find the line containing this element
                const lineIndex = lines.findIndex(line => line.includes(`function ${element}`) ||
                    line.includes(`class ${element}`) ||
                    line.includes(`const ${element}`) ||
                    line.includes(`export ${element}`));
                if (lineIndex >= 0) {
                    // Create a decoration for this line
                    const line = lines[lineIndex];
                    const start = new vscode.Position(lineIndex, 0);
                    const end = new vscode.Position(lineIndex, line.length);
                    const range = new vscode.Range(start, end);
                    // Determine icon based on impact
                    const hasTests = result.affectedTests.length > 0;
                    const hasDownstream = result.downstreamComponents.length > 0;
                    let icon = '📝';
                    let hoverMessage = `Modified: ${element}`;
                    if (hasDownstream) {
                        icon = '⚠️';
                        hoverMessage += ` (${result.downstreamComponents.length} at-risk components)`;
                    }
                    if (hasTests) {
                        hoverMessage += ` (${result.affectedTests.length} tests affected)`;
                    }
                    // Create the decoration with hover information
                    const decoration = {
                        range,
                        hoverMessage: new vscode.MarkdownString(hoverMessage),
                        renderOptions: {
                            after: {
                                contentText: ` ${icon}`,
                                color: 'var(--vscode-editorWarning-foreground)',
                                margin: '0 0 0 10px',
                            }
                        }
                    };
                    decorations.push(decoration);
                }
            });
        }
        // Add impact summary decoration at the top
        if (decorations.length > 0 || result.affectedTests.length > 0) {
            const firstLine = new vscode.Position(0, 0);
            const riskIcon = this.getRiskIcon(result.riskLevel);
            const summary = `${riskIcon} ${result.affectedTests.length} tests affected • ${result.downstreamComponents.length} at-risk components • ${Math.round(result.confidence)}% confidence`;
            const headerDecoration = {
                range: new vscode.Range(firstLine, firstLine),
                hoverMessage: new vscode.MarkdownString('**Impact Summary**\n\n' + summary),
                renderOptions: {
                    before: {
                        contentText: summary,
                        color: 'var(--vscode-editorInfo-foreground)',
                        margin: '0 10px 0 0',
                        fontWeight: 'bold'
                    }
                }
            };
            // Apply decorations if we have the decoration type
            if (this.decorationType && editor === this.editor) {
                editor.setDecorations(this.decorationType, decorations);
            }
        }
    }
    /**
     * Clear all decorations from the editor
     */
    clearDecorations() {
        if (this.editor && this.decorationType) {
            this.editor.setDecorations(this.decorationType, []);
        }
        this.lastResult = undefined;
    }
    /**
     * Update decorations when result changes
     */
    updateDecorations(result) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.fileName === result.filePath) {
            this.applyDecorations(editor, result);
        }
    }
    /**
     * Show a code lens for quick actions
     */
    getCodeLensProvider() {
        return new ImpactCodeLensProvider(this.lastResult);
    }
    getRiskIcon(riskLevel) {
        switch (riskLevel) {
            case 'low':
                return '✅';
            case 'medium':
                return '🟡';
            case 'high':
                return '🔴';
            default:
                return '⚠️';
        }
    }
    dispose() {
        this.clearDecorations();
        if (this.decorationType) {
            this.decorationType.dispose();
        }
        this.disposables.forEach(d => d.dispose());
    }
}
exports.InlineDecorationsManager = InlineDecorationsManager;
/**
 * Provides code lenses for quick actions in the editor
 */
class ImpactCodeLensProvider {
    constructor(result) {
        this.result = result;
        this.onDidChangeCodeLensesEmitter = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;
    }
    provideCodeLenses(document, token) {
        if (!this.result || !this.result.hasActualChanges) {
            return [];
        }
        const codeLenses = [];
        const range = new vscode.Range(0, 0, 0, 0);
        // "Run Affected Tests" lens
        if (this.result.affectedTests.length > 0) {
            const runTestsLens = new vscode.CodeLens(range, {
                title: `🧪 Run ${this.result.affectedTests.length} Affected Tests`,
                command: 'impactAnalyzer.runAffectedTests',
                arguments: []
            });
            codeLenses.push(runTestsLens);
        }
        // "View Details" lens
        const viewDetailsLens = new vscode.CodeLens(range, {
            title: `📊 View Impact Details`,
            command: 'impactAnalyzerView.focus',
            arguments: []
        });
        codeLenses.push(viewDetailsLens);
        // "Run Pre-Commit Tests" lens
        if (this.result.downstreamComponents.length > 0 || this.result.affectedTests.length > 5) {
            const preCommitLens = new vscode.CodeLens(range, {
                title: `✓ Run Pre-Commit Tests`,
                command: 'impactAnalyzer.runPreCommitTests',
                arguments: []
            });
            codeLenses.push(preCommitLens);
        }
        return codeLenses;
    }
    resolveCodeLens(codeLens, token) {
        return codeLens;
    }
    updateResult(result) {
        this.result = result;
        this.onDidChangeCodeLensesEmitter.fire();
    }
}
//# sourceMappingURL=InlineDecorationsManager.js.map