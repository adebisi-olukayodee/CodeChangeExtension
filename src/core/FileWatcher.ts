import * as vscode from 'vscode';
import { ImpactAnalyzer } from './ImpactAnalyzer';
import { ConfigurationManager } from './ConfigurationManager';
// Simple debounce implementation
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
    let timeout: NodeJS.Timeout;
    return ((...args: any[]) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    }) as T;
}

export class FileWatcher {
    private impactAnalyzer: ImpactAnalyzer;
    private configManager: ConfigurationManager;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private saveWatcher: vscode.Disposable | undefined;
    private debouncedAnalyze: (filePath: string) => void;

    constructor(impactAnalyzer: ImpactAnalyzer, configManager: ConfigurationManager) {
        this.impactAnalyzer = impactAnalyzer;
        this.configManager = configManager;
        
        // Debounce analysis to avoid too frequent calls
        this.debouncedAnalyze = debounce(async (filePath: string) => {
            await this.performAnalysis(filePath);
        }, this.configManager.getAnalysisDelay());
    }

    start(): void {
        console.log('Starting file watcher for auto-analysis');
        console.log('Auto-analysis enabled:', this.configManager.isAutoAnalysisEnabled());
        
        // Watch for file saves
        this.saveWatcher = vscode.workspace.onDidSaveTextDocument(async (document) => {
            console.log('onDidSaveTextDocument triggered for:', document.uri.fsPath);
            console.log('Document scheme:', document.uri.scheme);
            
            if (document.uri.scheme === 'file') {
                console.log('File saved, scheduling analysis:', document.uri.fsPath);
                this.debouncedAnalyze(document.uri.fsPath);
            } else {
                console.log('Skipping non-file scheme:', document.uri.scheme);
            }
        });

        // Watch for file changes (optional, for more real-time updates)
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const patterns = this.configManager.getSourcePatterns();
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(workspaceFolder, `{${patterns.join(',')}}`)
            );

            this.fileWatcher.onDidChange(async (uri) => {
                console.log('File changed, scheduling analysis:', uri.fsPath);
                this.debouncedAnalyze(uri.fsPath);
            });
        }
    }

    stop(): void {
        console.log('Stopping file watcher');
        
        if (this.saveWatcher) {
            this.saveWatcher.dispose();
            this.saveWatcher = undefined;
        }

        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }
    }

    private async performAnalysis(filePath: string): Promise<void> {
        try {
            console.log('Performing auto-analysis for:', filePath);
            console.log('Source patterns:', this.configManager.getSourcePatterns());
            
            // Check if file matches source patterns
            const sourcePatterns = this.configManager.getSourcePatterns();
            const isSourceFile = sourcePatterns.some(pattern => {
                const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
                const matches = regex.test(filePath);
                console.log(`Pattern ${pattern} matches ${filePath}:`, matches);
                return matches;
            });

            console.log('Is source file:', isSourceFile);
            if (!isSourceFile) {
                console.log('Skipping non-source file:', filePath);
                return;
            }

            // Perform analysis with timeout
            const analysisPromise = this.impactAnalyzer.analyzeFile(filePath);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Analysis timeout')), this.configManager.getMaxAnalysisTime());
            });

            const result = await Promise.race([analysisPromise, timeoutPromise]) as any;
            
            // Show notification if enabled
            const notifications = this.configManager.getNotificationSettings();
            if (notifications.onAnalysisComplete) {
                const message = `Analysis complete: ${result.affectedTests.length} tests affected`;
                vscode.window.showInformationMessage(message);
            }

            // Show warning for high-impact changes
            if (result.riskLevel === 'high' && notifications.onHighImpactChanges) {
                vscode.window.showWarningMessage(
                    `High impact change detected! ${result.downstreamComponents.length} components may be affected.`
                );
            }

            console.log('Auto-analysis completed for:', filePath);
        } catch (error) {
            console.error('Auto-analysis failed for', filePath, ':', error);
            
            // Don't show error notifications for timeouts to avoid spam
            if (!(error as Error).message?.includes('timeout')) {
                vscode.window.showErrorMessage(`Auto-analysis failed: ${(error as Error).message}`);
            }
        }
    }

    dispose(): void {
        this.stop();
    }
}
