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
exports.ConfigurationManager = void 0;
const vscode = __importStar(require("vscode"));
class ConfigurationManager {
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
exports.ConfigurationManager = ConfigurationManager;
//# sourceMappingURL=ConfigurationManager.js.map