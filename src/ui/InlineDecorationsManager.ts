import * as vscode from 'vscode';
import { ImpactAnalysisResult } from '../core/ProfessionalImpactAnalyzer';
import * as path from 'path';

/**
 * Manages inline decorations and badges in the editor
 * Shows impact information directly in the code editor
 */
export class InlineDecorationsManager {
    private editor?: vscode.TextEditor;
    private decorationType?: vscode.TextEditorDecorationType;
    private disposables: vscode.Disposable[] = [];
    private lastResult?: ImpactAnalysisResult;

    constructor(context: vscode.ExtensionContext) {
        // Create decoration types
        this.setupDecorations();

        // Listen for editor changes
        const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
            this.editor = editor;
            if (editor && this.lastResult && editor.document.fileName === this.lastResult.filePath) {
                this.applyDecorations(editor, this.lastResult);
            } else {
                this.clearDecorations();
            }
        });
        this.disposables.push(editorChangeDisposable);

        context.subscriptions.push(...this.disposables);
    }

    private setupDecorations(): void {
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
    public applyDecorations(editor: vscode.TextEditor, result: ImpactAnalysisResult): void {
        if (!result.hasActualChanges) {
            this.clearDecorations();
            return;
        }

        this.lastResult = result;
        this.editor = editor;

        // Create decorations for each affected element
        const decorations: vscode.DecorationOptions[] = [];

        // Add decorations for changed functions and classes
        const changedElements = [...(result.changedFunctions || []), ...(result.changedClasses || [])];

        if (changedElements.length > 0) {
            const content = editor.document.getText();
            const lines = content.split('\n');

            changedElements.forEach(element => {
                // Find the line containing this element
                const lineIndex = lines.findIndex(line =>
                    line.includes(`function ${element}`) ||
                    line.includes(`class ${element}`) ||
                    line.includes(`const ${element}`) ||
                    line.includes(`export ${element}`)
                );

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
                    const decoration: vscode.DecorationOptions = {
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

            const headerDecoration: vscode.DecorationOptions = {
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
    public clearDecorations(): void {
        if (this.editor && this.decorationType) {
            this.editor.setDecorations(this.decorationType, []);
        }
        this.lastResult = undefined;
    }

    /**
     * Update decorations when result changes
     */
    public updateDecorations(result: ImpactAnalysisResult): void {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.fileName === result.filePath) {
            this.applyDecorations(editor, result);
        }
    }

    /**
     * Show a code lens for quick actions
     */
    public getCodeLensProvider(): vscode.CodeLensProvider {
        return new ImpactCodeLensProvider(this.lastResult);
    }

    private getRiskIcon(riskLevel: string): string {
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

    dispose(): void {
        this.clearDecorations();
        if (this.decorationType) {
            this.decorationType.dispose();
        }
        this.disposables.forEach(d => d.dispose());
    }
}

/**
 * Provides code lenses for quick actions in the editor
 */
class ImpactCodeLensProvider implements vscode.CodeLensProvider {
    private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

    constructor(private result?: ImpactAnalysisResult) {}

    provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
        if (!this.result || !this.result.hasActualChanges) {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];
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

    resolveCodeLens?(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.CodeLens {
        return codeLens;
    }

    updateResult(result: ImpactAnalysisResult): void {
        this.result = result;
        this.onDidChangeCodeLensesEmitter.fire();
    }
}
