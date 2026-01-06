import * as vscode from 'vscode';
export class ConfigurationManager {
    constructor() {
        this.config = vscode.workspace.getConfiguration('impactAnalyzer');
    }
    refresh() {
        this.config = vscode.workspace.getConfiguration('impactAnalyzer');
    }
    get(key, defaultValue) {
        return this.config.get(key, defaultValue);
    }
    set(key, value) {
        this.config.update(key, value, vscode.ConfigurationTarget.Workspace);
    }
    getTestFrameworks() {
        return this.get('testFrameworks', ['jest', 'mocha', 'pytest', 'junit', 'cypress', 'playwright']);
    }
    getTestPatterns() {
        return this.get('testPatterns', [
            '**/*.test.*',
            '**/*.spec.*',
            '**/test/**',
            '**/tests/**',
            '**/__tests__/**'
        ]);
    }
    getSourcePatterns() {
        return this.get('sourcePatterns', [
            '**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx',
            '**/*.py', '**/*.java', '**/*.cs', '**/*.go', '**/*.rs'
        ]);
    }
    isAutoAnalysisEnabled() {
        return this.get('autoAnalysis', true);
    }
    getAnalysisDelay() {
        return this.get('analysisDelay', 500);
    }
    isAutoRefreshEnabled() {
        return this.get('autoRefreshOnSave', false);
    }
    getAutoRefreshDelay() {
        return this.get('autoRefreshDelay', 400);
    }
    getMaxAnalysisTime() {
        return this.get('maxAnalysisTime', 10000);
    }
    getBackendUrl() {
        return this.get('backendUrl', '');
    }
    getApiToken() {
        return this.get('apiToken', '');
    }
    getTeamId() {
        return this.get('teamId', '');
    }
    getRepoFullName() {
        return this.get('repoFullName', '');
    }
    isCiPollingEnabled() {
        return this.get('enableCiPolling', true);
    }
    getCiPollingInterval() {
        return this.get('ciPollingInterval', 180000);
    }
    isCacheEnabled() {
        return this.get('cacheEnabled', true);
    }
    isGitIntegrationEnabled() {
        return this.get('gitIntegration', true);
    }
    arePreCommitHooksEnabled() {
        return this.get('preCommitHooks', false);
    }
    shouldShowInlineAnnotations() {
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
    getBaselineMode() {
        return this.get('baselineMode', 'local');
    }
    /**
     * Get PR target branch for merge-base calculation
     */
    getPrTargetBranch() {
        return this.get('prTargetBranch', 'origin/main');
    }
}
