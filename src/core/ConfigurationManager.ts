import * as vscode from 'vscode';

export class ConfigurationManager {
    private config: vscode.WorkspaceConfiguration;

    constructor() {
        this.config = vscode.workspace.getConfiguration('impactAnalyzer');
    }

    refresh(): void {
        this.config = vscode.workspace.getConfiguration('impactAnalyzer');
    }

    get<T>(key: string, defaultValue: T): T {
        return this.config.get(key, defaultValue);
    }

    set(key: string, value: any): void {
        this.config.update(key, value, vscode.ConfigurationTarget.Workspace);
    }

    getTestFrameworks(): string[] {
        return this.get('testFrameworks', ['jest', 'mocha', 'pytest', 'junit', 'cypress', 'playwright']);
    }

    getTestPatterns(): string[] {
        return this.get('testPatterns', [
            '**/*.test.*', 
            '**/*.spec.*', 
            '**/test/**', 
            '**/tests/**', 
            '**/__tests__/**'
        ]);
    }

    getSourcePatterns(): string[] {
        return this.get('sourcePatterns', [
            '**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx', 
            '**/*.py', '**/*.java', '**/*.cs', '**/*.go', '**/*.rs'
        ]);
    }

    isAutoAnalysisEnabled(): boolean {
        return this.get('autoAnalysis', true);
    }

    getAnalysisDelay(): number {
        return this.get('analysisDelay', 500);
    }

    isAutoRefreshEnabled(): boolean {
        return this.get('autoRefreshOnSave', false);
    }

    getAutoRefreshDelay(): number {
        return this.get('autoRefreshDelay', 400);
    }

    getMaxAnalysisTime(): number {
        return this.get('maxAnalysisTime', 10000);
    }

    getBackendUrl(): string {
        return this.get('backendUrl', '');
    }

    getApiToken(): string {
        return this.get('apiToken', '');
    }

    getTeamId(): string {
        return this.get('teamId', '');
    }

    getRepoFullName(): string {
        return this.get('repoFullName', '');
    }

    isCiPollingEnabled(): boolean {
        return this.get('enableCiPolling', true);
    }

    getCiPollingInterval(): number {
        return this.get('ciPollingInterval', 180000);
    }

    isCacheEnabled(): boolean {
        return this.get('cacheEnabled', true);
    }

    isGitIntegrationEnabled(): boolean {
        return this.get('gitIntegration', true);
    }

    arePreCommitHooksEnabled(): boolean {
        return this.get('preCommitHooks', false);
    }

    shouldShowInlineAnnotations(): boolean {
        return this.get('showInlineAnnotations', true);
    }

    getNotificationSettings() {
        return this.get('notifications', {
            onAnalysisComplete: true,
            onTestFailures: true,
            onHighImpactChanges: true
        });
    }

    /**
     * Get baseline mode: 'local' (HEAD) or 'pr' (merge-base)
     */
    getBaselineMode(): 'local' | 'pr' {
        return this.get('baselineMode', 'local');
    }

    /**
     * Get PR target branch for merge-base calculation
     */
    getPrTargetBranch(): string {
        return this.get('prTargetBranch', 'origin/main');
    }
}
