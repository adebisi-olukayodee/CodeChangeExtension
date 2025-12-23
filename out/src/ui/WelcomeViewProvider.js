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
exports.WelcomeViewProvider = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Provides a welcome/onboarding experience for first-time users
 * Shows setup steps, feature overview, and quick start guide
 */
class WelcomeViewProvider {
    constructor(context) {
        this._context = context;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            // And restrict the webview to only loading content from our extension's `media` directory.
            localResourceRoots: [this._context.extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'impactAnalyzer');
                    break;
                case 'runAnalysis':
                    vscode.commands.executeCommand('impactAnalyzer.analyzeCurrentFile');
                    break;
                case 'runTests':
                    vscode.commands.executeCommand('impactAnalyzer.runAffectedTests');
                    break;
                case 'openFile':
                    // TODO: Implement opening example file
                    // this.openExampleFile(data.file);
                    break;
                case 'dismissWelcome':
                    this._context.globalState.update('impactAnalyzer.welcomeDismissed', true);
                    break;
            }
        });
    }
    _getHtmlForWebview(webview) {
        const nonce = this.getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Impact Analyzer - Welcome</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            font-size: 13px;
            line-height: 1.6;
        }

        .container {
            max-width: 500px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header-icon {
            font-size: 32px;
        }

        .header-text h1 {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .header-text p {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .section {
            margin-bottom: 24px;
        }

        .section-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .section-title::before {
            content: '';
            display: inline-block;
            width: 3px;
            height: 16px;
            background-color: var(--vscode-textLink-foreground);
            border-radius: 1px;
        }

        .step {
            padding: 12px;
            margin-bottom: 8px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            display: flex;
            gap: 10px;
        }

        .step-number {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            background-color: var(--vscode-textLink-foreground);
            color: var(--vscode-editor-background);
            border-radius: 50%;
            font-size: 12px;
            font-weight: 600;
            flex-shrink: 0;
        }

        .step-content h3 {
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .step-content p {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .feature-list {
            list-style: none;
        }

        .feature-list li {
            padding: 8px 0;
            padding-left: 24px;
            position: relative;
            font-size: 12px;
        }

        .feature-list li::before {
            content: '✓';
            position: absolute;
            left: 0;
            color: var(--vscode-testing-runAction-foreground);
            font-weight: bold;
        }

        .button-group {
            display: flex;
            gap: 8px;
            margin-top: 12px;
        }

        .button {
            flex: 1;
            padding: 8px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: background-color 0.2s;
        }

        .button-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .button-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .button-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .button-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .keyboard-shortcut {
            display: inline-block;
            padding: 2px 6px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 2px;
            font-family: monospace;
            font-size: 11px;
            color: var(--vscode-textLink-foreground);
        }

        .tip-box {
            padding: 10px;
            margin-top: 12px;
            background-color: var(--vscode-notebookCellInfoBackground);
            border-left: 3px solid var(--vscode-notebookCellInlineOutputBackground);
            border-radius: 2px;
            font-size: 12px;
        }

        .tip-box strong {
            display: block;
            margin-bottom: 4px;
            color: var(--vscode-foreground);
        }

        .dismiss-btn {
            float: right;
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 16px;
            padding: 0;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .dismiss-btn:hover {
            color: var(--vscode-foreground);
        }

        .emoji {
            font-size: 14px;
            margin-right: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-icon">📊</div>
            <div class="header-text">
                <h1>Impact Analyzer</h1>
                <p>Real-time code impact analysis</p>
            </div>
            <button class="dismiss-btn" onclick="dismissWelcome()" title="Dismiss">✕</button>
        </div>

        <div class="section">
            <div class="section-title">
                <span class="emoji">🚀</span> Quick Start (5 minutes)
            </div>

            <div class="step">
                <div class="step-number">1</div>
                <div class="step-content">
                    <h3>Open a code file</h3>
                    <p>Select any .ts, .js, or .py file in your workspace</p>
                </div>
            </div>

            <div class="step">
                <div class="step-number">2</div>
                <div class="step-content">
                    <h3>Run Impact Analysis</h3>
                    <p>Press <span class="keyboard-shortcut">Ctrl+Shift+I</span> (or <span class="keyboard-shortcut">Cmd+Shift+I</span> on Mac)</p>
                </div>
            </div>

            <div class="step">
                <div class="step-number">3</div>
                <div class="step-content">
                    <h3>See what breaks</h3>
                    <p>Check the "Impact Analysis" panel on the left for results</p>
                </div>
            </div>

            <div class="step">
                <div class="step-number">4</div>
                <div class="step-content">
                    <h3>Run affected tests</h3>
                    <p>Press <span class="keyboard-shortcut">Ctrl+Shift+T</span> to run tests locally</p>
                </div>
            </div>

            <div class="button-group" style="margin-top: 16px;">
                <button class="button button-primary" onclick="runAnalysis()">
                    <span class="emoji">▶</span> Try Analysis Now
                </button>
                <button class="button button-secondary" onclick="runTests()">
                    <span class="emoji">🧪</span> Run Tests
                </button>
            </div>
        </div>

        <div class="section">
            <div class="section-title">
                <span class="emoji">✨</span> Key Features
            </div>
            <ul class="feature-list">
                <li>Real-time impact detection on file save</li>
                <li>Intelligent test discovery</li>
                <li>Identify components that might break</li>
                <li>Breaking change detection</li>
                <li>Confidence scoring (0-100)</li>
                <li>Pre-commit test validation</li>
            </ul>
        </div>

        <div class="section">
            <div class="section-title">
                <span class="emoji">⌨️</span> Keyboard Shortcuts
            </div>
            <div style="display: grid; gap: 8px; font-size: 12px;">
                <div>
                    <span class="keyboard-shortcut">Ctrl+Shift+I</span> - Analyze current file
                </div>
                <div>
                    <span class="keyboard-shortcut">Ctrl+Shift+T</span> - Run affected tests
                </div>
                <div>
                    <span class="keyboard-shortcut">↑/↓</span> - Navigate in Impact Panel (new!)
                </div>
                <div>
                    <span class="keyboard-shortcut">Space/Enter</span> - Expand/collapse items
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">
                <span class="emoji">⚙️</span> Configuration
            </div>
            <p style="margin-bottom: 12px;">Customize the extension to match your workflow:</p>
            <button class="button button-secondary" onclick="openSettings()" style="width: 100%;">
                <span class="emoji">⚙️</span> Open Settings
            </button>
            <div class="tip-box">
                <strong>Pro Tip:</strong> Enable auto-analysis on save to get instant feedback when you modify files.
            </div>
        </div>

        <div class="section">
            <div class="section-title">
                <span class="emoji">📚</span> Learn More
            </div>
            <p style="font-size: 12px; line-height: 1.5;">
                The extension analyzes your code changes and helps you understand:
            </p>
            <ul class="feature-list">
                <li><strong>What changed?</strong> Your modified functions and classes</li>
                <li><strong>What tests might fail?</strong> Affected test files</li>
                <li><strong>What could break?</strong> Components that depend on your changes</li>
                <li><strong>Is it safe?</strong> Risk assessment and confidence score</li>
            </ul>
        </div>

        <div style="padding-top: 20px; border-top: 1px solid var(--vscode-panel-border); text-align: center; font-size: 11px; color: var(--vscode-descriptionForeground);">
            <p>Made by OpsConverge • Version 1.0.0</p>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function runAnalysis() {
            vscode.postMessage({ type: 'runAnalysis' });
        }

        function runTests() {
            vscode.postMessage({ type: 'runTests' });
        }

        function openSettings() {
            vscode.postMessage({ type: 'openSettings' });
        }

        function openFile(file) {
            vscode.postMessage({ type: 'openFile', file: file });
        }

        function dismissWelcome() {
            vscode.postMessage({ type: 'dismissWelcome' });
        }
    </script>
</body>
</html>`;
    }
    getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
exports.WelcomeViewProvider = WelcomeViewProvider;
WelcomeViewProvider.viewType = 'impactAnalyzer.welcome';
//# sourceMappingURL=WelcomeViewProvider.js.map