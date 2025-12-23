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
exports.CiResultsManager = void 0;
const vscode = __importStar(require("vscode"));
const CiResultsClient_1 = require("./CiResultsClient");
class CiResultsManager {
    constructor(configurationManager, gitAnalyzer, viewProvider) {
        this.configurationManager = configurationManager;
        this.gitAnalyzer = gitAnalyzer;
        this.viewProvider = viewProvider;
        this.disposed = false;
        this.knownRunIds = new Set();
        this.isRefreshing = false;
        this.pendingRefresh = false;
        this.outputChannel = vscode.window.createOutputChannel('Impact Analyzer');
    }
    async initialize() {
        if (this.disposed) {
            return;
        }
        this.log('[CI] Initializing CI results manager...');
        this.ensureClient();
        await this.refreshCiResults();
        this.resetPollingTimer();
    }
    async refreshCiResults(manual = false) {
        if (this.disposed) {
            return;
        }
        if (this.isRefreshing) {
            if (manual) {
                this.pendingRefresh = true;
            }
            return;
        }
        this.isRefreshing = true;
        try {
            const backendUrl = this.configurationManager.getBackendUrl().trim();
            const teamId = this.configurationManager.getTeamId().trim();
            const repoFullName = this.configurationManager.getRepoFullName().trim();
            if (!backendUrl || !teamId || !repoFullName) {
                this.log('[CI] Skipping refresh: missing configuration');
                this.log(`       backendUrl=${backendUrl ? 'set' : 'missing'}, teamId=${teamId || 'missing'}, repo=${repoFullName || 'missing'}`);
                this.viewProvider.updateCiResults({
                    builds: [],
                    commitHash: undefined,
                    fetchedAt: new Date()
                });
                return;
            }
            const commitHashRaw = await this.gitAnalyzer.getCommitHash(repoFullName);
            const commitHash = commitHashRaw ? commitHashRaw.trim() : undefined;
            if (!commitHash) {
                this.log('[CI] Skipping refresh: unable to resolve commit hash via git rev-parse HEAD');
                this.viewProvider.updateCiResults({
                    builds: [],
                    commitHash: undefined,
                    fetchedAt: new Date()
                });
                return;
            }
            const client = this.ensureClient();
            if (!client) {
                this.log('[CI] Skipping refresh: client not available (check backend URL/token)');
                this.viewProvider.updateCiResults({
                    builds: [],
                    commitHash,
                    fetchedAt: new Date()
                });
                return;
            }
            this.log(`[CI] Polling results for commit ${commitHash.substring(0, 8)} (repo ${repoFullName})`);
            const runs = await client.fetchTestRunsForCommit(teamId, repoFullName, commitHash, { limit: 400 });
            this.log(`[CI] Retrieved ${runs.length} test run(s) from backend`);
            const builds = this.groupRunsByBuild(runs);
            if (builds.length === 0) {
                this.log('[CI] No builds found for commit');
                this.viewProvider.updateCiResults({
                    builds: [],
                    commitHash,
                    fetchedAt: new Date()
                });
                this.lastCommitHash = commitHash;
                this.lastRefreshAt = new Date();
                return;
            }
            this.handleNotifications(commitHash, builds);
            const payload = {
                builds,
                commitHash,
                fetchedAt: new Date()
            };
            this.viewProvider.updateCiResults(payload);
            this.lastCommitHash = commitHash;
            this.lastRefreshAt = payload.fetchedAt;
            this.log(`[CI] Updated CI view with ${builds.length} build(s) for commit ${commitHash.substring(0, 8)}`);
        }
        catch (error) {
            console.error('[Impact Analyzer] Failed to refresh CI results:', error);
            this.log(`[CI] Error refreshing CI results: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error) {
                vscode.window.showWarningMessage(`Impact Analyzer: Failed to refresh CI results - ${error.message}`);
            }
        }
        finally {
            this.isRefreshing = false;
            if (this.pendingRefresh && !this.disposed) {
                this.pendingRefresh = false;
                void this.refreshCiResults();
            }
        }
    }
    onConfigurationChanged() {
        if (this.disposed) {
            return;
        }
        this.log('[CI] Configuration changed; reloading client and polling timer');
        this.ensureClient(true);
        this.resetPollingTimer();
        void this.refreshCiResults();
    }
    dispose() {
        this.disposed = true;
        if (this.pollingTimer) {
            clearTimeout(this.pollingTimer);
            this.pollingTimer = undefined;
        }
        this.knownRunIds.clear();
    }
    ensureClient(force = false) {
        const backendUrl = this.configurationManager.getBackendUrl().trim();
        const token = this.configurationManager.getApiToken().trim();
        if (!backendUrl) {
            this.client = undefined;
            this.currentBackendUrl = undefined;
            this.currentToken = undefined;
            return undefined;
        }
        if (!this.client || force || backendUrl !== this.currentBackendUrl || token !== this.currentToken) {
            try {
                this.client = new CiResultsClient_1.CiResultsClient(backendUrl, token.length > 0 ? token : undefined);
                this.currentBackendUrl = backendUrl;
                this.currentToken = token;
            }
            catch (error) {
                console.error('[Impact Analyzer] Failed to initialize CI results client:', error);
                vscode.window.showWarningMessage('Impact Analyzer: Invalid backend configuration for CI results.');
                this.client = undefined;
            }
        }
        return this.client;
    }
    groupRunsByBuild(runs) {
        const buildsMap = new Map();
        for (const run of runs) {
            const buildId = run.buildId;
            if (!buildsMap.has(buildId)) {
                buildsMap.set(buildId, {
                    buildId,
                    workflowRunId: run.workflowRunId ?? undefined,
                    commitHash: run.commitHash ?? undefined,
                    branch: run.branch ?? undefined,
                    status: run.buildStatus ?? undefined,
                    repoFullName: run.repoFullName ?? undefined,
                    createdAt: run.buildCreatedAt ?? run.createdAt,
                    summary: {
                        total: 0,
                        passed: 0,
                        failed: 0,
                        skipped: 0,
                        flaky: 0
                    },
                    testRuns: []
                });
            }
            const entry = buildsMap.get(buildId);
            entry.testRuns.push(run);
            entry.summary.total += 1;
            const status = run.status.toLowerCase();
            if (status === 'passed') {
                entry.summary.passed += 1;
            }
            else if (status === 'failed' || status === 'error') {
                entry.summary.failed += 1;
            }
            else if (status === 'flaky') {
                entry.summary.flaky += 1;
            }
            else if (status === 'skipped') {
                entry.summary.skipped += 1;
            }
        }
        const builds = Array.from(buildsMap.values());
        for (const build of builds) {
            build.testRuns.sort((a, b) => {
                const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return bDate - aDate;
            });
            if (build.summary.total === 0 && build.testRuns.length > 0) {
                build.summary.total = build.testRuns.length;
            }
        }
        builds.sort((a, b) => {
            const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bDate - aDate;
        });
        return builds;
    }
    handleNotifications(commitHash, builds) {
        if (this.disposed) {
            return;
        }
        const commitKey = commitHash ?? 'unknown';
        const lastKey = this.lastCommitHash ?? 'unknown';
        if (commitKey !== lastKey) {
            this.knownRunIds.clear();
        }
        const newFailures = [];
        for (const build of builds) {
            for (const run of build.testRuns) {
                if ((run.status.toLowerCase() === 'failed' || run.status.toLowerCase() === 'error') && !this.knownRunIds.has(run.id)) {
                    newFailures.push(run);
                }
                this.knownRunIds.add(run.id);
            }
        }
        if (newFailures.length > 0) {
            const shortCommit = commitHash ? commitHash.substring(0, 8) : 'latest build';
            const message = `CI detected ${newFailures.length} failing test${newFailures.length === 1 ? '' : 's'} for ${shortCommit}.`;
            vscode.window.showWarningMessage(message, 'View Results').then(selection => {
                if (selection === 'View Results') {
                    void vscode.commands.executeCommand('impactAnalyzerView.focus');
                }
            });
        }
    }
    resetPollingTimer() {
        if (this.pollingTimer) {
            clearTimeout(this.pollingTimer);
            this.pollingTimer = undefined;
        }
        if (this.disposed) {
            return;
        }
        if (!this.configurationManager.isCiPollingEnabled()) {
            this.log('[CI] Polling disabled via configuration');
            return;
        }
        const interval = this.configurationManager.getCiPollingInterval();
        if (interval <= 0) {
            this.log('[CI] Polling interval is non-positive; skipping timer setup');
            return;
        }
        this.log(`[CI] Scheduling next poll in ${Math.round(interval / 1000)}s`);
        this.pollingTimer = setTimeout(() => {
            if (this.disposed) {
                return;
            }
            void this.refreshCiResults();
            this.resetPollingTimer();
        }, interval);
    }
    log(message) {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`${timestamp} ${message}`);
    }
}
exports.CiResultsManager = CiResultsManager;
//# sourceMappingURL=CiResultsManager.js.map