import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProfessionalImpactAnalyzer, ImpactAnalysisResult } from '../core/ProfessionalImpactAnalyzer';
import { TestRunner, TestResult } from '../test-runners/TestRunner';
import { CiBuildEntry, CiResultsPayload, CiTestRunEntry } from '../types/CiTypes';

export class ImpactViewItem extends vscode.TreeItem {
    public type: string;
    public filePath?: string;
    public analysisResult?: any;

    constructor(
        label: string,
        type: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.type = type;
    }
}

interface ImpactDeltaSummary {
    newFunctions: string[];
    removedFunctions: string[];
    newClasses: string[];
    removedClasses: string[];
    newTests: string[];
    removedTests: string[];
    newDownstream: string[];
    removedDownstream: string[];
}

interface ImpactAnalysisEntry {
    result: ImpactAnalysisResult;
    analyzedAt: number;
    delta?: ImpactDeltaSummary;
}

interface CiTestLocationPayload {
    filePath?: string;
    lineNumber?: number;
    run?: CiTestRunEntry;
    build?: CiBuildEntry;
    candidates?: string[];
}

export class SimpleImpactViewProvider implements vscode.TreeDataProvider<ImpactViewItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ImpactViewItem | undefined | null | void> = new vscode.EventEmitter<ImpactViewItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ImpactViewItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private impactAnalyzer: ProfessionalImpactAnalyzer;
    private testRunner: TestRunner;
    private analysisEntries: ImpactAnalysisEntry[] = [];
    private testResults: Map<string, TestResult> = new Map(); // Store test results by test file path
    private latestEntriesByFile: Map<string, ImpactAnalysisEntry> = new Map();
    private ciResults: CiBuildEntry[] = [];
    private ciContext: { commitHash?: string; lastUpdated?: Date } = {};

    constructor(impactAnalyzer: ProfessionalImpactAnalyzer, testRunner: TestRunner) {
        this.impactAnalyzer = impactAnalyzer;
        this.testRunner = testRunner;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ImpactViewItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ImpactViewItem): Thenable<ImpactViewItem[]> {
        if (!element) {
            return this.getRootItems();
        } else if (element.type === 'recent') {
            return this.getRecentItems(element);
        } else if (element.type === 'actions') {
            return this.getActionItems();
        } else if (element.type === 'file') {
            return this.getFileItems(element);
        } else if (element.type === 'functions' || element.type === 'classes' || 
                   element.type === 'tests' || element.type === 'downstream' || 
                   element.type === 'metrics' || element.type === 'confidence' ||
                   element.type === 'confidence-metric' || element.type === 'suggestions' ||
                   element.type === 'sub-metrics' || element.type === 'sub-metric-detail' ||
                   element.type === 'breaking-issues' || element.type === 'breaking-issue' ||
                   element.type === 'breaking-category' || element.type === 'breaking-fixes' ||
                   element.type === 'fix' || element.type === 'run-tests' || 
                   element.type === 'run-single-test' || element.type === 'separator' ||
                   element.type === 'test-result-error' || element.type === 'test-result-stack' ||
                   element.type === 'test-result-output' || element.type === 'test-result-status' ||
                   element.type === 'test-result-error-line' || element.type === 'test-result-stack-line' ||
                   element.type === 'test-result-output-line' || element.type === 'test-result-more' ||
                   element.type === 'delta-summary' || element.type === 'delta-section' ||
                   element.type === 'delta-change' || element.type === 'ci-root' ||
                   element.type === 'ci-build' || element.type === 'ci-build-tests' ||
                   element.type === 'ci-build-tests-category' ||
                   element.type === 'ci-test' || element.type === 'ci-test-stack' ||
                   element.type === 'ci-test-metadata') {
            return this.getDetailItems(element);
        }
        return Promise.resolve([]);
    }

    private async getRootItems(): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        
        // Recent Analysis Results
        if (this.analysisEntries.length > 0) {
            const recentItem = new ImpactViewItem(
                'Recent Analysis',
                'recent',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            recentItem.iconPath = new vscode.ThemeIcon('history');
            const latestEntry = this.analysisEntries[0];
            recentItem.description = `Last run ${this.formatRelativeTime(latestEntry.analyzedAt)}`;
            recentItem.tooltip = `Last analyzed at ${new Date(latestEntry.analyzedAt).toLocaleString()}`;
            items.push(recentItem);
        }

        // Quick Actions
        const actionsItem = new ImpactViewItem(
            'Quick Actions',
            'actions',
            vscode.TreeItemCollapsibleState.Collapsed
        );
        actionsItem.iconPath = new vscode.ThemeIcon('rocket');
        items.push(actionsItem);

        const ciRootItem = this.createCiRootItem();
        if (ciRootItem) {
            items.push(ciRootItem);
        }

        return items;
    }

    private createCiRootItem(): ImpactViewItem | undefined {
        const hasResults = this.ciResults.length > 0;
        const commit = this.ciContext.commitHash;

        if (!hasResults && !commit) {
            return undefined;
        }

        const collapsibleState = hasResults
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        const ciItem = new ImpactViewItem(
            'CI Test Results',
            'ci-root',
            collapsibleState
        );
        ciItem.iconPath = new vscode.ThemeIcon('beaker');

        if (commit) {
            ciItem.description = `Commit ${commit.substring(0, 8)}`;
        } else if (!hasResults) {
            ciItem.description = 'No commit tracked';
        }

        if (this.ciContext.lastUpdated) {
            ciItem.tooltip = `Last fetched ${this.formatRelativeTime(this.ciContext.lastUpdated.getTime())}`;
        } else if (!hasResults && commit) {
            ciItem.tooltip = `Awaiting CI results for commit ${commit.substring(0, 8)}`;
        } else if (!hasResults) {
            ciItem.tooltip = 'CI results will appear after the first synced run.';
        }

        ciItem.analysisResult = { commitHash: commit };
        return ciItem;
    }

    private getCiBuildItems(): ImpactViewItem[] {
        if (this.ciResults.length === 0) {
            const placeholder = new ImpactViewItem(
                this.ciContext.commitHash ? 'No CI results received yet for this commit.' : 'CI results unavailable.',
                'ci-message',
                vscode.TreeItemCollapsibleState.None
            );
            placeholder.iconPath = new vscode.ThemeIcon('info');
            return [placeholder];
        }

        return this.ciResults.map(build => {
            const buildItem = new ImpactViewItem(
                this.formatCiBuildLabel(build),
                'ci-build',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            buildItem.iconPath = new vscode.ThemeIcon(this.getCiStatusIconName(build));
            buildItem.description = this.buildCiBuildDescription(build);
            buildItem.analysisResult = { build };
            return buildItem;
        });
    }

    private formatCiBuildLabel(build: CiBuildEntry): string {
        const shortCommit = build.commitHash ? build.commitHash.substring(0, 8) : `Build ${build.buildId}`;
        if (build.summary.failed > 0) {
            return `${shortCommit} • ${build.summary.failed} failing`;
        }
        if (build.summary.total > 0) {
            return `${shortCommit} • ${build.summary.total} tests`;    
        }
        return `${shortCommit} • No tests`;
    }

    private buildCiBuildDescription(build: CiBuildEntry): string {
        const parts: string[] = [];
        if (build.summary.passed > 0) {
            parts.push(`${build.summary.passed} passed`);
        }
        if (build.summary.failed > 0) {
            parts.push(`${build.summary.failed} failed`);
        }
        if (build.summary.flaky > 0) {
            parts.push(`${build.summary.flaky} flaky`);
        }
        if (build.summary.skipped > 0) {
            parts.push(`${build.summary.skipped} skipped`);
        }
        if (build.createdAt) {
            parts.push(this.formatRelativeTime(new Date(build.createdAt).getTime()));
        }
        return parts.join(' • ');
    }

    private getCiStatusIconName(build: CiBuildEntry): string {
        if (build.summary.failed > 0) {
            return 'error';
        }
        if (build.summary.flaky > 0) {
            return 'warning';
        }
        if (build.summary.total === 0) {
            return 'watch';
        }
        return 'check';
    }

    private deriveCiStatus(build: CiBuildEntry): string {
        if (build.status) {
            return build.status;
        }
        if (build.summary.failed > 0) {
            return 'failed';
        }
        if (build.summary.total > 0 && build.summary.failed === 0) {
            return 'passed';
        }
        return 'unknown';
    }

    private createCiBuildDetailItems(build: CiBuildEntry): ImpactViewItem[] {
        const items: ImpactViewItem[] = [];

        const statusLabel = this.capitalize(this.deriveCiStatus(build));
        const commitLabel = build.commitHash ? build.commitHash.substring(0, 8) : 'Unknown commit';
        const testsLabel = `${build.summary.passed}/${build.summary.total} passed`;
        const completedLabel = build.createdAt
            ? this.formatRelativeTime(new Date(build.createdAt).getTime())
            : 'time unknown';

        const headlineParts = [
            `Status ${statusLabel}`,
            `Commit ${commitLabel}`,
            `Tests ${testsLabel}`,
            `Completed ${completedLabel}`
        ];

        const headlineItem = new ImpactViewItem(
            headlineParts.join(' • '),
            'ci-build-info',
            vscode.TreeItemCollapsibleState.None
        );
        headlineItem.iconPath = new vscode.ThemeIcon(this.getCiStatusIconName(build));
        const tooltipLines: string[] = [];
        tooltipLines.push(`Status: ${statusLabel}`);
        if (build.commitHash) {
            tooltipLines.push(`Commit: ${build.commitHash}`);
        }
        if (build.branch) {
            tooltipLines.push(`Branch: ${build.branch}`);
        }
        if (build.workflowRunId) {
            tooltipLines.push(`Workflow Run: ${build.workflowRunId}`);
        }
        tooltipLines.push(`Tests: ${build.summary.total}`);
        tooltipLines.push(`Passed: ${build.summary.passed}`);
        tooltipLines.push(`Failed: ${build.summary.failed}`);
        tooltipLines.push(`Skipped: ${build.summary.skipped}`);
        tooltipLines.push(`Flaky: ${build.summary.flaky}`);
        if (build.createdAt) {
            tooltipLines.push(`Completed at: ${new Date(build.createdAt).toLocaleString()}`);
        }
        headlineItem.tooltip = tooltipLines.join('\n');
        items.push(headlineItem);

        const failedRuns = build.testRuns.filter(run => {
            const status = (run.status || '').toLowerCase();
            return status === 'failed' || status === 'error';
        });

        const passedRuns = build.testRuns.filter(run => {
            const status = (run.status || '').toLowerCase();
            return status === 'passed';
        });

        const otherRuns = build.testRuns.filter(run => {
            const status = (run.status || '').toLowerCase();
            return status !== 'failed' && status !== 'error' && status !== 'passed';
        });

        const failedItem = new ImpactViewItem(
            `Failed Tests (${failedRuns.length})`,
            'ci-build-tests-category',
            failedRuns.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );
        failedItem.iconPath = new vscode.ThemeIcon('error');
        failedItem.analysisResult = { build, filter: 'failed' };
        if (failedRuns.length === 0) {
            failedItem.description = 'No failing tests';
        }
        items.push(failedItem);

        const passedItem = new ImpactViewItem(
            `Passed Tests (${passedRuns.length})`,
            'ci-build-tests-category',
            passedRuns.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );
        passedItem.iconPath = new vscode.ThemeIcon('check');
        passedItem.analysisResult = { build, filter: 'passed' };
        if (passedRuns.length === 0) {
            passedItem.description = 'No passing tests recorded';
        }
        items.push(passedItem);

        if (otherRuns.length > 0) {
            const otherItem = new ImpactViewItem(
                `Other Tests (${otherRuns.length})`,
                'ci-build-tests-category',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            otherItem.iconPath = new vscode.ThemeIcon('circle-large-outline');
            otherItem.analysisResult = { build, filter: 'other' };
            items.push(otherItem);
        }

        return items;
    }

    private createCiTestItems(build: CiBuildEntry): ImpactViewItem[] {
        if (build.testRuns.length === 0) {
            const placeholder = new ImpactViewItem(
                'No test runs captured for this build.',
                'ci-message',
                vscode.TreeItemCollapsibleState.None
            );
            placeholder.iconPath = new vscode.ThemeIcon('info');
            return [placeholder];
        }

        return build.testRuns.map(run => this.createCiTestItem(build, run));
    }

    private createCiTestItemsForFilter(build: CiBuildEntry, filter: 'failed' | 'passed' | 'other'): ImpactViewItem[] {
        let runs: CiTestRunEntry[] = [];
        if (filter === 'failed') {
            runs = build.testRuns.filter(run => {
                const status = (run.status || '').toLowerCase();
                return status === 'failed' || status === 'error';
            });
        } else if (filter === 'passed') {
            runs = build.testRuns.filter(run => (run.status || '').toLowerCase() === 'passed');
        } else {
            runs = build.testRuns.filter(run => {
                const status = (run.status || '').toLowerCase();
                return status !== 'failed' && status !== 'error' && status !== 'passed';
            });
        }

        if (runs.length === 0) {
            const label = filter === 'failed'
                ? 'No failing tests for this commit.'
                : filter === 'passed'
                ? 'No passing tests recorded for this commit.'
                : 'No additional tests recorded.';
            const placeholder = new ImpactViewItem(
                label,
                'ci-message',
                vscode.TreeItemCollapsibleState.None
            );
            placeholder.iconPath = new vscode.ThemeIcon(filter === 'failed' ? 'info' : filter === 'passed' ? 'check' : 'circle-large-outline');
            return [placeholder];
        }

        const filteredRuns = runs.map(run => this.createCiTestItem(build, run));

        const extraStatuses = new Set<string>();
        for (const run of runs) {
            const status = (run.status || '').toLowerCase();
            if (filter === 'failed' && status !== 'failed' && status !== 'error') {
                extraStatuses.add(status);
            }
            if (filter === 'passed' && status !== 'passed') {
                extraStatuses.add(status);
            }
            if (filter === 'other' && (status === 'failed' || status === 'error' || status === 'passed')) {
                extraStatuses.add(status);
            }
        }

        if (extraStatuses.size > 0) {
            const note = new ImpactViewItem(
                `Includes statuses: ${Array.from(extraStatuses).join(', ')}`,
                'ci-message',
                vscode.TreeItemCollapsibleState.None
            );
            note.iconPath = new vscode.ThemeIcon('info');
            filteredRuns.push(note);
        }

        return filteredRuns;
    }

    private createCiTestItem(build: CiBuildEntry, run: CiTestRunEntry): ImpactViewItem {
        const hasDetails = Boolean(run.errorMessage) || Boolean(run.stackTrace) || (run.metadata && Object.keys(run.metadata).length > 0);
        const collapsibleState = hasDetails ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        const testItem = new ImpactViewItem(
            this.formatCiTestLabel(run),
            'ci-test',
            collapsibleState
        );
        testItem.iconPath = new vscode.ThemeIcon(this.getCiTestIconName(run));
        testItem.analysisResult = { run, build };

        const descriptionParts: string[] = [];
        if (run.testSuite) {
            descriptionParts.push(this.getDisplayPath(run.testSuite));
        }
        const duration = this.formatDuration(run.duration);
        if (duration) {
            descriptionParts.push(duration);
        }

        const location = this.extractLocationFromRun(run);
        if (location?.lineNumber) {
            descriptionParts.push(`line ${location.lineNumber}`);
        }

        if (descriptionParts.length > 0) {
            testItem.description = descriptionParts.join(' • ');
        }

        const commandPayload = this.buildCiTestLocationPayload(build, run, location);
        testItem.command = {
            command: 'impactAnalyzer.openCiTestLocation',
            title: 'Open Test Location',
            arguments: [commandPayload]
        };

        return testItem;
    }

    private buildCiTestLocationPayload(build: CiBuildEntry, run: CiTestRunEntry, location?: { filePath: string; lineNumber?: number }): CiTestLocationPayload {
        return {
            build,
            run,
            filePath: location?.filePath,
            lineNumber: location?.lineNumber,
            candidates: this.buildPathCandidates(run, location)
        };
    }

    private buildPathCandidates(run: CiTestRunEntry, location?: { filePath: string; lineNumber?: number }): string[] {
        const candidates = new Set<string>();
        const addCandidate = (value?: unknown) => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed.length > 0) {
                    candidates.add(trimmed);
                }
            }
        };

        addCandidate(location?.filePath);

        const metadata = run.metadata ?? {};
        const metadataKeys = [
            'filePath',
            'filepath',
            'path',
            'relativePath',
            'repoPath',
            'repoFilePath',
            'sourcePath',
            'absolutePath',
            'file',
            'fullPath',
            'relativeFilePath',
            'workspacePath'
        ];
        for (const key of metadataKeys) {
            addCandidate(metadata[key]);
        }

        if (typeof metadata.fileName === 'string') {
            addCandidate(metadata.fileName);
            if (typeof metadata.directory === 'string') {
                addCandidate(path.join(metadata.directory, metadata.fileName));
            }
            if (typeof metadata.package === 'string') {
                addCandidate(path.join(metadata.package.replace(/\./g, '/'), metadata.fileName));
            }
        }

        if (metadata.packageName && metadata.className) {
            const extension = this.ensureExtension(metadata.extension || metadata.fileExtension || metadata.fileExt);
            addCandidate(path.join(String(metadata.packageName).replace(/\./g, '/'), `${metadata.className}${extension}`));
        }

        addCandidate(run.testSuite);
        if (run.testSuite && !run.testSuite.includes('/') && !run.testSuite.includes('\\')) {
            const suitePath = run.testSuite.replace(/\./g, '/');
            const guessedExtension = this.guessExtensionFromRun(run, metadata);
            if (guessedExtension) {
                addCandidate(`${suitePath}${guessedExtension.startsWith('.') ? guessedExtension : `.${guessedExtension}`}`);
            } else {
                addCandidate(suitePath);
            }
        }

        if (typeof metadata.className === 'string' && typeof metadata.package === 'string') {
            const extension = this.ensureExtension(metadata.extension || metadata.fileExtension || metadata.fileExt);
            addCandidate(path.join(metadata.package.replace(/\./g, '/'), `${metadata.className}${extension}`));
        }

        return Array.from(candidates);
    }

    private ensureExtension(value: unknown, defaultExt: string = '.java'): string {
        if (typeof value !== 'string' || value.trim().length === 0) {
            return defaultExt;
        }
        const trimmed = value.trim();
        return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
    }

    private guessExtensionFromRun(run: CiTestRunEntry, metadata: Record<string, any>): string | undefined {
        const metaExt = metadata?.extension || metadata?.fileExtension || metadata?.fileExt;
        if (typeof metaExt === 'string' && metaExt.trim().length > 0) {
            return metaExt.startsWith('.') ? metaExt : `.${metaExt}`;
        }

        if (typeof metadata?.fileName === 'string') {
            const ext = path.extname(metadata.fileName);
            if (ext) {
                return ext;
            }
        }

        const framework = (run.framework || '').toLowerCase();
        if (framework.includes('junit') || framework.includes('testng')) {
            return '.java';
        }
        if (framework.includes('pytest') || framework.includes('nose')) {
            return '.py';
        }
        if (framework.includes('jest') || framework.includes('mocha') || framework.includes('cypress') || framework.includes('playwright')) {
            return '.ts';
        }
        if (framework.includes('rspec')) {
            return '.rb';
        }
        if (framework.includes('go')) {
            return '.go';
        }

        return undefined;
    }

    async openCiTestLocation(payload?: CiTestLocationPayload): Promise<void> {
        if (!payload) {
            vscode.window.showWarningMessage('Impact Analyzer: Unable to open test location (missing payload).');
            return;
        }

        const locationFromRun = payload.run ? this.extractLocationFromRun(payload.run) : undefined;
        const lineNumber = payload.lineNumber ?? locationFromRun?.lineNumber;

        const candidateSet = new Set<string>();
        if (payload.filePath) {
            candidateSet.add(payload.filePath);
        }
        if (payload.candidates) {
            for (const candidate of payload.candidates) {
                if (candidate) {
                    candidateSet.add(candidate);
                }
            }
        }
        if (payload.run) {
            for (const candidate of this.buildPathCandidates(payload.run, locationFromRun)) {
                candidateSet.add(candidate);
            }
        }

        const candidates = Array.from(candidateSet);
        const uri = await this.resolveCandidateUri(candidates);

        if (!uri) {
            const label = payload.run?.testSuite || payload.filePath || 'test run';
            vscode.window.showWarningMessage(`Impact Analyzer: Unable to locate source file for ${label}.`);
            return;
        }

        const lineIndex = lineNumber ? Math.max(lineNumber - 1, 0) : 0;
        await vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(lineIndex, 0, lineIndex, 0)
        });
    }

    private async resolveCandidateUri(candidates: string[]): Promise<vscode.Uri | undefined> {
        if (candidates.length === 0) {
            return undefined;
        }

        const attempted = new Set<string>();
        const workspaceFolders = vscode.workspace.workspaceFolders;

        for (const candidate of candidates) {
            const variants = this.expandCandidateVariants(candidate);
            for (const variant of variants) {
                if (attempted.has(variant)) {
                    continue;
                }
                attempted.add(variant);

                if (fs.existsSync(variant)) {
                    return vscode.Uri.file(variant);
                }

                if (workspaceFolders) {
                    for (const folder of workspaceFolders) {
                        const fullPath = path.resolve(folder.uri.fsPath, variant);
                        if (fs.existsSync(fullPath)) {
                            return vscode.Uri.file(fullPath);
                        }
                    }
                }
            }
        }

        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }

        const normalizedCandidates = candidates
            .map(candidate => this.normalizeCandidate(candidate))
            .filter((value): value is string => typeof value === 'string' && value.length > 0);

        const basenames = Array.from(new Set(
            normalizedCandidates.map(candidate => path.basename(candidate)).filter(name => !!name && name !== '.' && name !== '/')
        ));

        for (const basename of basenames) {
            const files = await vscode.workspace.findFiles(`**/${basename}`, '**/{.git,node_modules,bower_components,dist,out}/**', 25);
            if (files.length === 0) {
                continue;
            }
            if (files.length === 1) {
                return files[0];
            }

            const loweredCandidates = normalizedCandidates.map(candidate => candidate.toLowerCase());
            for (const file of files) {
                const filePathLower = file.fsPath.replace(/\\/g, '/').toLowerCase();
                if (loweredCandidates.some(candidate => filePathLower.endsWith(candidate))) {
                    return file;
                }
            }

            return files[0];
        }

        return undefined;
    }

    private normalizeCandidate(value: string): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        let normalized = value.trim();
        if (normalized.length === 0) {
            return undefined;
        }

        normalized = normalized.replace(/^file:\/+/, '');
        normalized = normalized.replace(/^\\\\\?\\/, '');
        normalized = normalized.replace(/\\/g, '/');

        if (normalized.startsWith('~')) {
            const home = process.env.HOME || process.env.USERPROFILE;
            if (home) {
                normalized = path.join(home, normalized.slice(1));
            }
        }

        return normalized;
    }

    private expandCandidateVariants(candidate: string): string[] {
        const variants = new Set<string>();
        const normalized = this.normalizeCandidate(candidate);
        if (!normalized) {
            return [];
        }

        variants.add(normalized);
        variants.add(normalized.replace(/\//g, path.sep));

        const withoutDrive = normalized.replace(/^[A-Za-z]:/, '').replace(/^\/+/, '');
        if (withoutDrive.length > 0) {
            variants.add(withoutDrive);
            variants.add(withoutDrive.replace(/\//g, path.sep));
        }

        return Array.from(variants).filter(value => value.length > 0);
    }

    private formatCiTestLabel(run: CiTestRunEntry): string {
        const status = run.status.toLowerCase();
        const suite = run.testSuite ? this.getDisplayPath(run.testSuite) : 'Test';
        const name = run.name ? `: ${run.name}` : '';

        let prefix = 'ℹ️';
        if (status === 'passed') {
            prefix = '✅';
        } else if (status === 'failed' || status === 'error') {
            prefix = '❌';
        } else if (status === 'skipped') {
            prefix = '⏭️';
        } else if (status === 'flaky') {
            prefix = '⚠️';
        }

        return `${prefix} ${suite}${name}`;
    }

    private getCiTestIconName(run: CiTestRunEntry): string {
        const status = run.status.toLowerCase();
        if (status === 'passed') {
            return 'check';
        }
        if (status === 'failed' || status === 'error') {
            return 'error';
        }
        if (status === 'skipped') {
            return 'circle-slash';
        }
        if (status === 'flaky') {
            return 'warning';
        }
        return 'question';
    }

    private createCiTestDetailItems(run: CiTestRunEntry): ImpactViewItem[] {
        const items: ImpactViewItem[] = [];

        if (run.errorMessage) {
            const errorItem = new ImpactViewItem(
                run.errorMessage,
                'ci-test-message',
                vscode.TreeItemCollapsibleState.None
            );
            errorItem.iconPath = new vscode.ThemeIcon('error');
            items.push(errorItem);
        }

        if (run.stackTrace) {
            const stackItem = new ImpactViewItem(
                'Stack Trace',
                'ci-test-stack',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            stackItem.iconPath = new vscode.ThemeIcon('list-selection');
            stackItem.analysisResult = { stackTrace: run.stackTrace };
            items.push(stackItem);
        }

        if (run.metadata && Object.keys(run.metadata).length > 0) {
            const metadataItem = new ImpactViewItem(
                'Metadata',
                'ci-test-metadata',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            metadataItem.iconPath = new vscode.ThemeIcon('bracket-dot');
            metadataItem.analysisResult = { metadata: run.metadata };
            items.push(metadataItem);
        }

        return items;
    }

    private createCiStackItems(stackTrace: string): ImpactViewItem[] {
        const lines = stackTrace.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length === 0) {
            const placeholder = new ImpactViewItem('No stack trace entries', 'ci-message', vscode.TreeItemCollapsibleState.None);
            placeholder.iconPath = new vscode.ThemeIcon('info');
            return [placeholder];
        }

        return lines.slice(0, 50).map(line => {
            const lineItem = new ImpactViewItem(line.trim(), 'ci-test-stack-line', vscode.TreeItemCollapsibleState.None);
            lineItem.iconPath = new vscode.ThemeIcon('chevron-right');
            return lineItem;
        });
    }

    private createCiMetadataItems(metadata: Record<string, any>): ImpactViewItem[] {
        const entries = Object.entries(metadata);
        if (entries.length === 0) {
            const placeholder = new ImpactViewItem('No metadata available', 'ci-message', vscode.TreeItemCollapsibleState.None);
            placeholder.iconPath = new vscode.ThemeIcon('info');
            return [placeholder];
        }

        return entries.map(([key, value]) => {
            const displayValue = typeof value === 'string'
                ? value
                : JSON.stringify(value, null, 2);

            const trimmedValue = displayValue.length > 200 ? `${displayValue.substring(0, 200)}…` : displayValue;

            const metadataItem = new ImpactViewItem(
                `${key}: ${trimmedValue}`,
                'ci-test-metadata-entry',
                vscode.TreeItemCollapsibleState.None
            );
            metadataItem.iconPath = new vscode.ThemeIcon('symbol-field');
            return metadataItem;
        });
    }

    private formatDuration(duration?: number | null): string | undefined {
        if (duration === undefined || duration === null || isNaN(duration)) {
            return undefined;
        }

        if (duration > 1000) {
            return `${Math.round(duration / 1000)}s`;
        }

        if (duration > 1) {
            return `${duration.toFixed(1)}s`;
        }

        if (duration > 0) {
            return `${Math.max(Math.round(duration * 1000), 1)}ms`;
        }

        return undefined;
    }

    private extractLocationFromRun(run: CiTestRunEntry): { filePath: string; lineNumber?: number } | undefined {
        const metadata = run.metadata || {};
        const metadataPath = metadata.filePath || metadata.filepath || metadata.path;
        const metadataLineRaw = metadata.lineNumber ?? metadata.line ?? metadata.line_number;
        let lineNumber: number | undefined;
        if (typeof metadataLineRaw === 'number') {
            lineNumber = metadataLineRaw;
        } else if (typeof metadataLineRaw === 'string') {
            const parsed = parseInt(metadataLineRaw, 10);
            if (!isNaN(parsed)) {
                lineNumber = parsed;
            }
        }

        if (typeof metadataPath === 'string') {
            return { filePath: metadataPath, lineNumber };
        }

        if (run.stackTrace) {
            const lines = run.stackTrace.split(/\r?\n/);
            const regex = /((?:[a-zA-Z]:)?[^:\s]+?\.(?:ts|tsx|js|jsx|py|java|cs)):(\d+)(?::(\d+))?/;
            for (const line of lines) {
                const match = line.match(regex);
                if (match) {
                    const filePath = match[1];
                    const lineNumber = parseInt(match[2], 10);
                    return { filePath, lineNumber: isNaN(lineNumber) ? undefined : lineNumber };
                }
            }
        }

        return undefined;
    }

    private resolveFilePath(filePathValue: string): string | undefined {
        const variants = this.expandCandidateVariants(filePathValue);
        const workspaceFolders = vscode.workspace.workspaceFolders;

        for (const variant of variants) {
            if (fs.existsSync(variant)) {
                return variant;
            }
            if (workspaceFolders) {
                for (const folder of workspaceFolders) {
                    const resolved = path.resolve(folder.uri.fsPath, variant);
                    if (fs.existsSync(resolved)) {
                        return resolved;
                    }
                }
            }
        }

        return undefined;
    }

    private getDisplayPath(rawPath: string): string {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            return path.basename(rawPath);
        }
        const relative = path.relative(workspace.uri.fsPath, rawPath);
        return relative || path.basename(rawPath);
    }

    private capitalize(value: string): string {
        if (!value) {
            return value;
        }
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    private async getFileItems(fileElement: ImpactViewItem): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        const analysisPayload = fileElement.analysisResult;
        const result: ImpactAnalysisResult | undefined = analysisPayload?.result ?? analysisPayload;
        const entry: ImpactAnalysisEntry | undefined = analysisPayload?.entry;
        
        if (!result) {
            return items;
        }

        if (entry) {
            const timestampItem = new ImpactViewItem(
                `Analyzed ${this.formatRelativeTime(entry.analyzedAt)}`,
                'analysis-timestamp',
                vscode.TreeItemCollapsibleState.None
            );
            timestampItem.iconPath = new vscode.ThemeIcon('clock');
            timestampItem.description = new Date(entry.analyzedAt).toLocaleString();
            items.push(timestampItem);
        }

        if (entry?.delta && this.deltaHasChanges(entry.delta)) {
            const deltaItem = new ImpactViewItem(
                'Change Highlights',
                'delta-summary',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            deltaItem.iconPath = new vscode.ThemeIcon('diff');
            deltaItem.analysisResult = { delta: entry.delta, result };
            deltaItem.description = this.buildDeltaSummary(entry.delta);
            items.push(deltaItem);
        }

        // Check if no changes were detected
        if (result.hasActualChanges === false) {
            const noChangesItem = new ImpactViewItem(
                'ℹ️ No code change detected',
                'no-changes',
                vscode.TreeItemCollapsibleState.None
            );
            noChangesItem.iconPath = new vscode.ThemeIcon('info');
            noChangesItem.description = 'No changes to analyze';
            noChangesItem.tooltip = 'This file has no uncommitted changes. Make changes to the file and try again.';
            items.push(noChangesItem);
            return items;
        }

        // WHAT WILL BREAK - Show critical issues first (EXPANDED by default)
        const breakingIssues = this.extractBreakingIssues(result);
        if (breakingIssues.length > 0) {
            const breakingItem = new ImpactViewItem(
                `🚨 What Will Break (${breakingIssues.length})`,
                'breaking-issues',
                vscode.TreeItemCollapsibleState.Expanded // Expanded by default to show immediately
            );
            breakingItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
            breakingItem.analysisResult = { breakingIssues, result };
            breakingItem.description = `${breakingIssues.length} critical issue(s)`;
            items.push(breakingItem);
        } else {
            // Show success message if no issues
            const noIssuesItem = new ImpactViewItem(
                '✅ No Breaking Issues Detected',
                'breaking-issues',
                vscode.TreeItemCollapsibleState.None
            );
            noIssuesItem.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            noIssuesItem.analysisResult = { breakingIssues: [], result };
            items.push(noIssuesItem);
        }

        // Changed Classes
        if (result.changedClasses && result.changedClasses.length > 0) {
            const classesItem = new ImpactViewItem(
                `Classes (${result.changedClasses.length})`,
                'classes',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            classesItem.analysisResult = result;
            classesItem.iconPath = new vscode.ThemeIcon('symbol-class');
            items.push(classesItem);
        }

        // Downstream Components - HIDDEN (shown in "What Will Break" instead)
        // if (result.downstreamComponents && result.downstreamComponents.length > 0) {
        //     const downstreamItem = new ImpactViewItem(
        //         `Downstream Components (${result.downstreamComponents.length})`,
        //         'downstream',
        //         vscode.TreeItemCollapsibleState.Collapsed
        //     );
        //     downstreamItem.analysisResult = result;
        //     downstreamItem.iconPath = new vscode.ThemeIcon('arrow-down');
        //     items.push(downstreamItem);
        // }

        // Confidence Metrics - HIDDEN
        // if (result.confidenceResult) {
        //     const confidenceItem = new ImpactViewItem(
        //         `Confidence Score: ${result.confidenceResult.statusIcon} ${result.confidenceResult.total}/100 (${result.confidenceResult.status})`,
        //         'confidence',
        //         vscode.TreeItemCollapsibleState.Collapsed
        //     );
        //     confidenceItem.analysisResult = result;
        //     confidenceItem.iconPath = new vscode.ThemeIcon('graph');
        //     confidenceItem.description = result.confidenceResult.changedLines 
        //         ? `${result.confidenceResult.changedLines} lines changed` 
        //         : '';
        //     items.push(confidenceItem);
        // }

        // Legacy Metrics - HIDDEN
        // const metricsItem = new ImpactViewItem(
        //     'Legacy Metrics',
        //     'metrics',
        //     vscode.TreeItemCollapsibleState.Collapsed
        // );
        // metricsItem.analysisResult = result;
        // metricsItem.iconPath = new vscode.ThemeIcon('graph');
        // items.push(metricsItem);

        return items;
    }

    private async getRecentItems(recentElement: ImpactViewItem): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        
        for (const entry of this.analysisEntries) {
            const result = entry.result;
            const fileName = require('path').basename(result.filePath);
            const fileItem = new ImpactViewItem(
                fileName,
                'file',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            fileItem.filePath = result.filePath;
            fileItem.analysisResult = { result, entry };

            const breakingIssues = this.extractBreakingIssues(result);
            const hasBreakingIssues = breakingIssues.length > 0;
            fileItem.iconPath = hasBreakingIssues
                ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'))
                : new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));

            const summaryParts: string[] = [];
            summaryParts.push(hasBreakingIssues
                ? `${breakingIssues.length} issue${breakingIssues.length !== 1 ? 's' : ''}`
                : 'No issues');

            const changeSummary = this.buildChangeSummary(result);
            if (changeSummary) {
                summaryParts.push(changeSummary);
            }

            if (entry.delta && this.deltaHasChanges(entry.delta)) {
                summaryParts.push(`Δ ${this.buildDeltaSummary(entry.delta)}`);
            }

            summaryParts.push(`analyzed ${this.formatRelativeTime(entry.analyzedAt)}`);
            fileItem.description = summaryParts.join(' • ');
            fileItem.tooltip = this.buildFileTooltip(result, entry);
            items.push(fileItem);
        }
        
        return items;
    }

    private async getActionItems(): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        
        const analyzeItem = new ImpactViewItem(
            'Analyze Current File',
            'action',
            vscode.TreeItemCollapsibleState.None
        );
        analyzeItem.iconPath = new vscode.ThemeIcon('search');
        analyzeItem.command = {
            command: 'impactAnalyzer.analyzeCurrentFile',
            title: 'Analyze Current File'
        };
        items.push(analyzeItem);

        const workspaceItem = new ImpactViewItem(
            'Analyze Workspace',
            'action',
            vscode.TreeItemCollapsibleState.None
        );
        workspaceItem.iconPath = new vscode.ThemeIcon('folder');
        workspaceItem.command = {
            command: 'impactAnalyzer.analyzeWorkspace',
            title: 'Analyze Workspace'
        };
        items.push(workspaceItem);

        return items;
    }

    /**
     * Extract breaking issues from analysis result
     * Focuses on impact analysis: what code depends on changes and could break
     */
    private extractBreakingIssues(result: any): Array<{ severity: string; message: string; line: number; category: string; file?: string; recommendedFixes?: string[] }> {
        const breakingIssues: Array<{ severity: string; message: string; line: number; category: string; file?: string; recommendedFixes?: string[] }> = [];
        
        // Get fix recommendations from Contracts & Architecture metric
        let contractsMetric: any = null;
        if (result.confidenceResult) {
            const confidence = result.confidenceResult;
            for (const metric of confidence.metrics || []) {
                if (metric.name === 'Contracts & Architecture') {
                    contractsMetric = metric;
                    // Contracts & Architecture - Breaking changes
                    if (metric.subMetrics?.breakingChanges) {
                        for (const breakingChange of metric.subMetrics.breakingChanges) {
                            breakingIssues.push({
                                severity: '⚠️ Breaking',
                                message: breakingChange || 'Breaking API change',
                                line: 0,
                                category: 'API Breaking Change',
                                file: result.filePath,
                                recommendedFixes: metric.suggestions || [
                                    'Maintain backward-compatible function signatures',
                                    'Add deprecated annotation with migration path',
                                    'Update all call sites before removing old API',
                                    'Document breaking changes in CHANGELOG',
                                    'Consider version bump if breaking change is necessary'
                                ]
                            });
                        }
                    }
                    break;
                }
            }
        }
        
        // Impact Analysis - Code that depends on changes and could break
        
        const uniqueDownstream: string[] = Array.isArray(result.downstreamComponents)
            ? Array.from(
                new Set(
                    result.downstreamComponents
                        .filter((value: unknown): value is string => typeof value === 'string')
                )
            )
            : [];

        const uniqueAffectedTests: string[] = Array.isArray(result.affectedTests)
            ? Array.from(
                new Set(
                    result.affectedTests
                        .filter((value: unknown): value is string => typeof value === 'string')
                )
            )
            : [];

        const uniqueChangedFunctions: string[] = Array.isArray(result.changedFunctions)
            ? Array.from(
                new Set(
                    result.changedFunctions
                        .filter((value: unknown): value is string => typeof value === 'string')
                )
            )
            : [];

        const uniqueChangedClasses: string[] = Array.isArray(result.changedClasses)
            ? Array.from(
                new Set(
                    result.changedClasses
                        .filter((value: unknown): value is string => typeof value === 'string')
                )
            )
            : [];

        // Downstream components that depend on changed code
        if (uniqueDownstream.length > 0) {
            for (const component of uniqueDownstream) {
                breakingIssues.push({
                    severity: '⚠️ Risk',
                    message: `Depends on changed code: ${require('path').basename(component)}`,
                    line: 0,
                    category: 'Downstream Impact',
                    file: component,
                    recommendedFixes: [
                        `Review ${require('path').basename(component)} to ensure compatibility`,
                        'Run tests for dependent components',
                        'Update dependent code if API contract changed',
                        'Check for compilation/runtime errors in dependent files',
                        'Consider staging changes to avoid cascading failures'
                    ]
                });
            }
        }
        
        // Test Impact - Affected tests that might fail (included in "What Will Break")
        if (uniqueAffectedTests.length > 0) {
            for (const test of uniqueAffectedTests) {
                breakingIssues.push({
                    severity: '🧪 Test Risk',
                    message: `Test may fail: ${require('path').basename(test)}`,
                    line: 0,
                    category: 'Test Impact',
                    file: test,
                    recommendedFixes: [
                        `Run ${require('path').basename(test)} to verify it passes`,
                        'Update test expectations if behavior changed intentionally',
                        'Add test coverage for new functionality if missing',
                        'Fix test assertions if they are now incorrect',
                        'Consider adding integration tests for affected workflows'
                    ]
                });
            }
        }
        
        // Changed functions/classes that other code depends on
        if (uniqueChangedFunctions.length > 0) {
            for (const func of uniqueChangedFunctions) {
                // Only show if there are downstream components (indicating other code depends on it)
                if (uniqueDownstream.length > 0) {
                    breakingIssues.push({
                        severity: '⚠️ Breaking Change',
                        message: `Function changed: ${func} (may break callers)`,
                        line: 0,
                        category: 'Function Impact',
                        file: result.filePath,
                        recommendedFixes: [
                            `Find all call sites of ${func}() and update them`,
                            'Maintain backward compatibility by adding overloads',
                            'Add parameter defaults if possible',
                            'Update function signature documentation',
                            'Run tests for all callers to verify compatibility'
                        ]
                    });
                }
            }
        }
        
        if (uniqueChangedClasses.length > 0) {
            for (const cls of uniqueChangedClasses) {
                // Only show if there are downstream components (indicating other code depends on it)
                if (uniqueDownstream.length > 0) {
                    breakingIssues.push({
                        severity: '⚠️ Breaking Change',
                        message: `Class changed: ${cls} (may break dependents)`,
                        line: 0,
                        category: 'Class Impact',
                        file: result.filePath,
                        recommendedFixes: [
                            `Find all usages of ${cls} class and verify compatibility`,
                            'Maintain backward compatibility by preserving existing methods/properties',
                            'Add deprecation warnings before removing features',
                            'Update class documentation with migration guide',
                            'Run tests for all dependent classes'
                        ]
                    });
                }
            }
        }
        
        const seenIssues = new Set<string>();
        const dedupedIssues: typeof breakingIssues = [];

        for (const issue of breakingIssues) {
            const key = `${issue.category}|${issue.message}|${issue.file || ''}`;
            if (seenIssues.has(key)) {
                continue;
            }
            seenIssues.add(key);
            dedupedIssues.push(issue);
        }

        return dedupedIssues;
    }

    private async getDetailItems(detailElement: ImpactViewItem): Promise<ImpactViewItem[]> {
        const items: ImpactViewItem[] = [];
        const context = detailElement.analysisResult || {};
        const inferredResult: ImpactAnalysisResult | undefined = context.result
            || context.analysisResult
            || (typeof context.filePath === 'string' ? context as ImpactAnalysisResult : undefined)
            || (detailElement.filePath ? this.latestEntriesByFile.get(detailElement.filePath)?.result : undefined);

        if (detailElement.type === 'ci-root') {
            return this.getCiBuildItems();
        }

        if (detailElement.type === 'ci-build') {
            const build: CiBuildEntry | undefined = detailElement.analysisResult?.build;
            if (!build) {
                return items;
            }
            return this.createCiBuildDetailItems(build);
        }

        if (detailElement.type === 'ci-build-tests') {
            const build: CiBuildEntry | undefined = detailElement.analysisResult?.build;
            if (!build) {
                return items;
            }
            return this.createCiTestItems(build);
        }

        if (detailElement.type === 'ci-build-tests-category') {
            const { build, filter } = detailElement.analysisResult || {};
            if (build) {
                return this.createCiTestItemsForFilter(build, filter);
            }
        } else if (detailElement.type === 'ci-test') {
            const run: CiTestRunEntry | undefined = detailElement.analysisResult?.run;
            if (!run) {
                return items;
            }
            return this.createCiTestDetailItems(run);
        }

        if (detailElement.type === 'ci-test-stack') {
            const stackTrace: string | undefined = detailElement.analysisResult?.stackTrace;
            if (!stackTrace) {
                return items;
            }
            return this.createCiStackItems(stackTrace);
        }

        if (detailElement.type === 'ci-test-metadata') {
            const metadata: Record<string, any> | undefined = detailElement.analysisResult?.metadata;
            if (!metadata) {
                return items;
            }
            return this.createCiMetadataItems(metadata);
        }

        if (!inferredResult && detailElement.type !== 'delta-summary' && detailElement.type !== 'test-result-error' && detailElement.type !== 'test-result-stack' && detailElement.type !== 'test-result-output') {
            return items;
        }

        // What Will Break - Show breaking issues
        const result = inferredResult;

        if (detailElement.type === 'breaking-issues') {
            const breakingIssues = context.breakingIssues || [];
            const filePath = context.result?.filePath || inferredResult?.filePath || '';
            
            if (breakingIssues.length === 0) {
                const noIssuesItem = new ImpactViewItem(
                    '✅ No breaking issues detected',
                    'breaking-issue',
                    vscode.TreeItemCollapsibleState.None
                );
                noIssuesItem.iconPath = new vscode.ThemeIcon('check');
                items.push(noIssuesItem);
            } else {
                // Group by category
                const byCategory = new Map<string, typeof breakingIssues>();
                for (const issue of breakingIssues) {
                    if (!byCategory.has(issue.category)) {
                        byCategory.set(issue.category, []);
                    }
                    byCategory.get(issue.category)!.push(issue);
                }
                
                // Show issues grouped by category
                for (const [category, categoryIssues] of byCategory.entries()) {
                    const categoryItem = new ImpactViewItem(
                        `${category} (${categoryIssues.length})`,
                        'breaking-category',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    
                    // Use appropriate icons based on category type (matching main tree icons)
                    if (category === 'Function Impact') {
                        categoryItem.iconPath = new vscode.ThemeIcon('symbol-function');
                    } else if (category === 'Test Impact') {
                        categoryItem.iconPath = new vscode.ThemeIcon('beaker');
                    } else if (category === 'Class Impact') {
                        categoryItem.iconPath = new vscode.ThemeIcon('symbol-class');
                    } else if (category === 'Downstream Impact') {
                        categoryItem.iconPath = new vscode.ThemeIcon('arrow-down');
                    } else {
                        categoryItem.iconPath = new vscode.ThemeIcon('warning');
                    }
                    
                    categoryItem.analysisResult = { issues: categoryIssues, filePath, category };
                    items.push(categoryItem);
                }
            }
        } else if (detailElement.type === 'breaking-category') {
            // Show issues in this category
            const issues = context.issues || [];
            const filePath = context.filePath || inferredResult?.filePath || '';
            const categoryName = context.category || '';
            
            // For Test Impact category, add a "Run All Tests" option at the top
            if (categoryName === 'Test Impact' && issues.length > 0) {
                const testFiles = issues
                    .filter((issue: any) => issue.file && issue.category === 'Test Impact')
                    .map((issue: any) => issue.file)
                    .filter((file: string | undefined, index: number, self: string[]) => 
                        file && self.indexOf(file) === index
                    ) as string[];
                
                if (testFiles.length > 0) {
                    const runAllTestsItem = new ImpactViewItem(
                        `▶️ Run All Tests (${testFiles.length})`,
                        'run-tests',
                        vscode.TreeItemCollapsibleState.None
                    );
                    runAllTestsItem.iconPath = new vscode.ThemeIcon('play');
                    runAllTestsItem.description = 'Run all affected tests';
                    runAllTestsItem.analysisResult = { testFiles, category: 'Test Impact' };
                    runAllTestsItem.command = {
                        command: 'impactAnalyzer.runAffectedTests',
                        title: 'Run All Tests',
                        arguments: [testFiles]
                    };
                    items.push(runAllTestsItem);
                    
                    // Add separator
                    const separatorItem = new ImpactViewItem(
                        '─'.repeat(40),
                        'separator',
                        vscode.TreeItemCollapsibleState.None
                    );
                    separatorItem.description = '';
                    items.push(separatorItem);
                }
            }
            
            for (const issue of issues) {
                // For impact issues (no line number), show file path instead
                const label = issue.line > 0 
                    ? `Line ${issue.line}: ${issue.message}`
                    : `${issue.message}${issue.file ? ` (${require('path').basename(issue.file)})` : ''}`;
                
                // Check if this issue has recommended fixes
                const hasFixes = issue.recommendedFixes && issue.recommendedFixes.length > 0;
                
                // For Test Impact issues, make them collapsible to show test results and "Run Test" option
                const isTestImpact = issue.category === 'Test Impact';
                const hasTestResult = isTestImpact && issue.file && this.testResults.has(issue.file);
                const collapsibleState = (isTestImpact && hasTestResult) || hasFixes
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : isTestImpact || hasFixes
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
                
                const issueItem = new ImpactViewItem(
                    label,
                    'breaking-issue',
                    collapsibleState
                );
                
                // Use appropriate icons based on category type
                if (issue.category === 'Test Impact') {
                    // Show test result status icon if test has been run
                    const testResult = issue.file ? this.testResults.get(issue.file) : undefined;
                    if (testResult) {
                        issueItem.iconPath = new vscode.ThemeIcon(
                            testResult.status === 'passed' ? 'check' : 
                            testResult.status === 'failed' ? 'error' : 
                            testResult.status === 'skipped' ? 'circle-slash' : 'warning'
                        );
                        issueItem.description = `${testResult.status.toUpperCase()} (${testResult.duration}ms)`;
                    } else {
                        issueItem.iconPath = new vscode.ThemeIcon('beaker');
                        issueItem.description = `${issue.severity} - ${issue.category}`;
                    }
                } else if (issue.category === 'Function Impact') {
                    issueItem.iconPath = new vscode.ThemeIcon('symbol-function');
                    issueItem.description = `${issue.severity} - ${issue.category}`;
                } else if (issue.category === 'Class Impact') {
                    issueItem.iconPath = new vscode.ThemeIcon('symbol-class');
                    issueItem.description = `${issue.severity} - ${issue.category}`;
                } else if (issue.category === 'Downstream Impact') {
                    issueItem.iconPath = new vscode.ThemeIcon('arrow-down');
                    issueItem.description = `${issue.severity} - ${issue.category}`;
                } else {
                    issueItem.iconPath = new vscode.ThemeIcon('error');
                    issueItem.description = `${issue.severity} - ${issue.category}`;
                }
                
                issueItem.analysisResult = { issue, filePath };
                
                // For issues with line numbers, add navigation command
                if (issue.line > 0 && (issue.file || filePath)) {
                    const targetPath = issue.file || filePath;
                    issueItem.command = {
                        command: 'vscode.open',
                        title: 'Go to Line',
                        arguments: [
                            vscode.Uri.file(targetPath),
                            { selection: new vscode.Range(issue.line - 1, 0, issue.line - 1, 0) }
                        ]
                    };
                } else if (issue.file) {
                    // For impact issues with file path, open file
                    issueItem.command = {
                        command: 'vscode.open',
                        title: 'Open File',
                        arguments: [vscode.Uri.file(issue.file)]
                    };
                }
                
                items.push(issueItem);
            }
        } else if (detailElement.type === 'delta-summary') {
            const delta: ImpactDeltaSummary | undefined = context.delta;
            const deltaResult: ImpactAnalysisResult | undefined = context.result || inferredResult;
            if (!delta || !this.deltaHasChanges(delta)) {
                return items;
            }

            const deltaSections: Array<{ title: string; added: string[]; removed: string[]; icon: string; type: string; }> = [
                { title: 'Functions', added: delta.newFunctions, removed: delta.removedFunctions, icon: 'symbol-function', type: 'delta-functions' },
                { title: 'Classes', added: delta.newClasses, removed: delta.removedClasses, icon: 'symbol-class', type: 'delta-classes' },
                { title: 'Tests', added: delta.newTests, removed: delta.removedTests, icon: 'beaker', type: 'delta-tests' },
                { title: 'Downstream', added: delta.newDownstream, removed: delta.removedDownstream, icon: 'arrow-down', type: 'delta-downstream' }
            ];

            for (const section of deltaSections) {
                if (section.added.length === 0 && section.removed.length === 0) {
                    continue;
                }

                const sectionLabelParts: string[] = [section.title];
                if (section.added.length > 0) {
                    sectionLabelParts.push(`+${section.added.length}`);
                }
                if (section.removed.length > 0) {
                    sectionLabelParts.push(`-${section.removed.length}`);
                }

                const sectionItem = new ImpactViewItem(
                    sectionLabelParts.join(' '),
                    'delta-section',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                sectionItem.iconPath = new vscode.ThemeIcon(section.icon);
                sectionItem.analysisResult = {
                    added: section.added,
                    removed: section.removed,
                    result: deltaResult,
                    label: section.title
                };
                items.push(sectionItem);
            }
        } else if (detailElement.type === 'delta-section') {
            const added: string[] = context.added || [];
            const removed: string[] = context.removed || [];
            const label: string = context.label || 'Changes';

            if (added.length === 0 && removed.length === 0) {
                return items;
            }

            if (added.length > 0) {
                const addedHeader = new ImpactViewItem(
                    `Added (${added.length})`,
                    'delta-change',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                addedHeader.iconPath = new vscode.ThemeIcon('diff-added');
                addedHeader.analysisResult = { items: added, changeType: 'added', label };
                items.push(addedHeader);
            }

            if (removed.length > 0) {
                const removedHeader = new ImpactViewItem(
                    `Removed (${removed.length})`,
                    'delta-change',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                removedHeader.iconPath = new vscode.ThemeIcon('diff-removed');
                removedHeader.analysisResult = { items: removed, changeType: 'removed', label };
                items.push(removedHeader);
            }
        } else if (detailElement.type === 'delta-change') {
            const changeItems: string[] = context.items || [];
            const changeType: string = context.changeType || 'changed';
            const changeIcon = changeType === 'added' ? 'diff-added' : 'diff-removed';

            for (const item of changeItems) {
                const changeItem = new ImpactViewItem(
                    item,
                    'delta-entry',
                    vscode.TreeItemCollapsibleState.None
                );
                changeItem.iconPath = new vscode.ThemeIcon(changeIcon);
                items.push(changeItem);
            }

            return items;
        }

        const resultOptionalTypes = new Set<string>([
            'test-result-error',
            'test-result-stack',
            'test-result-output',
            'test-result-error-line',
            'test-result-stack-line',
            'test-result-output-line',
            'test-result-more'
        ]);

        if (!result && !resultOptionalTypes.has(detailElement.type)) {
            return items;
        }

        const safeResult = (result || {}) as ImpactAnalysisResult;

        if (detailElement.type === 'breaking-issue') {
            // Show recommended fixes for this breaking issue
            const issue = context.issue;
            const filePath = context.filePath || safeResult.filePath || '';
            
            // For Test Impact issues, show test results if available, otherwise show "Run Test" option
            if (issue && issue.category === 'Test Impact' && issue.file) {
                const testResult = this.testResults.get(issue.file);
                
                if (testResult) {
                    // Show test results as subtree
                    const statusIcon = testResult.status === 'passed' ? '✅' : 
                                      testResult.status === 'failed' ? '❌' : 
                                      testResult.status === 'skipped' ? '⏭️' : '⚠️';
                    
                    const statusItem = new ImpactViewItem(
                        `${statusIcon} Status: ${testResult.status.toUpperCase()}`,
                        'test-result-status',
                        vscode.TreeItemCollapsibleState.None
                    );
                    statusItem.iconPath = new vscode.ThemeIcon(
                        testResult.status === 'passed' ? 'check' : 
                        testResult.status === 'failed' ? 'error' : 
                        testResult.status === 'skipped' ? 'circle-slash' : 'warning'
                    );
                    statusItem.description = `${testResult.duration}ms`;
                    items.push(statusItem);
                    
                    if (testResult.errorMessage) {
                        const errorItem = new ImpactViewItem(
                            `Error: ${testResult.errorMessage.substring(0, 100)}${testResult.errorMessage.length > 100 ? '...' : ''}`,
                            'test-result-error',
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        errorItem.iconPath = new vscode.ThemeIcon('error');
                        errorItem.description = 'Click to expand';
                        errorItem.analysisResult = { errorMessage: testResult.errorMessage, stackTrace: testResult.stackTrace };
                        items.push(errorItem);
                    }
                    
                    if (testResult.stackTrace) {
                        const stackItem = new ImpactViewItem(
                            'Stack Trace',
                            'test-result-stack',
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        stackItem.iconPath = new vscode.ThemeIcon('list');
                        stackItem.description = 'Click to expand';
                        stackItem.analysisResult = { stackTrace: testResult.stackTrace };
                        items.push(stackItem);
                    }
                    
                    if (testResult.output) {
                        const outputItem = new ImpactViewItem(
                            'Test Output',
                            'test-result-output',
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        outputItem.iconPath = new vscode.ThemeIcon('output');
                        outputItem.description = 'Click to expand';
                        outputItem.analysisResult = { output: testResult.output };
                        items.push(outputItem);
                    }
                    
                    // Add separator before run test option
                    const separatorItem = new ImpactViewItem(
                        '─',
                        'separator',
                        vscode.TreeItemCollapsibleState.None
                    );
                    separatorItem.description = '';
                    items.push(separatorItem);
                }
                
                // Always show "Run Test" option (to re-run or run if not run yet)
                const runTestItem = new ImpactViewItem(
                    testResult ? `🔄 Run Test Again: ${require('path').basename(issue.file)}` : `▶️ Run Test: ${require('path').basename(issue.file)}`,
                    'run-single-test',
                    vscode.TreeItemCollapsibleState.None
                );
                runTestItem.iconPath = new vscode.ThemeIcon('play');
                runTestItem.description = 'Execute this test file';
                runTestItem.analysisResult = { testFile: issue.file };
                runTestItem.command = {
                    command: 'impactAnalyzer.runAffectedTests',
                    title: 'Run Test',
                    arguments: [[issue.file]]
                };
                items.push(runTestItem);
                
                // Add separator if there are also fixes
                if (issue.recommendedFixes && issue.recommendedFixes.length > 0) {
                    const separatorItem2 = new ImpactViewItem(
                        '─',
                        'separator',
                        vscode.TreeItemCollapsibleState.None
                    );
                    separatorItem2.description = '';
                    items.push(separatorItem2);
                }
            }
            
            if (issue && issue.recommendedFixes && issue.recommendedFixes.length > 0) {
                const fixesItem = new ImpactViewItem(
                    `Recommended Fixes (${issue.recommendedFixes.length})`,
                    'breaking-fixes',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                fixesItem.iconPath = new vscode.ThemeIcon('lightbulb');
                fixesItem.description = 'Click to view';
                fixesItem.analysisResult = { fixes: issue.recommendedFixes };
                items.push(fixesItem);
            }
        } else if (detailElement.type === 'test-result-error') {
            // Show full error message
            const errorMessage = detailElement.analysisResult.errorMessage || '';
            const errorLines = errorMessage.split('\n').filter((line: string) => line.trim().length > 0);
            for (const line of errorLines) {
                const errorLineItem = new ImpactViewItem(
                    line.substring(0, 200),
                    'test-result-error-line',
                    vscode.TreeItemCollapsibleState.None
                );
                errorLineItem.iconPath = new vscode.ThemeIcon('circle-small');
                items.push(errorLineItem);
            }
        } else if (detailElement.type === 'test-result-stack') {
            // Show stack trace
            const stackTrace = detailElement.analysisResult.stackTrace || '';
            const stackLines = stackTrace.split('\n').filter((line: string) => line.trim().length > 0);
            for (const line of stackLines) {
                const stackLineItem = new ImpactViewItem(
                    line.substring(0, 200),
                    'test-result-stack-line',
                    vscode.TreeItemCollapsibleState.None
                );
                stackLineItem.iconPath = new vscode.ThemeIcon('circle-small');
                items.push(stackLineItem);
            }
        } else if (detailElement.type === 'test-result-output') {
            // Show test output
            const output = detailElement.analysisResult.output || '';
            const outputLines = output.split('\n').filter((line: string) => line.trim().length > 0);
            // Limit to first 50 lines to avoid overwhelming the UI
            const displayLines = outputLines.slice(0, 50);
            for (const line of displayLines) {
                const outputLineItem = new ImpactViewItem(
                    line.substring(0, 200),
                    'test-result-output-line',
                    vscode.TreeItemCollapsibleState.None
                );
                outputLineItem.iconPath = new vscode.ThemeIcon('circle-small');
                items.push(outputLineItem);
            }
            if (outputLines.length > 50) {
                const moreItem = new ImpactViewItem(
                    `... and ${outputLines.length - 50} more lines (see output channel)`,
                    'test-result-more',
                    vscode.TreeItemCollapsibleState.None
                );
                moreItem.iconPath = new vscode.ThemeIcon('info');
                items.push(moreItem);
            }
        } else if (detailElement.type === 'breaking-fixes') {
            // Show individual fix recommendations
            const fixes = context.fixes || [];
            for (let i = 0; i < fixes.length; i++) {
                const fixItem = new ImpactViewItem(
                    `${i + 1}. ${fixes[i]}`,
                    'fix',
                    vscode.TreeItemCollapsibleState.None
                );
                fixItem.iconPath = new vscode.ThemeIcon('check');
                fixItem.description = 'Recommended fix';
                items.push(fixItem);
            }
        } else if (detailElement.type === 'functions') {
            for (const func of safeResult.changedFunctions || []) {
                const funcItem = new ImpactViewItem(
                    func,
                    'function',
                    vscode.TreeItemCollapsibleState.None
                );
                funcItem.iconPath = new vscode.ThemeIcon('symbol-function');
                items.push(funcItem);
            }
        } else if (detailElement.type === 'classes') {
            for (const cls of safeResult.changedClasses || []) {
                const classItem = new ImpactViewItem(
                    cls,
                    'class',
                    vscode.TreeItemCollapsibleState.None
                );
                classItem.iconPath = new vscode.ThemeIcon('symbol-class');
                items.push(classItem);
            }
        } else if (detailElement.type === 'tests') {
            for (const test of safeResult.affectedTests || []) {
                const testItem = new ImpactViewItem(
                    require('path').basename(test),
                    'test',
                    vscode.TreeItemCollapsibleState.None
                );
                testItem.iconPath = new vscode.ThemeIcon('beaker');
                testItem.description = test;
                items.push(testItem);
            }
        } else if (detailElement.type === 'downstream') {
            for (const component of safeResult.downstreamComponents || []) {
                const componentItem = new ImpactViewItem(
                    require('path').basename(component),
                    'component',
                    vscode.TreeItemCollapsibleState.None
                );
                componentItem.iconPath = new vscode.ThemeIcon('arrow-down');
                componentItem.description = component;
                items.push(componentItem);
            }
        } else if (detailElement.type === 'confidence') {
            // Display all 6 confidence metrics
            const confidenceResult = safeResult.confidenceResult;
            if (!confidenceResult) {
                return items;
            }

            for (const metric of confidenceResult.metrics) {
                const metricItem = new ImpactViewItem(
                    `${metric.statusIcon} ${metric.name}: ${metric.score}/100`,
                    'confidence-metric',
                    metric.weight > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
                );
                metricItem.analysisResult = { metric, confidenceResult, filePath: safeResult.filePath };
                metricItem.iconPath = new vscode.ThemeIcon('circle-outline');
                metricItem.description = `Weight: ${(metric.weight * 100).toFixed(0)}%`;
                metricItem.tooltip = metric.summary;
                
                // Add context value for sorting/grouping
                metricItem.contextValue = `confidence-metric-${metric.name.toLowerCase().replace(/\s+/g, '-')}`;
                items.push(metricItem);
            }
        } else if (detailElement.type === 'confidence-metric') {
            // Show sub-metrics and suggestions for each metric
            const metric = detailElement.analysisResult.metric;
            const filePath = detailElement.analysisResult.filePath || safeResult.filePath || '';
            
            // Summary
            const summaryItem = new ImpactViewItem(
                `Summary: ${metric.summary}`,
                'metric-detail',
                vscode.TreeItemCollapsibleState.None
            );
            summaryItem.iconPath = new vscode.ThemeIcon('info');
            items.push(summaryItem);

            // Issues with line numbers (for Code Correctness sub-metrics)
            if (metric.subMetrics) {
                // Check if this is Code Correctness metric with sub-metrics
                const subMetricKeys = Object.keys(metric.subMetrics);
                const hasLineNumbers = subMetricKeys.some(key => {
                    const subValue = metric.subMetrics[key] as any;
                    return subValue?.issues || subValue?.lineNumbers;
                });
                
                if (hasLineNumbers && metric.name === 'Code Correctness') {
                    // Show sub-metrics with issues
                    for (const [subKey, subValue] of Object.entries(metric.subMetrics)) {
                        const subMetric = subValue as any;
                        if (subMetric && (subMetric.issues || subMetric.lineNumbers)) {
                            const subMetricItem = new ImpactViewItem(
                                `${subKey}: ${subMetric.score}/100`,
                                'sub-metric-detail',
                                (subMetric.issues && subMetric.issues.length > 0) 
                                    ? vscode.TreeItemCollapsibleState.Collapsed 
                                    : vscode.TreeItemCollapsibleState.None
                            );
                            subMetricItem.analysisResult = { 
                                subMetric: subMetric,
                                subMetricName: subKey,
                                filePath: filePath
                            };
                            subMetricItem.iconPath = new vscode.ThemeIcon('circle-outline');
                            subMetricItem.description = `Weight: ${((subMetric.weight || 0) * 100).toFixed(0)}%`;
                            if (subMetric.issues && subMetric.issues.length > 0) {
                                subMetricItem.description += ` | ${subMetric.issues.length} issue(s)`;
                            }
                            items.push(subMetricItem);
                        }
                    }
                } else {
                    // Generic sub-metrics display
                    const subMetricsItem = new ImpactViewItem(
                        'Details',
                        'sub-metrics',
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    subMetricsItem.iconPath = new vscode.ThemeIcon('list-unordered');
                    subMetricsItem.analysisResult = { subMetrics: metric.subMetrics };
                    items.push(subMetricsItem);
                }
            }

            // Suggestions
            if (metric.suggestions && metric.suggestions.length > 0) {
                const suggestionsItem = new ImpactViewItem(
                    `Suggestions (${metric.suggestions.length})`,
                    'suggestions',
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                suggestionsItem.iconPath = new vscode.ThemeIcon('lightbulb');
                suggestionsItem.analysisResult = { suggestions: metric.suggestions };
                items.push(suggestionsItem);
            }
        } else if (detailElement.type === 'sub-metric-detail') {
            // Show issues with line numbers for Code Correctness sub-metrics
            const subMetric = detailElement.analysisResult.subMetric;
            const subMetricName = detailElement.analysisResult.subMetricName;
            const filePath = detailElement.analysisResult.filePath;
            
            if (subMetric.issues && Array.isArray(subMetric.issues)) {
                for (const issue of subMetric.issues) {
                    if (typeof issue === 'object' && issue.message && issue.line) {
                        const issueItem = new ImpactViewItem(
                            `Line ${issue.line}: ${issue.message}`,
                            'issue',
                            vscode.TreeItemCollapsibleState.None
                        );
                        issueItem.iconPath = new vscode.ThemeIcon('warning');
                        issueItem.description = `Line ${issue.line}`;
                        issueItem.command = {
                            command: 'vscode.open',
                            title: 'Go to Line',
                            arguments: [
                                vscode.Uri.file(filePath),
                                { selection: new vscode.Range(issue.line - 1, 0, issue.line - 1, 0) }
                            ]
                        };
                        items.push(issueItem);
                    } else if (typeof issue === 'string') {
                        // Fallback for string issues
                        const issueItem = new ImpactViewItem(
                            issue,
                            'issue',
                            vscode.TreeItemCollapsibleState.None
                        );
                        issueItem.iconPath = new vscode.ThemeIcon('warning');
                        items.push(issueItem);
                    }
                }
            }
            
            // Show line numbers if available but no issues
            if ((!subMetric.issues || subMetric.issues.length === 0) && subMetric.lineNumbers) {
                const lineNumbersItem = new ImpactViewItem(
                    `Affected lines: ${subMetric.lineNumbers.join(', ')}`,
                    'metric-detail',
                    vscode.TreeItemCollapsibleState.None
                );
                lineNumbersItem.iconPath = new vscode.ThemeIcon('list-unordered');
                items.push(lineNumbersItem);
            }
        } else if (detailElement.type === 'suggestions') {
            const suggestions = detailElement.analysisResult.suggestions;
            for (let i = 0; i < suggestions.length; i++) {
                const suggestionItem = new ImpactViewItem(
                    `${i + 1}. ${suggestions[i]}`,
                    'suggestion',
                    vscode.TreeItemCollapsibleState.None
                );
                suggestionItem.iconPath = new vscode.ThemeIcon('lightbulb');
                items.push(suggestionItem);
            }
        } else if (detailElement.type === 'sub-metrics') {
            const subMetrics = detailElement.analysisResult.subMetrics;
            for (const [key, value] of Object.entries(subMetrics)) {
                const subMetricItem = new ImpactViewItem(
                    `${key}: ${Array.isArray(value) ? value.length : value}`,
                    'sub-metric',
                    vscode.TreeItemCollapsibleState.None
                );
                subMetricItem.iconPath = new vscode.ThemeIcon('circle-small');
                subMetricItem.description = typeof value === 'object' ? JSON.stringify(value).substring(0, 50) : String(value);
                items.push(subMetricItem);
            }
        } else if (detailElement.type === 'metrics') {
            // Legacy metrics display
            const confidenceItem = new ImpactViewItem(
                `Confidence: ${Math.round((safeResult as any).confidence * 100)}%`,
                'metric',
                vscode.TreeItemCollapsibleState.None
            );
            confidenceItem.iconPath = new vscode.ThemeIcon('graph');
            items.push(confidenceItem);

            const timeItem = new ImpactViewItem(
                `Estimated Test Time: ${(safeResult as any).estimatedTestTime}s`,
                'metric',
                vscode.TreeItemCollapsibleState.None
            );
            timeItem.iconPath = new vscode.ThemeIcon('clock');
            items.push(timeItem);

            const riskItem = new ImpactViewItem(
                `Risk Level: ${(safeResult as any).riskLevel}`,
                'metric',
                vscode.TreeItemCollapsibleState.None
            );
            riskItem.iconPath = new vscode.ThemeIcon('warning');
            items.push(riskItem);
        }

        return items;
    }

    async updateAnalysisResult(result: ImpactAnalysisResult): Promise<void> {
        const previousEntry = this.latestEntriesByFile.get(result.filePath);
        const delta = this.computeDelta(previousEntry?.result, result);
        const entry: ImpactAnalysisEntry = {
            result,
            analyzedAt: Date.now(),
            delta
        };

        this.analysisEntries = this.analysisEntries.filter(existing => existing.result.filePath !== result.filePath);
        this.analysisEntries.unshift(entry);

        if (this.analysisEntries.length > 10) {
            this.analysisEntries = this.analysisEntries.slice(0, 10);
        }

        this.latestEntriesByFile.set(result.filePath, entry);
        this.refresh();
    }

    async updateAnalysisResults(results: ImpactAnalysisResult[]): Promise<void> {
        if (!Array.isArray(results) || results.length === 0) {
            return;
        }

        const newEntries: ImpactAnalysisEntry[] = [];
        const seenFiles = new Set<string>();

        for (const result of results) {
            const previousEntry = this.latestEntriesByFile.get(result.filePath);
            const delta = this.computeDelta(previousEntry?.result, result);
            const entry: ImpactAnalysisEntry = {
                result,
                analyzedAt: Date.now(),
                delta
            };
            newEntries.push(entry);
            this.latestEntriesByFile.set(result.filePath, entry);
            seenFiles.add(result.filePath);
        }

        const remainingEntries = this.analysisEntries.filter(entry => !seenFiles.has(entry.result.filePath));
        this.analysisEntries = [...newEntries, ...remainingEntries].slice(0, 10);
        this.refresh();
    }

    updateCiResults(payload: CiResultsPayload): void {
        this.ciResults = payload.builds;
        this.ciContext = {
            commitHash: payload.commitHash,
            lastUpdated: payload.fetchedAt
        };
        this.refresh();
    }

    getAffectedFiles(): string[] {
        const affectedFiles: string[] = [];
        for (const entry of this.analysisEntries) {
            const result = entry.result;
            if (result.affectedTests) {
                affectedFiles.push(...result.affectedTests);
            }
        }
        return [...new Set(affectedFiles)];
    }

    showHistory(): void {
        vscode.window.showInformationMessage(`Analysis History: ${this.analysisEntries.length} recent analyses`);
    }

    private formatRelativeTime(timestamp: number): string {
        const diffMs = Date.now() - timestamp;
        const absSeconds = Math.round(Math.abs(diffMs) / 1000);

        if (absSeconds < 60) {
            return `${absSeconds}s ago`;
        }

        const absMinutes = Math.round(absSeconds / 60);
        if (absMinutes < 60) {
            return `${absMinutes}m ago`;
        }

        const absHours = Math.round(absMinutes / 60);
        if (absHours < 24) {
            return `${absHours}h ago`;
        }

        const absDays = Math.round(absHours / 24);
        return `${absDays}d ago`;
    }

    private computeDelta(previous: ImpactAnalysisResult | undefined, current: ImpactAnalysisResult): ImpactDeltaSummary | undefined {
        if (!previous) {
            return undefined;
        }

        const functionDelta = this.computeArrayDelta(previous.changedFunctions || [], current.changedFunctions || []);
        const classDelta = this.computeArrayDelta(previous.changedClasses || [], current.changedClasses || []);
        const testDelta = this.computeArrayDelta(previous.affectedTests || [], current.affectedTests || []);
        const downstreamDelta = this.computeArrayDelta(previous.downstreamComponents || [], current.downstreamComponents || []);

        if (
            functionDelta.added.length === 0 && functionDelta.removed.length === 0 &&
            classDelta.added.length === 0 && classDelta.removed.length === 0 &&
            testDelta.added.length === 0 && testDelta.removed.length === 0 &&
            downstreamDelta.added.length === 0 && downstreamDelta.removed.length === 0
        ) {
            return undefined;
        }

        return {
            newFunctions: functionDelta.added,
            removedFunctions: functionDelta.removed,
            newClasses: classDelta.added,
            removedClasses: classDelta.removed,
            newTests: testDelta.added,
            removedTests: testDelta.removed,
            newDownstream: downstreamDelta.added,
            removedDownstream: downstreamDelta.removed
        };
    }

    private computeArrayDelta(previous: string[], current: string[]): { added: string[]; removed: string[] } {
        const previousSet = new Set(previous.map(item => item.trim()));
        const currentSet = new Set(current.map(item => item.trim()));

        const added = Array.from(currentSet).filter(item => !previousSet.has(item));
        const removed = Array.from(previousSet).filter(item => !currentSet.has(item));

        return { added, removed };
    }

    private deltaHasChanges(delta: ImpactDeltaSummary): boolean {
        return (
            delta.newFunctions.length > 0 ||
            delta.removedFunctions.length > 0 ||
            delta.newClasses.length > 0 ||
            delta.removedClasses.length > 0 ||
            delta.newTests.length > 0 ||
            delta.removedTests.length > 0 ||
            delta.newDownstream.length > 0 ||
            delta.removedDownstream.length > 0
        );
    }

    private buildDeltaSummary(delta: ImpactDeltaSummary): string {
        const parts: string[] = [];

        const append = (label: string, added: number, removed: number) => {
            if (added === 0 && removed === 0) {
                return;
            }
            const tokens: string[] = [];
            if (added > 0) {
                tokens.push(`+${added}`);
            }
            if (removed > 0) {
                tokens.push(`-${removed}`);
            }
            parts.push(`${label} ${tokens.join('/')}`);
        };

        append('fn', delta.newFunctions.length, delta.removedFunctions.length);
        append('cls', delta.newClasses.length, delta.removedClasses.length);
        append('tests', delta.newTests.length, delta.removedTests.length);
        append('deps', delta.newDownstream.length, delta.removedDownstream.length);

        return parts.join(', ');
    }

    private buildChangeSummary(result: ImpactAnalysisResult): string {
        const parts: string[] = [];

        if (result.changedFunctions && result.changedFunctions.length > 0) {
            parts.push(`${result.changedFunctions.length} function${result.changedFunctions.length !== 1 ? 's' : ''}`);
        }

        if (result.changedClasses && result.changedClasses.length > 0) {
            parts.push(`${result.changedClasses.length} class${result.changedClasses.length !== 1 ? 'es' : ''}`);
        }

        if (result.affectedTests && result.affectedTests.length > 0) {
            parts.push(`${result.affectedTests.length} test${result.affectedTests.length !== 1 ? 's' : ''}`);
        }

        if (result.downstreamComponents && result.downstreamComponents.length > 0) {
            parts.push(`${result.downstreamComponents.length} downstream`);
        }

        return parts.join(', ');
    }

    private buildFileTooltip(result: ImpactAnalysisResult, entry: ImpactAnalysisEntry): string {
        const lines: string[] = [];
        lines.push(result.filePath);

        const changeSummary = this.buildChangeSummary(result);
        if (changeSummary) {
            lines.push(`Changes: ${changeSummary}`);
        }

        if (result.confidenceResult) {
            lines.push(`Confidence: ${result.confidenceResult.statusIcon} ${result.confidenceResult.total}/100 (${result.confidenceResult.status})`);
        }

        if (entry.delta && this.deltaHasChanges(entry.delta)) {
            lines.push(`Δ ${this.buildDeltaSummary(entry.delta)}`);
        }

        lines.push(`Last analyzed: ${new Date(entry.analyzedAt).toLocaleString()}`);

        return lines.join('\n');
    }

    /**
     * Update test results for a test file
     */
    updateTestResults(testResults: TestResult[]): void {
        for (const result of testResults) {
            this.testResults.set(result.testFile, result);
        }
        this.refresh();
    }
}
