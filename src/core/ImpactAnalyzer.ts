import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationManager } from './ConfigurationManager';
import { CodeAnalyzer } from '../analyzers/CodeAnalyzer';
import { TestFinder } from '../analyzers/TestFinder';
import { DependencyAnalyzer } from '../analyzers/DependencyAnalyzer';
import { GitAnalyzer } from '../analyzers/GitAnalyzer';
import { ASTImpactAnalyzer } from '../analyzers/ASTImpactAnalyzer';
import { ProfessionalImpactAnalyzer } from '../analyzers/ProfessionalImpactAnalyzer';
import { analyzeImpact } from './PureImpactAnalyzer';
import { ImpactReport } from '../types/ImpactReport';

export interface ImpactAnalysisResult {
    filePath: string;
    changedFunctions: string[];
    changedClasses: string[];
    changedModules: string[];
    affectedTests: string[];
    downstreamComponents: string[];
    confidence: number;
    estimatedTestTime: number;
    coverageImpact: number;
    riskLevel: 'low' | 'medium' | 'high';
    timestamp: Date;
    gitChanges?: {
        added: string[];
        modified: string[];
        deleted: string[];
    };
}

export class ImpactAnalyzer {
    private configManager: ConfigurationManager;
    private codeAnalyzer: CodeAnalyzer;
    private testFinder: TestFinder;
    private dependencyAnalyzer: DependencyAnalyzer;
    private gitAnalyzer: GitAnalyzer;
    private astImpactAnalyzer: ASTImpactAnalyzer;
    private professionalImpactAnalyzer: ProfessionalImpactAnalyzer;
    private analysisCache: Map<string, ImpactAnalysisResult> = new Map();
    // Baseline cache: stores file content when first analyzed (before changes)
    private baselineCache: Map<string, string> = new Map();
    // Debug output channel
    private debugOutputChannel: vscode.OutputChannel | null = null;

    constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
        this.codeAnalyzer = new CodeAnalyzer();
        this.testFinder = new TestFinder();
        this.dependencyAnalyzer = new DependencyAnalyzer();
        this.gitAnalyzer = new GitAnalyzer();
        this.astImpactAnalyzer = new ASTImpactAnalyzer();
        this.professionalImpactAnalyzer = new ProfessionalImpactAnalyzer();
        // Create debug output channel
        this.debugOutputChannel = vscode.window.createOutputChannel('Impact Analyzer Debug');
    }

    private debugLog(message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage);
        if (this.debugOutputChannel) {
            this.debugOutputChannel.appendLine(logMessage);
        }
    }

    async analyzeFile(filePath: string): Promise<ImpactAnalysisResult> {
        try {
            this.debugLog(`========================================`);
            this.debugLog(`Analyzing file: ${filePath}`);
            this.debugLog(`Baseline cache size: ${this.baselineCache.size}`);
            this.debugLog(`Analysis cache size: ${this.analysisCache.size}`);

            // Get current file content (after) FIRST
            const after = fs.readFileSync(filePath, 'utf8');
            this.debugLog(`Current file content length: ${after.length} chars`);
            
            // Get baseline content (before) from baseline cache
            // If not in cache, this is the first analysis - store current as baseline
            let before = this.baselineCache.get(filePath);
            
            if (!before) {
                // First time analyzing this file - store current content as baseline
                this.debugLog(`⭐ FIRST ANALYSIS - Storing current content as baseline`);
                this.baselineCache.set(filePath, after);
                before = after; // No change on first analysis
                this.debugLog(`Baseline stored: ${before.length} chars`);
            } else {
                this.debugLog(`📋 USING CACHED BASELINE`);
                this.debugLog(`Baseline length: ${before.length} chars`);
                this.debugLog(`Current length: ${after.length} chars`);
            }
            
            // Direct buffer comparison - CHECK THIS FIRST before using analysis cache
            const areEqual = before === after;
            this.debugLog(`Buffer comparison: ${areEqual ? '✅ EQUAL' : '❌ DIFFERENT'}`);
            
            if (areEqual) {
                this.debugLog(`✅ BEFORE === AFTER - No changes detected, returning empty report`);
                // Show output channel and notification
                if (this.debugOutputChannel) {
                    this.debugOutputChannel.show();
                    // Also log to console for visibility
                    console.log('✅ Impact Analyzer: No changes detected - see "Impact Analyzer Debug" output panel');
                }
                // Return empty result immediately (don't use cached analysis result)
                const emptyResult: ImpactAnalysisResult = {
                    filePath,
                    changedFunctions: [],
                    changedClasses: [],
                    changedModules: [],
                    affectedTests: [],
                    downstreamComponents: [],
                    confidence: 1.0, // High confidence - we know there are no changes
                    estimatedTestTime: 0,
                    coverageImpact: 0,
                    riskLevel: 'low',
                    timestamp: new Date()
                };
                this.debugLog(`Returning empty result: 0 functions, 0 downstream, 0 tests`);
                this.debugLog(`========================================`);
                return emptyResult;
            }
            
            // File has changed - check analysis cache (but only if baseline comparison passed)
            const cacheKey = this.getCacheKey(filePath);
            if (this.configManager.get('cacheEnabled', true) && this.analysisCache.has(cacheKey)) {
                this.debugLog(`Using cached analysis result (file changed but analysis cached)`);
                return this.analysisCache.get(cacheKey)!;
            }
            
            // Find the difference
            const beforeLines = before.split('\n');
            const afterLines = after.split('\n');
            this.debugLog(`⚠️ BEFORE !== AFTER - Changes detected`);
            this.debugLog(`Before lines: ${beforeLines.length}, After lines: ${afterLines.length}`);
            
            // Show first difference
            for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i++) {
                if (beforeLines[i] !== afterLines[i]) {
                    this.debugLog(`First difference at line ${i + 1}:`);
                    this.debugLog(`  Before: ${beforeLines[i]?.substring(0, 80) || '(missing)'}`);
                    this.debugLog(`  After:  ${afterLines[i]?.substring(0, 80) || '(missing)'}`);
                    break;
                }
            }
            
            this.debugLog(`Using AST-based comparison`);

            // Use pure before/after comparison with AST-based change detection
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder found');
            }
            
            const projectRoot = workspaceFolder.uri.fsPath;
            const relativeFilePath = path.relative(projectRoot, filePath);
            
            this.debugLog(`Calling analyzeImpact() with:`);
            this.debugLog(`  File: ${relativeFilePath}`);
            this.debugLog(`  Before length: ${before.length}`);
            this.debugLog(`  After length: ${after.length}`);
            
            const report = await analyzeImpact({
                file: relativeFilePath,
                before: before,
                after: after,
                projectRoot: projectRoot
            }, (msg: string) => this.debugLog(`[PureImpactAnalyzer] ${msg}`));

            this.debugLog(`AST-based report received:`);
            this.debugLog(`  Functions: ${JSON.stringify(report.functions)}`);
            this.debugLog(`  Downstream: ${JSON.stringify(report.downstreamFiles)}`);
            this.debugLog(`  Tests: ${JSON.stringify(report.tests)}`);
            this.debugLog(`  Issues: ${report.issues.length}`);
            
            // Update baseline cache with current content for next analysis
            this.debugLog(`Updating baseline cache with current content`);
            this.baselineCache.set(filePath, after);
            this.debugLog(`Baseline cache updated. New size: ${this.baselineCache.size}`);
            
            // Show output channel
            if (this.debugOutputChannel) {
                this.debugOutputChannel.show();
                console.log('⚠️ Impact Analyzer: Changes detected - see "Impact Analyzer Debug" output panel');
            }

            // Transform ImpactReport to ImpactAnalysisResult
            const result: ImpactAnalysisResult = {
                filePath,
                changedFunctions: report.functions,
                changedClasses: [], // TODO: Extract from report if needed
                changedModules: [],
                affectedTests: report.tests,
                downstreamComponents: report.downstreamFiles,
                confidence: this.calculateConfidenceFromReport(report),
                estimatedTestTime: this.estimateTestTime(report.tests),
                coverageImpact: this.calculateCoverageImpactFromReport(report),
                riskLevel: this.calculateRiskLevelFromReport(report),
                timestamp: new Date()
            };

            // Cache result
            if (this.configManager.get('cacheEnabled', true)) {
                this.analysisCache.set(cacheKey, result);
            }

            console.log(`[ImpactAnalyzer] Analysis complete: ${report.functions.length} functions, ${report.downstreamFiles.length} downstream, ${report.tests.length} tests`);
            return result;
        } catch (error) {
            console.error(`Error analyzing file ${filePath}:`, error);
            throw new Error(`Failed to analyze ${filePath}: ${error}`);
        }
    }

    async analyzeWorkspace(): Promise<ImpactAnalysisResult[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const results: ImpactAnalysisResult[] = [];
        const sourceFiles = await this.findSourceFiles(workspaceFolder.uri.fsPath);
        
        for (const file of sourceFiles) {
            try {
                const result = await this.analyzeFile(file);
                results.push(result);
            } catch (error) {
                console.error(`Failed to analyze ${file}:`, error);
            }
        }
        
        return results;
    }

    async getAffectedTests(): Promise<string[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const sourceFiles = await this.findSourceFiles(workspaceFolder.uri.fsPath);
        const allAffectedTests = new Set<string>();

        for (const file of sourceFiles) {
            try {
                const result = await this.analyzeFile(file);
                result.affectedTests.forEach(test => allAffectedTests.add(test));
            } catch (error) {
                console.error(`Failed to analyze ${file}:`, error);
            }
        }

        return Array.from(allAffectedTests);
    }

    private async findSourceFiles(rootPath: string): Promise<string[]> {
        const files: string[] = [];
        const patterns = this.configManager.get('sourcePatterns', [
            '**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx', 
            '**/*.py', '**/*.java', '**/*.cs', '**/*.go', '**/*.rs'
        ]);

        for (const pattern of patterns) {
            const matches = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
            files.push(...matches.map(uri => uri.fsPath));
        }

        return files;
    }

    private getCacheKey(filePath: string): string {
        try {
            const stats = fs.statSync(filePath);
            return `${filePath}-${stats.mtime.getTime()}-${stats.size}`;
        } catch {
            return filePath;
        }
    }

    private calculateConfidence(codeAnalysis: any, affectedTests: string[]): number {
        let confidence = 0;
        
        // Base confidence on code analysis quality
        confidence += Math.min(codeAnalysis.functions.length * 0.1, 0.3);
        confidence += Math.min(codeAnalysis.classes.length * 0.1, 0.3);
        
        // Increase confidence if we found affected tests
        if (affectedTests.length > 0) {
            confidence += 0.4;
        }
        
        return Math.min(confidence, 1.0);
    }

    private calculateConfidenceFromReport(report: ImpactReport): number {
        let confidence = 0;
        
        // Base confidence on detected changes
        confidence += Math.min(report.functions.length * 0.1, 0.3);
        
        // Increase confidence if we found affected tests
        if (report.tests.length > 0) {
            confidence += 0.4;
        }
        
        // Increase confidence if we found downstream files
        if (report.downstreamFiles.length > 0) {
            confidence += 0.3;
        }
        
        return Math.min(confidence, 1.0);
    }

    private estimateTestTime(affectedTests: string[]): number {
        // Rough estimation: 100ms per test file
        return affectedTests.length * 100;
    }

    private calculateCoverageImpact(codeAnalysis: any, affectedTests: string[]): number {
        // Simple heuristic: more functions/classes = higher coverage impact
        const codeComplexity = codeAnalysis.functions.length + codeAnalysis.classes.length;
        return Math.min(codeComplexity * 5, 100);
    }

    private calculateCoverageImpactFromReport(report: ImpactReport): number {
        // Simple heuristic: more functions = higher coverage impact
        return Math.min(report.functions.length * 5, 100);
    }

    private calculateRiskLevel(codeAnalysis: any, downstreamComponents: string[]): 'low' | 'medium' | 'high' {
        const riskScore = codeAnalysis.functions.length + codeAnalysis.classes.length + downstreamComponents.length;
        
        if (riskScore <= 2) return 'low';
        if (riskScore <= 5) return 'medium';
        return 'high';
    }

    private calculateRiskLevelFromReport(report: ImpactReport): 'low' | 'medium' | 'high' {
        const riskScore = report.functions.length + report.downstreamFiles.length + report.tests.length;
        
        if (riskScore <= 2) return 'low';
        if (riskScore <= 5) return 'medium';
        return 'high';
    }

    private async analyzeActualChanges(filePath: string, currentContent: string): Promise<{ functions: string[], classes: string[], modules: string[] }> {
        try {
            // Get the diff to see what actually changed
            const diff = await this.gitAnalyzer.getDiffForFile(filePath);
            
            if (!diff) {
                // No diff available, fall back to analyzing current file
                const codeAnalysis = await this.codeAnalyzer.analyzeFile(filePath, currentContent);
                return {
                    functions: codeAnalysis.functions,
                    classes: codeAnalysis.classes,
                    modules: codeAnalysis.modules
                };
            }

            // Parse the diff to find changed lines
            const changedLines = this.parseChangedLines(diff);
            
            // Analyze current file to get all functions/classes
            const currentAnalysis = await this.codeAnalyzer.analyzeFile(filePath, currentContent);
            
            // If no specific changes detected, return empty arrays
            if (changedLines.length === 0) {
                console.log('No changed lines detected in diff, returning empty changes');
                return { functions: [], classes: [], modules: [] };
            }

            // TODO: Properly map functions/classes to line numbers and check if they're in changed lines
            // For now, if we have changed lines, we'll be conservative and include all functions/classes
            // This is a known limitation - the pure function approach is more accurate
            console.log(`Found ${changedLines.length} changed lines, analyzing all functions/classes (conservative approach)`);
            
            return {
                functions: currentAnalysis.functions,
                classes: currentAnalysis.classes,
                modules: currentAnalysis.modules
            };
        } catch (error) {
            console.error('Error analyzing actual changes:', error);
            // Fall back to analyzing current file
            const codeAnalysis = await this.codeAnalyzer.analyzeFile(filePath, currentContent);
            return {
                functions: codeAnalysis.functions,
                classes: codeAnalysis.classes,
                modules: codeAnalysis.modules
            };
        }
    }

    private parseChangedLines(diff: string): number[] {
        const changedLines: number[] = [];
        const lines = diff.split('\n');
        
        for (const line of lines) {
            // Look for lines that start with + or - (added/removed lines)
            if (line.startsWith('+') || line.startsWith('-')) {
                // Extract line number from diff format like "@@ -1,3 +1,4 @@" or "+123: content"
                const match = line.match(/^[+-](\d+)/);
                if (match) {
                    changedLines.push(parseInt(match[1]));
                }
            }
        }
        
        return changedLines;
    }

    clearCache(): void {
        this.analysisCache.clear();
    }

    /**
     * Clear baseline cache for a specific file (useful when file is saved/committed)
     */
    clearBaseline(filePath: string): void {
        this.baselineCache.delete(filePath);
        console.log(`[ImpactAnalyzer] Cleared baseline for: ${filePath}`);
    }

    /**
     * Clear all baselines (useful when workspace is reloaded)
     */
    clearAllBaselines(): void {
        this.baselineCache.clear();
        console.log(`[ImpactAnalyzer] Cleared all baselines`);
    }

    /**
     * Update baseline for a file (useful when file is saved)
     */
    updateBaseline(filePath: string, content: string): void {
        this.baselineCache.set(filePath, content);
        console.log(`[ImpactAnalyzer] Updated baseline for: ${filePath} (${content.length} chars)`);
    }

    getCachedResult(filePath: string): ImpactAnalysisResult | undefined {
        for (const [key, value] of this.analysisCache.entries()) {
            if (key.startsWith(filePath)) {
                return value;
            }
        }
        return undefined;
    }
}
