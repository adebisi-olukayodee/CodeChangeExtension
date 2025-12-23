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
exports.ConfidenceEngine = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const GitAnalyzer_1 = require("../analyzers/GitAnalyzer");
class ConfidenceEngine {
    constructor(configManager) {
        this.baselineCache = new Map();
        this.configManager = configManager;
        this.gitAnalyzer = new GitAnalyzer_1.GitAnalyzer();
        this.baselineDir = path.join(configManager.get('baselineDir', '.confidence-baselines') || '.confidence-baselines');
        this.loadBaselines();
    }
    /**
     * Analyze code change and return confidence score
     */
    async analyzeChange(change) {
        const metrics = [
            await this.metricCodeCorrectness(change),
            await this.metricSecurity(change),
            await this.metricTestValidation(change),
            await this.metricContractsArchitecture(change),
            await this.metricChangeRisk(change),
            await this.metricCodeHygiene(change)
        ];
        // Calculate weighted score (hygiene has weight 0, so it's informational only)
        const weightedSum = metrics.reduce((acc, m) => acc + m.score * m.weight, 0);
        const weightTotal = metrics.reduce((acc, m) => acc + m.weight, 0);
        const total = weightTotal > 0
            ? Math.max(0, Math.min(100, Math.round(weightedSum / weightTotal)))
            : 100;
        const status = this.classifyStatus(total);
        const statusIcon = this.getStatusIcon(status);
        // Save baseline for local files (baseline-based changes)
        // This ensures the baseline is updated after analysis completes
        // so future comparisons use the latest analyzed version
        if (!change.isFromGit) {
            this.saveBaseline(change.filePath, change.content);
            console.log(`[Confidence] Baseline saved for ${change.filePath}`);
        }
        return {
            total,
            statusIcon,
            status,
            metrics,
            changedLines: change.addedLines.length + change.modifiedLines.length,
            analyzedCode: change.content
        };
    }
    /**
     * Detect changes in a file (Git or local)
     */
    async detectChanges(filePath, currentContent, forceAnalysis = false) {
        try {
            const languageId = this.detectLanguage(filePath);
            // Allow plaintext files too - we'll still analyze them
            if (languageId === 'plaintext') {
                console.log(`[Confidence] File has unsupported extension, but analyzing anyway: ${filePath}`);
            }
            else {
                console.log(`[Confidence] Detected language: ${languageId} for ${filePath}`);
            }
            // Read current content if not provided
            if (!currentContent) {
                if (!fs.existsSync(filePath)) {
                    return null;
                }
                currentContent = fs.readFileSync(filePath, 'utf8');
            }
            // Check if Git-tracked
            const isGitRepo = await this.gitAnalyzer.isGitRepository();
            let change;
            if (isGitRepo) {
                // Git-based change detection
                const diff = await this.gitAnalyzer.getDiffForFile(filePath);
                if (diff && diff.trim().length > 0) {
                    // Check if it's a new untracked file (placeholder diff)
                    if (diff === 'new file') {
                        console.log(`[Confidence] New untracked file detected in Git repo`);
                        const allLines = currentContent.split('\n').map((_, i) => i + 1);
                        change = {
                            filePath,
                            languageId,
                            content: currentContent,
                            addedLines: allLines,
                            removedLines: [],
                            modifiedLines: [],
                            isFromGit: true,
                            hasActualChanges: true
                        };
                        console.log(`[Confidence] New untracked file: ${allLines.length} lines (hasActualChanges: true)`);
                    }
                    else {
                        console.log(`[Confidence] Git diff found, parsing...`);
                        const lines = this.parseGitDiff(diff);
                        if (lines.added.length > 0 || lines.removed.length > 0 || lines.modified.length > 0) {
                            change = {
                                filePath,
                                languageId,
                                content: currentContent,
                                addedLines: lines.added,
                                removedLines: lines.removed,
                                modifiedLines: lines.modified,
                                isFromGit: true,
                                hasActualChanges: true // Real changes detected
                            };
                            console.log(`[Confidence] Git change: +${lines.added.length} -${lines.removed.length} ~${lines.modified.length} lines (hasActualChanges: true)`);
                        }
                        else {
                            // Diff exists but no actual line changes - try baseline fallback
                            console.log(`[Confidence] Git diff found but no line changes - trying baseline fallback`);
                            const baseline = this.getBaseline(filePath);
                            if (baseline) {
                                const baselineDiff = this.computeLineDiff(baseline.content, currentContent);
                                if (baselineDiff.added.length > 0 || baselineDiff.removed.length > 0 || baselineDiff.modified.length > 0) {
                                    change = {
                                        filePath,
                                        languageId,
                                        content: currentContent,
                                        originalContent: baseline.content,
                                        addedLines: baselineDiff.added,
                                        removedLines: baselineDiff.removed,
                                        modifiedLines: baselineDiff.modified,
                                        isFromGit: false,
                                        baselineHash: baseline.hash,
                                        hasActualChanges: true
                                    };
                                    console.log(`[Confidence] Baseline diff: +${baselineDiff.added.length} -${baselineDiff.removed.length} ~${baselineDiff.modified.length} lines (hasActualChanges: true)`);
                                }
                                else {
                                    console.log(`[Confidence] No changes detected (Git diff empty, baseline same)`);
                                    return null;
                                }
                            }
                            else {
                                // No baseline yet - create one for next time
                                console.log(`[Confidence] No baseline found - creating baseline for future comparisons`);
                                this.saveBaseline(filePath, currentContent);
                                return null;
                            }
                        }
                    }
                }
                else {
                    // No git diff found - try comparing with HEAD first (most reliable)
                    console.log(`[Confidence] No git diff found - comparing with HEAD commit`);
                    try {
                        const headContent = await this.gitAnalyzer.getFileContentFromHEAD(filePath);
                        if (headContent && headContent !== currentContent) {
                            // File has changed from HEAD
                            const headDiff = this.computeLineDiff(headContent, currentContent);
                            if (headDiff.added.length > 0 || headDiff.removed.length > 0 || headDiff.modified.length > 0) {
                                change = {
                                    filePath,
                                    languageId,
                                    content: currentContent,
                                    originalContent: headContent,
                                    addedLines: headDiff.added,
                                    removedLines: headDiff.removed,
                                    modifiedLines: headDiff.modified,
                                    isFromGit: true,
                                    hasActualChanges: true
                                };
                                console.log(`[Confidence] HEAD diff: +${headDiff.added.length} -${headDiff.removed.length} ~${headDiff.modified.length} lines (hasActualChanges: true)`);
                            }
                            else {
                                console.log(`[Confidence] No changes detected (HEAD content same as current)`);
                                // Update baseline to current state
                                this.saveBaseline(filePath, currentContent);
                                return null;
                            }
                        }
                        else if (!headContent) {
                            // File doesn't exist in HEAD - check baseline
                            console.log(`[Confidence] File not in HEAD - trying baseline fallback`);
                            const baseline = this.getBaseline(filePath);
                            if (baseline) {
                                const baselineDiff = this.computeLineDiff(baseline.content, currentContent);
                                if (baselineDiff.added.length > 0 || baselineDiff.removed.length > 0 || baselineDiff.modified.length > 0) {
                                    change = {
                                        filePath,
                                        languageId,
                                        content: currentContent,
                                        originalContent: baseline.content,
                                        addedLines: baselineDiff.added,
                                        removedLines: baselineDiff.removed,
                                        modifiedLines: baselineDiff.modified,
                                        isFromGit: false,
                                        baselineHash: baseline.hash,
                                        hasActualChanges: true
                                    };
                                    console.log(`[Confidence] Baseline diff: +${baselineDiff.added.length} -${baselineDiff.removed.length} ~${baselineDiff.modified.length} lines (hasActualChanges: true)`);
                                }
                                else {
                                    console.log(`[Confidence] No changes detected (baseline same)`);
                                    return null;
                                }
                            }
                            else {
                                // New file - treat all lines as added
                                console.log(`[Confidence] New file not in HEAD and no baseline - treating as new file`);
                                const allLines = currentContent.split('\n').map((_, i) => i + 1);
                                change = {
                                    filePath,
                                    languageId,
                                    content: currentContent,
                                    addedLines: allLines,
                                    removedLines: [],
                                    modifiedLines: [],
                                    isFromGit: true,
                                    hasActualChanges: true
                                };
                                console.log(`[Confidence] New file detected: ${allLines.length} lines (hasActualChanges: true)`);
                            }
                        }
                        else {
                            // File matches HEAD - no changes
                            console.log(`[Confidence] No changes detected (file matches HEAD)`);
                            // Update baseline to match HEAD
                            this.saveBaseline(filePath, currentContent);
                            return null;
                        }
                    }
                    catch (error) {
                        console.log(`[Confidence] Error comparing with HEAD: ${error} - trying baseline fallback`);
                        // Fallback to baseline comparison
                        const baseline = this.getBaseline(filePath);
                        if (baseline) {
                            const baselineDiff = this.computeLineDiff(baseline.content, currentContent);
                            if (baselineDiff.added.length > 0 || baselineDiff.removed.length > 0 || baselineDiff.modified.length > 0) {
                                change = {
                                    filePath,
                                    languageId,
                                    content: currentContent,
                                    originalContent: baseline.content,
                                    addedLines: baselineDiff.added,
                                    removedLines: baselineDiff.removed,
                                    modifiedLines: baselineDiff.modified,
                                    isFromGit: false,
                                    baselineHash: baseline.hash,
                                    hasActualChanges: true
                                };
                                console.log(`[Confidence] Baseline diff: +${baselineDiff.added.length} -${baselineDiff.removed.length} ~${baselineDiff.modified.length} lines (hasActualChanges: true)`);
                            }
                            else {
                                console.log(`[Confidence] No changes detected (baseline same)`);
                                return null;
                            }
                        }
                        else {
                            // No baseline - create one for next time
                            console.log(`[Confidence] No baseline found - creating baseline for future comparisons`);
                            this.saveBaseline(filePath, currentContent);
                            return null;
                        }
                    }
                }
            }
            else {
                // Local file change detection using baseline
                const baseline = this.getBaseline(filePath);
                if (baseline) {
                    const diff = this.computeLineDiff(baseline.content, currentContent);
                    // Check if there are actual changes
                    if (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) {
                        change = {
                            filePath,
                            languageId,
                            content: currentContent,
                            originalContent: baseline.content,
                            addedLines: diff.added,
                            removedLines: diff.removed,
                            modifiedLines: diff.modified,
                            isFromGit: false,
                            baselineHash: baseline.hash,
                            hasActualChanges: true // Real changes detected
                        };
                        console.log(`[Confidence] Baseline diff: +${diff.added.length} -${diff.removed.length} ~${diff.modified.length} lines (hasActualChanges: true)`);
                    }
                    else {
                        // No changes found - return null
                        console.log(`[Confidence] No baseline changes found`);
                        return null;
                    }
                }
                else {
                    // No baseline - could be new file or untracked file
                    // Only treat as new file if it's not in Git (untracked)
                    // If it's in Git but no baseline, it means no changes from HEAD
                    const isUntracked = await this.gitAnalyzer.isFileUntracked(filePath);
                    if (isUntracked) {
                        // New untracked file - consider as actual change
                        console.log(`[Confidence] No baseline found - new untracked file detected`);
                        const allLines = currentContent.split('\n').map((_, i) => i + 1);
                        change = {
                            filePath,
                            languageId,
                            content: currentContent,
                            addedLines: allLines,
                            removedLines: [],
                            modifiedLines: [],
                            isFromGit: false,
                            hasActualChanges: true // New file is considered actual change
                        };
                        console.log(`[Confidence] New untracked file detected: ${allLines.length} lines (hasActualChanges: true)`);
                    }
                    else {
                        // File is tracked in Git but no baseline - means no changes
                        console.log(`[Confidence] No baseline found - file tracked in Git but no changes`);
                        return null;
                    }
                }
            }
            return change;
        }
        catch (error) {
            console.error(`Error detecting changes for ${filePath}:`, error);
            return null;
        }
    }
    /**
     * METRIC 1 — CODE CORRECTNESS (10%)
     *
     * Evaluates: syntax validity, type safety, static bugs, complexity, style, safety guards
     * Returns weighted aggregate of 6 sub-metrics
     */
    async metricCodeCorrectness(change) {
        const changedCode = this.extractChangedCode(change);
        const uri = vscode.Uri.file(change.filePath);
        let diagnostics = vscode.languages.getDiagnostics(uri);
        const changedLines = [...change.addedLines, ...change.modifiedLines];
        const allLines = change.content.split('\n');
        console.log(`[CodeCorrectness] Analyzing file: ${change.filePath}`);
        console.log(`[CodeCorrectness] Total diagnostics: ${diagnostics.length}`);
        console.log(`[CodeCorrectness] Changed lines: ${changedLines.length} (${changedLines.slice(0, 10).join(', ')}...)`);
        // Only filter diagnostics to changed lines - we only analyze changes
        const relevantDiagnostics = diagnostics.filter(d => this.isDiagnosticInChangedLines(d, changedLines));
        console.log(`[CodeCorrectness] Relevant diagnostics: ${relevantDiagnostics.length} (only on changed lines)`);
        // Sub-metric 1: Syntax & Parse Validity (25%)
        const syntaxResult = this.subMetricSyntaxValidity(relevantDiagnostics, changedCode, change, allLines);
        // Sub-metric 2: Type Safety (20%)
        const typeSafetyResult = this.subMetricTypeSafety(relevantDiagnostics, changedCode, change, allLines);
        // Sub-metric 3: Critical Static Bugs (25%)
        const staticBugResult = this.subMetricCriticalStaticBugs(relevantDiagnostics, changedCode, change, allLines);
        // Sub-metric 4: Code Smells & Complexity (15%)
        const complexityResult = this.subMetricComplexity(changedCode, change, allLines);
        // Sub-metric 5: Standards & Style Violations (10%)
        const styleResult = this.subMetricStyleViolations(relevantDiagnostics, changedCode, change, allLines);
        // Sub-metric 6: Safety Guards (5%)
        const safetyGuardResult = this.subMetricSafetyGuards(changedCode, change, allLines);
        // Weighted aggregation
        const codeCorrectnessScore = Math.round(syntaxResult.score * 0.25 +
            typeSafetyResult.score * 0.20 +
            staticBugResult.score * 0.25 +
            complexityResult.score * 0.15 +
            styleResult.score * 0.10 +
            safetyGuardResult.score * 0.05);
        const finalScore = Math.max(0, Math.min(100, codeCorrectnessScore));
        // Collect all issues for summary (count unique issues)
        const allIssues = [];
        allIssues.push(...(syntaxResult.issues || []));
        allIssues.push(...(typeSafetyResult.issues || []));
        allIssues.push(...(staticBugResult.issues || []));
        allIssues.push(...(complexityResult.issues || []));
        allIssues.push(...(styleResult.issues || []));
        allIssues.push(...(safetyGuardResult.issues || []));
        const issueCount = allIssues.length;
        const subMetrics = {
            syntax: {
                score: syntaxResult.score,
                weight: 0.25,
                issues: syntaxResult.issues || [],
                lineNumbers: syntaxResult.lineNumbers || []
            },
            typeSafety: {
                score: typeSafetyResult.score,
                weight: 0.20,
                issues: typeSafetyResult.issues || [],
                lineNumbers: typeSafetyResult.lineNumbers || []
            },
            staticBugs: {
                score: staticBugResult.score,
                weight: 0.25,
                issues: staticBugResult.issues || [],
                lineNumbers: staticBugResult.lineNumbers || []
            },
            complexity: {
                score: complexityResult.score,
                weight: 0.15,
                issues: complexityResult.issues || [],
                lineNumbers: complexityResult.lineNumbers || []
            },
            style: {
                score: styleResult.score,
                weight: 0.10,
                issues: styleResult.issues || [],
                lineNumbers: styleResult.lineNumbers || []
            },
            safetyGuards: {
                score: safetyGuardResult.score,
                weight: 0.05,
                issues: safetyGuardResult.issues || [],
                lineNumbers: safetyGuardResult.lineNumbers || []
            }
        };
        // Determine status icon
        let statusIcon;
        if (finalScore >= 90) {
            statusIcon = '✅';
        }
        else if (finalScore >= 70) {
            statusIcon = '⚠️';
        }
        else if (finalScore >= 50) {
            statusIcon = '⚠️';
        }
        else {
            statusIcon = '❌';
        }
        return {
            name: 'Code Correctness',
            score: finalScore,
            statusIcon,
            summary: finalScore >= 90
                ? 'Excellent correctness - safe to commit'
                : finalScore >= 70
                    ? `${issueCount} minor issue(s) found - review recommended`
                    : finalScore >= 50
                        ? `Noticeable risk - ${issueCount} issue(s) found`
                        : `Critical problems - ${issueCount} issue(s) - block commit`,
            suggestions: [
                'Fix syntax and type errors before commit',
                'Remove unused or unsafe constructs',
                'Simplify control flow or refactor complex expressions',
                'Run auto-fix or apply style guide',
                'Add validation and null guards where needed'
            ],
            weight: 0.10,
            subMetrics
        };
    }
    /**
     * Helper: Find line number for a code pattern
     */
    findLineNumber(pattern, code, allLines, startLineOffset = 0) {
        const lines = [];
        const codeLines = code.split('\n');
        // Use global flag to find all matches
        const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
        codeLines.forEach((line, index) => {
            if (globalPattern.test(line)) {
                // Map changed code line index to actual file line number
                // startLineOffset is the line number where changed code starts
                const actualLineNum = startLineOffset > 0 ? startLineOffset + index : index + 1;
                if (!lines.includes(actualLineNum)) {
                    lines.push(actualLineNum);
                }
            }
        });
        return lines;
    }
    /**
     * Helper: Find line number for diagnostic
     */
    getDiagnosticLineNumber(diagnostic, change) {
        // Diagnostic range is 0-based, convert to 1-based
        return diagnostic.range.start.line + 1;
    }
    /**
     * Sub-metric 1: Syntax & Parse Validity (25%)
     */
    subMetricSyntaxValidity(diagnostics, changedCode, change, allLines) {
        let score = 100;
        const issues = [];
        const lineNumbers = [];
        console.log(`[Syntax] Checking ${diagnostics.length} diagnostics for syntax errors`);
        // Check for syntax/parse errors in diagnostics
        for (const diagnostic of diagnostics) {
            const severity = diagnostic.severity;
            const message = diagnostic.message.toLowerCase();
            if (severity === vscode.DiagnosticSeverity.Error &&
                (message.includes('syntax') || message.includes('parse') ||
                    message.includes('unexpected') || message.includes('expected') ||
                    message.includes('unclosed') || message.includes('missing') ||
                    message.includes('invalid') || message.includes('illegal'))) {
                score -= 40; // Critical syntax error
                const lineNum = this.getDiagnosticLineNumber(diagnostic, change);
                issues.push({
                    message: `Syntax error: ${diagnostic.message}`,
                    line: lineNum
                });
                lineNumbers.push(lineNum);
                console.log(`[Syntax] Found diagnostic error at line ${lineNum}: ${diagnostic.message}`);
            }
        }
        // Check for merge conflict markers - only in changed lines
        const conflictPattern = /(<<<<<<<|>>>>>>>|=======)/;
        const conflictMatches = [];
        // Only check changed lines
        const changedLineSet = new Set([...change.addedLines, ...change.modifiedLines]);
        changedLineSet.forEach(lineNum => {
            const lineIndex = lineNum - 1;
            if (lineIndex >= 0 && lineIndex < allLines.length) {
                const line = allLines[lineIndex];
                const match = line.match(conflictPattern);
                if (match) {
                    conflictMatches.push({ line: lineNum, marker: match[1] });
                }
            }
        });
        if (conflictMatches.length > 0) {
            score -= 40;
            conflictMatches.forEach(({ line }) => {
                issues.push({
                    message: 'Merge conflict markers detected',
                    line
                });
                lineNumbers.push(line);
            });
            console.log(`[Syntax] Found ${conflictMatches.length} merge conflict markers`);
        }
        // Check for unclosed brackets/braces - only in changed lines
        let openBrackets = 0;
        let closeBrackets = 0;
        const bracketIssues = [];
        // Only check changed lines
        changedLineSet.forEach(lineNum => {
            const lineIndex = lineNum - 1;
            if (lineIndex >= 0 && lineIndex < allLines.length) {
                const line = allLines[lineIndex];
                const lineOpen = (line.match(/[\(\[\{]/g) || []).length;
                const lineClose = (line.match(/[\)\]\}]/g) || []).length;
                openBrackets += lineOpen;
                closeBrackets += lineClose;
                // Check for obvious unclosed patterns in function definitions
                if (/function\s+\w+\s*\(/.test(line) && !/function\s+\w+\s*\([^)]*\)\s*\{/.test(line)) {
                    // Function declaration without closing brace - check next lines
                    let foundClosing = false;
                    for (let i = lineIndex + 1; i < Math.min(lineIndex + 10, allLines.length); i++) {
                        if (allLines[i].includes('}')) {
                            foundClosing = true;
                            break;
                        }
                    }
                    if (!foundClosing && lineIndex < allLines.length - 5) {
                        bracketIssues.push({ line: lineNum, message: 'Function may be missing closing brace' });
                    }
                }
            }
        });
        if (Math.abs(openBrackets - closeBrackets) > 2) {
            score -= 20;
            if (bracketIssues.length > 0) {
                bracketIssues.forEach(({ line, message }) => {
                    issues.push({ message, line });
                    lineNumbers.push(line);
                });
            }
            else {
                // Find first changed line as approximate location
                const firstChangedLine = Math.min(...change.addedLines, ...change.modifiedLines);
                issues.push({
                    message: `Potential unclosed brackets/braces (${openBrackets} open, ${closeBrackets} close)`,
                    line: firstChangedLine
                });
                lineNumbers.push(firstChangedLine);
            }
            console.log(`[Syntax] Bracket mismatch: ${openBrackets} open, ${closeBrackets} close`);
        }
        console.log(`[Syntax] Final score: ${score}, issues: ${issues.length}`);
        return {
            score: Math.max(0, Math.min(100, score)),
            issues,
            lineNumbers
        };
    }
    /**
     * Sub-metric 2: Type Safety (20%)
     */
    subMetricTypeSafety(diagnostics, changedCode, change, allLines) {
        let score = 100;
        const issues = [];
        const lineNumbers = [];
        // Check for type errors in diagnostics
        for (const diagnostic of diagnostics) {
            const severity = diagnostic.severity;
            const message = diagnostic.message.toLowerCase();
            if (severity === vscode.DiagnosticSeverity.Error &&
                (message.includes('type') || message.includes('typing') ||
                    message.includes('incompatible') || message.includes('assignment') ||
                    message.includes('property') || message.includes('method') ||
                    message.includes('parameter') || message.includes('argument'))) {
                score -= 20; // Major type error
                const lineNum = this.getDiagnosticLineNumber(diagnostic, change);
                issues.push({
                    message: `Type error: ${diagnostic.message}`,
                    line: lineNum
                });
                lineNumbers.push(lineNum);
            }
        }
        // Detect implicit any (TypeScript/JavaScript) - only in changed lines
        const implicitAnyPatterns = [
            { pattern: /:\s*any\b/, name: 'Explicit any type' },
            { pattern: /function\s+(\w+)\s*\(([^)]*)\)\s*\{/, name: 'Function without types', checkParams: true },
            { pattern: /\(([^)]*)\)\s*=>/, name: 'Arrow function without types', checkParams: true }
        ];
        let implicitAnyCount = 0;
        const implicitAnyLines = [];
        const changedLineSet = new Set([...change.addedLines, ...change.modifiedLines]);
        // Only check changed lines
        changedLineSet.forEach(lineNum => {
            const lineIndex = lineNum - 1;
            if (lineIndex >= 0 && lineIndex < allLines.length) {
                const line = allLines[lineIndex];
                for (const { pattern, name, checkParams } of implicitAnyPatterns) {
                    const match = line.match(pattern);
                    if (match) {
                        if (checkParams) {
                            // Check if parameters have types
                            const params = match[1] || match[2] || '';
                            if (params && !params.includes(':') && params.trim().length > 0) {
                                // Parameters without type annotations
                                implicitAnyCount++;
                                implicitAnyLines.push({
                                    line: lineNum,
                                    message: `${name}: parameters without types`
                                });
                            }
                        }
                        else {
                            // Explicit any type
                            implicitAnyCount++;
                            implicitAnyLines.push({
                                line: lineNum,
                                message: name
                            });
                        }
                        break; // Only count once per line
                    }
                }
            }
        });
        if (implicitAnyCount > 0) {
            score -= Math.min(15, implicitAnyCount * 5); // Penalize per instance
            implicitAnyLines.slice(0, 10).forEach(({ line, message }) => {
                issues.push({
                    message,
                    line
                });
                lineNumbers.push(line);
            });
            console.log(`[TypeSafety] Found ${implicitAnyCount} implicit any issues`);
        }
        // Detect potential null/undefined access
        const unsafeAccessPattern = /\.\w+\s*[(\[]|\[/;
        const hasGuards = /(?:if|assert|check|guard|validate)\s*\(.*?(?:null|undefined)/i.test(changedCode);
        if (unsafeAccessPattern.test(changedCode) && !hasGuards) {
            const unsafeLines = this.findLineNumber(unsafeAccessPattern, changedCode, allLines, Math.min(...change.addedLines, ...change.modifiedLines) - 1);
            if (unsafeLines.length > 0) {
                score -= 10;
                unsafeLines.slice(0, 3).forEach(line => {
                    issues.push({
                        message: 'Potential null/undefined access without checks',
                        line
                    });
                    lineNumbers.push(line);
                });
            }
        }
        return {
            score: Math.max(0, Math.min(100, score)),
            issues,
            lineNumbers
        };
    }
    /**
     * Sub-metric 3: Critical Static Bugs (25%)
     */
    subMetricCriticalStaticBugs(diagnostics, changedCode, change, allLines) {
        let score = 100;
        const issues = [];
        const lineNumbers = [];
        // Critical error diagnostics
        for (const diagnostic of diagnostics) {
            if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
                score -= 40; // Critical bug
                const lineNum = this.getDiagnosticLineNumber(diagnostic, change);
                issues.push({
                    message: `Critical error: ${diagnostic.message}`,
                    line: lineNum
                });
                lineNumbers.push(lineNum);
            }
        }
        // Detect unreachable code
        const unreachablePatterns = [
            /return\s+.*;\s*[\r\n]+[^}]*[^\s;}]/m,
            /throw\s+.*;\s*[\r\n]+[^}]*[^\s;}]/m,
            /break\s*;\s*[\r\n]+[^}]*[^\s;}]/m
        ];
        for (const pattern of unreachablePatterns) {
            if (pattern.test(changedCode)) {
                score -= 20;
                // Find the return/throw/break line
                const returnMatch = changedCode.match(/return\s+|throw\s+|break\s*/);
                if (returnMatch && returnMatch.index !== undefined) {
                    const lineIndex = changedCode.substring(0, returnMatch.index).split('\n').length - 1;
                    const lineNum = change.addedLines[lineIndex] || change.modifiedLines[lineIndex] ||
                        Math.min(...change.addedLines, ...change.modifiedLines);
                    issues.push({
                        message: 'Potential unreachable code detected',
                        line: lineNum
                    });
                    lineNumbers.push(lineNum);
                }
                break;
            }
        }
        // Detect missing return in function that should return
        const missingReturnPattern = /function\s+\w+\s*\([^)]*\)\s*:\s*\w+\s*\{|:\s*Promise<\w+>/;
        if (missingReturnPattern.test(changedCode)) {
            // Check if function has return statement
            const funcBody = changedCode.match(/\{[^}]*\}/);
            if (funcBody && !/return\s+/.test(funcBody[0])) {
                score -= 20;
                const funcLines = this.findLineNumber(/function\s+\w+\s*\(/, changedCode, allLines, Math.min(...change.addedLines, ...change.modifiedLines) - 1);
                const lineNum = funcLines[0] || Math.min(...change.addedLines, ...change.modifiedLines);
                issues.push({
                    message: 'Function may be missing return statement',
                    line: lineNum
                });
                lineNumbers.push(lineNum);
            }
        }
        // Detect unsafe eval/dynamic execution - only in changed lines
        const unsafeEvalPatterns = [
            { pattern: /\beval\s*\(/, name: 'eval()' },
            { pattern: /\bFunction\s*\(/, name: 'Function()' },
            { pattern: /\bnew\s+Function\s*\(/, name: 'new Function()' }
        ];
        const unsafeLines = [];
        const changedLineSet = new Set([...change.addedLines, ...change.modifiedLines]);
        // Only check changed lines
        changedLineSet.forEach(lineNum => {
            const lineIndex = lineNum - 1;
            if (lineIndex >= 0 && lineIndex < allLines.length) {
                const line = allLines[lineIndex];
                for (const { pattern, name } of unsafeEvalPatterns) {
                    if (pattern.test(line)) {
                        unsafeLines.push({ line: lineNum, name });
                        break; // Only count once per line
                    }
                }
            }
        });
        if (unsafeLines.length > 0) {
            score -= 40;
            unsafeLines.forEach(({ line, name }) => {
                issues.push({
                    message: `Unsafe ${name} detected`,
                    line
                });
                lineNumbers.push(line);
            });
            console.log(`[StaticBugs] Found ${unsafeLines.length} unsafe eval/Function calls`);
        }
        return {
            score: Math.max(0, Math.min(100, score)),
            issues,
            lineNumbers
        };
    }
    /**
     * Sub-metric 4: Code Smells & Complexity (15%)
     */
    subMetricComplexity(changedCode, change, allLines) {
        let score = 100;
        const issues = [];
        const lineNumbers = [];
        // Cyclomatic complexity (count control flow statements)
        const complexityKeywords = /(if|else\s+if|for|while|switch|catch|case|&&|\|\|)/g;
        const complexityMatches = changedCode.match(complexityKeywords);
        const complexityCount = complexityMatches ? complexityMatches.length : 0;
        // Threshold: more than 5 control flow statements in changed code
        if (complexityCount > 5) {
            score -= 15;
            // Find first occurrence of complexity
            const firstComplexityLine = this.findLineNumber(complexityKeywords, changedCode, allLines, Math.min(...change.addedLines, ...change.modifiedLines) - 1);
            const lineNum = firstComplexityLine[0] || Math.min(...change.addedLines, ...change.modifiedLines);
            issues.push({
                message: `High complexity (${complexityCount} control flow statements)`,
                line: lineNum
            });
            lineNumbers.push(lineNum);
        }
        // Detect deeply nested structures
        const changedCodeLines = changedCode.split('\n');
        let maxIndent = 0;
        let maxIndentLine = 0;
        changedCodeLines.forEach((line, idx) => {
            const indent = (line.match(/^(\s*)/)?.[1]?.length || 0);
            if (indent > maxIndent) {
                maxIndent = indent;
                maxIndentLine = idx;
            }
        });
        if (maxIndent > 20) {
            score -= 10;
            const lineNum = change.addedLines[maxIndentLine] || change.modifiedLines[maxIndentLine] ||
                Math.min(...change.addedLines, ...change.modifiedLines);
            issues.push({
                message: `Deeply nested code detected (indentation ${maxIndent} spaces > 20)`,
                line: lineNum
            });
            lineNumbers.push(lineNum);
        }
        // Detect long functions (heuristic: lines in changed code)
        const changedLineCount = change.addedLines.length + change.modifiedLines.length;
        if (changedLineCount > 50) {
            score -= 10;
            const lineNum = Math.min(...change.addedLines, ...change.modifiedLines);
            issues.push({
                message: `Large change (${changedLineCount} lines) - consider splitting`,
                line: lineNum
            });
            lineNumbers.push(lineNum);
        }
        // Detect duplicate code patterns (simple: repeated strings)
        const lines = changedCode.split('\n').filter(l => l.trim().length > 10);
        const lineCounts = new Map();
        lines.forEach((line, idx) => {
            const normalized = line.trim().substring(0, 40);
            if (!lineCounts.has(normalized)) {
                lineCounts.set(normalized, []);
            }
            const actualLineNum = change.addedLines[idx] || change.modifiedLines[idx] ||
                Math.min(...change.addedLines, ...change.modifiedLines) + idx;
            lineCounts.get(normalized).push({ line: actualLineNum, content: line });
        });
        for (const [normalized, occurrences] of lineCounts.entries()) {
            if (occurrences.length > 2) {
                score -= 5;
                issues.push({
                    message: `Potential code duplication detected (${occurrences.length} occurrences)`,
                    line: occurrences[0].line
                });
                lineNumbers.push(occurrences[0].line);
                break;
            }
        }
        return {
            score: Math.max(0, Math.min(100, score)),
            issues,
            lineNumbers
        };
    }
    /**
     * Sub-metric 5: Standards & Style Violations (10%)
     */
    subMetricStyleViolations(diagnostics, changedCode, change, allLines) {
        let score = 100;
        const issues = [];
        const lineNumbers = [];
        // Style warnings from diagnostics
        for (const diagnostic of diagnostics) {
            const severity = diagnostic.severity;
            if (severity === vscode.DiagnosticSeverity.Warning) {
                score -= 10; // Minor style violation
                const lineNum = this.getDiagnosticLineNumber(diagnostic, change);
                issues.push({
                    message: `Style violation: ${diagnostic.message}`,
                    line: lineNum
                });
                lineNumbers.push(lineNum);
            }
            else if (severity === vscode.DiagnosticSeverity.Information ||
                severity === vscode.DiagnosticSeverity.Hint) {
                score -= 3; // Info level
                const lineNum = this.getDiagnosticLineNumber(diagnostic, change);
                if (!issues.some(i => i.line === lineNum)) {
                    issues.push({
                        message: `Style hint: ${diagnostic.message}`,
                        line: lineNum
                    });
                    lineNumbers.push(lineNum);
                }
            }
        }
        // Detect inconsistent naming (simple checks)
        const camelCase = /[a-z]+[A-Z]/;
        const snakeCase = /[a-z]+_[a-z]/;
        const hasCamel = camelCase.test(changedCode);
        const hasSnake = snakeCase.test(changedCode);
        if (hasCamel && hasSnake) {
            score -= 5;
            const camelLines = this.findLineNumber(camelCase, changedCode, allLines, Math.min(...change.addedLines, ...change.modifiedLines) - 1);
            const snakeLines = this.findLineNumber(snakeCase, changedCode, allLines, Math.min(...change.addedLines, ...change.modifiedLines) - 1);
            const lineNum = (camelLines[0] || snakeLines[0]) || Math.min(...change.addedLines, ...change.modifiedLines);
            issues.push({
                message: 'Inconsistent naming convention (mixing camelCase and snake_case)',
                line: lineNum
            });
            lineNumbers.push(lineNum);
        }
        // Detect magic numbers
        const magicNumberPattern = /\b\d{3,}\b/;
        const hasConstants = /const\s+\w+\s*=\s*\d/.test(changedCode);
        if (magicNumberPattern.test(changedCode) && !hasConstants) {
            const magicLines = this.findLineNumber(magicNumberPattern, changedCode, allLines, Math.min(...change.addedLines, ...change.modifiedLines) - 1);
            if (magicLines.length > 0) {
                score -= 5;
                magicLines.slice(0, 3).forEach(line => {
                    issues.push({
                        message: 'Magic numbers detected - consider using named constants',
                        line
                    });
                    lineNumbers.push(line);
                });
            }
        }
        return {
            score: Math.max(0, Math.min(100, score)),
            issues,
            lineNumbers
        };
    }
    /**
     * Sub-metric 6: Safety Guards (5%)
     */
    subMetricSafetyGuards(changedCode, change, allLines) {
        let score = 100;
        const issues = [];
        const lineNumbers = [];
        // Check for presence of safety patterns
        const hasNullChecks = /(?:if|assert|guard|check)\s*\(.*?(?:null|undefined|\?\?)/i.test(changedCode);
        const hasValidation = /(?:validate|sanitize|check|assert)/i.test(changedCode);
        const hasErrorHandling = /(?:try|catch|error|exception)/i.test(changedCode);
        // Detect risky operations without guards
        const riskyOperations = [
            { pattern: /\.get\s*\(/, name: 'Array/Map.get()' },
            { pattern: /\[[^\]]+\]/, name: 'Array/index access' },
            { pattern: /\.split\s*\(/, name: 'String.split()' },
            { pattern: /JSON\.parse/, name: 'JSON.parse()' },
            { pattern: /eval\s*\(/, name: 'eval()' },
            { pattern: /Function\s*\(/, name: 'Function()' }
        ];
        const riskyOpsWithoutGuards = [];
        for (const { pattern, name } of riskyOperations) {
            const foundLines = this.findLineNumber(pattern, changedCode, allLines, Math.min(...change.addedLines, ...change.modifiedLines) - 1);
            for (const lineNum of foundLines) {
                // Check if there's a guard nearby (within 5 lines before)
                const lineIndex = allLines.findIndex((_, idx) => idx + 1 === lineNum);
                if (lineIndex !== -1) {
                    const contextStart = Math.max(0, lineIndex - 5);
                    const context = allLines.slice(contextStart, lineIndex).join('\n');
                    if (!/(?:if|assert|guard|check|validate)\s*\(/.test(context)) {
                        riskyOpsWithoutGuards.push({ line: lineNum, name });
                    }
                }
            }
        }
        if (riskyOpsWithoutGuards.length > 0 && !hasNullChecks) {
            score -= 15;
            riskyOpsWithoutGuards.slice(0, 5).forEach(({ line, name }) => {
                issues.push({
                    message: `${name} without safety guards`,
                    line
                });
                lineNumbers.push(line);
            });
        }
        else if (hasNullChecks || hasValidation) {
            // Bonus for having safety guards
            score = Math.min(100, score + 5);
        }
        // Check for async operations without error handling
        if (!hasErrorHandling && /async|Promise|await/.test(changedCode)) {
            const asyncLines = this.findLineNumber(/async|await|Promise/, changedCode, allLines, Math.min(...change.addedLines, ...change.modifiedLines) - 1);
            if (asyncLines.length > 0) {
                score -= 5;
                asyncLines.slice(0, 3).forEach(line => {
                    issues.push({
                        message: 'Async operations without error handling',
                        line
                    });
                    lineNumbers.push(line);
                });
            }
        }
        return {
            score: Math.max(0, Math.min(100, score)),
            issues,
            lineNumbers
        };
    }
    /**
     * METRIC 2 — SECURITY (25%)
     */
    async metricSecurity(change) {
        let score = 100;
        const issues = [];
        const vulnerabilities = [];
        const changedCode = this.extractChangedCode(change);
        // Hardcoded secrets detection
        const secretPatterns = [
            /(api[_-]?key|apikey)\s*[:=]\s*['"]([A-Za-z0-9_\-]{8,})['"]/i,
            /(secret|secret[_-]?key|secretkey)\s*[:=]\s*['"]([A-Za-z0-9_\-]{8,})['"]/i,
            /(token|access[_-]?token|bearer)\s*[:=]\s*['"]([A-Za-z0-9_\-]{20,})['"]/i,
            /(password|pwd|passwd)\s*[:=]\s*['"](.{6,})['"]/i,
            /(private[_-]?key|privatekey)\s*[:=]\s*['"]-----BEGIN/i
        ];
        for (const pattern of secretPatterns) {
            if (pattern.test(changedCode)) {
                score -= 50;
                vulnerabilities.push('High: Hardcoded secret detected');
                issues.push('Hardcoded secret found');
                break;
            }
        }
        // Insecure API usage
        const insecurePatterns = [
            { pattern: /eval\s*\(/, severity: 'high', name: 'eval() usage' },
            { pattern: /Function\s*\(/, severity: 'high', name: 'Function() constructor' },
            { pattern: /innerHTML\s*=/, severity: 'medium', name: 'innerHTML assignment' },
            { pattern: /dangerouslySetInnerHTML/, severity: 'medium', name: 'dangerouslySetInnerHTML' },
            { pattern: /new\s+Function\s*\(/, severity: 'high', name: 'Function constructor' },
            { pattern: /document\.write\s*\(/, severity: 'medium', name: 'document.write()' },
            { pattern: /localStorage\.[^=]*=/, severity: 'low', name: 'localStorage write' }
        ];
        for (const { pattern, severity, name } of insecurePatterns) {
            if (pattern.test(changedCode)) {
                if (severity === 'high') {
                    score -= 50;
                    vulnerabilities.push(`High: ${name}`);
                }
                else if (severity === 'medium') {
                    score -= 25;
                    vulnerabilities.push(`Medium: ${name}`);
                }
                else {
                    score -= 10;
                    vulnerabilities.push(`Low: ${name}`);
                }
                issues.push(name);
            }
        }
        // Missing input validation (simple heuristic)
        const inputPatterns = [
            /userInput|req\.body|req\.query|req\.params/i,
            /getParameter|getQueryString/i
        ];
        const hasInput = inputPatterns.some(p => p.test(changedCode));
        const hasValidation = /validate|sanitize|escape|encode/i.test(changedCode);
        if (hasInput && !hasValidation) {
            score -= 10;
            issues.push('Missing input validation');
            vulnerabilities.push('Low: Potential missing input validation');
        }
        score = Math.max(0, Math.min(100, score));
        return {
            name: 'Security',
            score,
            statusIcon: score < 50 ? '❌' : score < 80 ? '⚠️' : '✅',
            summary: vulnerabilities.length > 0
                ? `${vulnerabilities.length} vulnerability/vulnerabilities found`
                : 'No security issues detected',
            suggestions: [
                'Remove secrets and store in environment variables',
                'Use secure API wrappers or sanitization libraries',
                'Update vulnerable dependencies',
                'Implement proper input validation'
            ],
            weight: 0.25,
            subMetrics: { vulnerabilities, issues }
        };
    }
    /**
     * METRIC 3 — TEST VALIDATION (20%)
     */
    async metricTestValidation(change) {
        let score = 100;
        const issues = [];
        const subMetrics = {
            hasTestFile: false,
            coverage: 'unknown',
            newLogicDetected: false,
            testFailures: 0
        };
        // Check if this is a test file
        const isTestFile = /test|spec|__tests__/i.test(change.filePath);
        subMetrics.hasTestFile = isTestFile;
        if (isTestFile) {
            // If it's a test file, give bonus
            score = Math.min(110, score + 10); // Bonus capped at 100 in final
            return {
                name: 'Test Validation',
                score: 100,
                statusIcon: '✅',
                summary: 'Test file detected - new tests covering new logic',
                suggestions: [
                    'Ensure meaningful assertions exist for new logic',
                    'Rerun tests after fixing'
                ],
                weight: 0.20,
                subMetrics: { ...subMetrics, bonus: 10 }
            };
        }
        // Detect new logic in changed code
        const changedCode = this.extractChangedCode(change);
        const newLogicPatterns = [
            /(function|class|=>|if\s*\(|for\s*\(|while\s*\()/,
            /(def |class |async def )/
        ];
        const hasNewLogic = newLogicPatterns.some(p => p.test(changedCode));
        subMetrics.newLogicDetected = hasNewLogic;
        if (hasNewLogic) {
            // Check for nearby test files
            const testFiles = await this.findNearbyTestFiles(change.filePath);
            if (testFiles.length === 0) {
                score -= 40;
                issues.push('No test coverage for changed code');
                subMetrics.coverage = 'none';
            }
            else if (testFiles.length < 2) {
                score -= 20;
                issues.push('Partial test coverage (<60%)');
                subMetrics.coverage = 'partial';
            }
            else {
                subMetrics.coverage = 'good';
            }
        }
        // Check for test failures (would need test runner integration)
        // For now, this is a placeholder
        score = Math.max(0, Math.min(100, score));
        return {
            name: 'Test Validation',
            score,
            statusIcon: score < 50 ? '❌' : score < 80 ? '⚠️' : '✅',
            summary: issues.length > 0
                ? issues.join('; ')
                : 'Tests appear present or unchanged',
            suggestions: [
                'Add unit/integration tests for changed functions or branches',
                'Ensure meaningful assertions exist for new logic',
                'Rerun tests after fixing'
            ],
            weight: 0.20,
            subMetrics
        };
    }
    /**
     * METRIC 4 — CONTRACTS & ARCHITECTURE (15%)
     */
    async metricContractsArchitecture(change) {
        let score = 100;
        const issues = [];
        const subMetrics = {
            breakingChanges: [],
            architecturalViolations: [],
            backwardCompatibility: true
        };
        const changedCode = this.extractChangedCode(change);
        // Detect breaking API changes by comparing function/class signatures
        // Only flag as breaking if the signature actually changed, not just the body
        const signaturePatterns = [
            // TypeScript/JavaScript: export function name(params) or export class name
            /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)\s*\([^)]*\)/,
            /export\s+(?:default\s+)?class\s+(\w+)/,
            // CommonJS: module.exports = function name(params)
            /module\.exports\s*=\s*(?:function|class)\s*(\w+)\s*\([^)]*\)/,
            // CommonJS: exports.name = function(params)
            /exports\.(\w+)\s*=\s*(?:function|class)\s*\([^)]*\)/,
            // Java/C#: public class/interface name
            /public\s+(?:static\s+)?(?:class|interface|enum)\s+(\w+)/,
            // Python: def name(params)
            /def\s+(\w+)\s*\([^)]*\)/
        ];
        // Extract signatures from changed code
        const changedSignatures = [];
        for (const pattern of signaturePatterns) {
            const matches = changedCode.matchAll(new RegExp(pattern.source, 'gm'));
            for (const match of matches) {
                if (match[1]) {
                    changedSignatures.push({
                        name: match[1],
                        fullSignature: match[0]
                    });
                }
            }
        }
        let breakingChangeDetected = false;
        // If we found signatures in changed code, compare with original to see if they actually changed
        if (changedSignatures.length > 0 && change.originalContent) {
            for (const changedSig of changedSignatures) {
                // Extract signature from original content
                const originalPattern = new RegExp(`(?:export\\s+(?:default\\s+)?(?:function|class|const|let|var)\\s+${changedSig.name}\\s*\\([^)]*\\)|export\\s+(?:default\\s+)?class\\s+${changedSig.name}|module\\.exports\\s*=\\s*(?:function|class)\\s+${changedSig.name}\\s*\\([^)]*\\)|exports\\.${changedSig.name}\\s*=\\s*(?:function|class)\\s*\\([^)]*\\)|public\\s+(?:static\\s+)?(?:class|interface|enum)\\s+${changedSig.name}|def\\s+${changedSig.name}\\s*\\([^)]*\\))`, 'm');
                const originalMatch = change.originalContent.match(originalPattern);
                if (!originalMatch) {
                    // Function/class doesn't exist in original - might be new export
                    // Check if it's actually a new export or just in the changed code snippet
                    // For now, don't flag as breaking if signature exists elsewhere in file
                    const fullFilePattern = new RegExp(`(?:export\\s+(?:default\\s+)?(?:function|class|const|let|var)\\s+${changedSig.name}\\s*\\([^)]*\\)|export\\s+(?:default\\s+)?class\\s+${changedSig.name})`, 'm');
                    const existsInFile = fullFilePattern.test(change.content);
                    if (!existsInFile) {
                        // New export - not necessarily breaking
                        continue;
                    }
                }
                else {
                    // Compare signatures - normalize whitespace for comparison
                    const normalizedOriginal = originalMatch[0].replace(/\s+/g, ' ').trim();
                    const normalizedChanged = changedSig.fullSignature.replace(/\s+/g, ' ').trim();
                    if (normalizedOriginal !== normalizedChanged) {
                        // Signature actually changed - this is breaking!
                        score -= 40;
                        issues.push('Breaking change in public API');
                        subMetrics.breakingChanges.push(`Public API signature changed: ${changedSig.name}`);
                        breakingChangeDetected = true;
                        break; // Only flag once
                    }
                    // If signatures match, it's just a body change - not breaking
                }
            }
        }
        else if (changedSignatures.length > 0 && !change.originalContent) {
            // No original content to compare - check if changed code contains function signature
            // If the signature line itself was modified, it might be breaking
            // For now, be conservative and only flag if we can't compare
            // This is a heuristic - ideally we'd always have originalContent
        }
        // Architectural violations (simple heuristics)
        const archViolations = [
            { pattern: /from\s+['"]\.\.\/\.\.\/\.\./, name: 'Deep cross-layer import' },
            { pattern: /import.*['"]\.\.\/\.\.\/models/, name: 'Direct model access from UI layer' }
        ];
        for (const { pattern, name } of archViolations) {
            if (pattern.test(changedCode)) {
                score -= 20;
                issues.push(name);
                subMetrics.architecturalViolations.push(name);
            }
        }
        // Schema migrations or database changes (risky)
        if (/migration|ALTER TABLE|DROP TABLE|CREATE TABLE/i.test(changedCode)) {
            score -= 15;
            issues.push('Database schema change detected');
            subMetrics.backwardCompatibility = false;
        }
        score = Math.max(0, Math.min(100, score));
        return {
            name: 'Contracts & Architecture',
            score,
            statusIcon: score < 50 ? '❌' : score < 80 ? '⚠️' : '✅',
            summary: issues.length > 0
                ? issues.join('; ')
                : 'No obvious breaking changes',
            suggestions: [
                'Maintain backward-compatible function signatures',
                'Avoid cross-layer imports or hidden coupling',
                'Document breaking changes clearly'
            ],
            weight: 0.15,
            subMetrics
        };
    }
    /**
     * METRIC 5 — CHANGE RISK (10%)
     */
    async metricChangeRisk(change) {
        let score = 100;
        const issues = [];
        const subMetrics = {
            changeSize: 0,
            complexityDelta: 0,
            dependencyDepth: 0
        };
        const changeSize = change.addedLines.length + change.removedLines.length + change.modifiedLines.length;
        subMetrics.changeSize = changeSize;
        // Large change size
        if (changeSize > 200) {
            score -= 15;
            issues.push(`Large change (${changeSize} lines)`);
        }
        // Complexity delta (simple heuristic - count control flow statements)
        const changedCode = this.extractChangedCode(change);
        const complexityKeywords = /(if|else|for|while|switch|catch|try)\s*\(/g;
        const complexityCount = (changedCode.match(complexityKeywords) || []).length;
        const baselineComplexity = change.originalContent
            ? (change.originalContent.match(complexityKeywords) || []).length
            : 0;
        const complexityDelta = complexityCount - baselineComplexity;
        subMetrics.complexityDelta = complexityDelta;
        if (complexityDelta > 5) {
            score -= 20;
            issues.push(`Complexity spike (>25% increase, +${complexityDelta} control flow statements)`);
        }
        // Historical bug frequency (placeholder - would need Git history analysis)
        // For now, assume medium risk for large changes
        if (changeSize > 100) {
            score -= 20;
            issues.push('High historical bug risk (large file change)');
        }
        score = Math.max(0, Math.min(100, score));
        return {
            name: 'Change Risk',
            score,
            statusIcon: score < 50 ? '❌' : score < 80 ? '⚠️' : '✅',
            summary: issues.length > 0
                ? issues.join('; ')
                : 'Small change footprint',
            suggestions: [
                'Split large changes into smaller commits',
                'Add tests to high-risk modules',
                'Refactor to simplify complex logic'
            ],
            weight: 0.10,
            subMetrics
        };
    }
    /**
     * METRIC 6 — CODE HYGIENE (0%, informational)
     */
    async metricCodeHygiene(change) {
        let score = 100;
        const issues = [];
        const subMetrics = {
            formattingIssues: [],
            namingIssues: [],
            documentationIssues: []
        };
        const changedCode = this.extractChangedCode(change);
        const changedLines = changedCode.split('\n');
        // Formatting issues
        let hasTabs = false;
        let hasTrailingWhitespace = false;
        let inconsistentIndentation = false;
        for (const line of changedLines) {
            if (/\t/.test(line))
                hasTabs = true;
            if (/[\t ]+$/.test(line))
                hasTrailingWhitespace = true;
        }
        // Check indentation consistency
        const indentSizes = changedLines
            .filter(l => l.trim().length > 0)
            .map(l => l.match(/^(\s*)/)?.[1]?.length || 0);
        if (indentSizes.length > 1) {
            const uniqueSizes = new Set(indentSizes);
            if (uniqueSizes.size > 2) {
                inconsistentIndentation = true;
            }
        }
        if (hasTabs) {
            issues.push('Tabs detected (use spaces)');
            subMetrics.formattingIssues.push('tabs');
            score -= 10;
        }
        if (hasTrailingWhitespace) {
            issues.push('Trailing whitespace');
            subMetrics.formattingIssues.push('trailing-whitespace');
            score -= 5;
        }
        if (inconsistentIndentation) {
            issues.push('Inconsistent indentation');
            subMetrics.formattingIssues.push('indentation');
            score -= 5;
        }
        // Naming conventions (simple checks)
        const publicApiPattern = /(?:export|public)\s+(?:function|class|const)\s+([a-z_]+)/;
        if (publicApiPattern.test(changedCode)) {
            const match = changedCode.match(publicApiPattern);
            if (match && /^[a-z]/.test(match[1])) {
                // Potential naming issue (should be PascalCase for classes, camelCase for functions)
                issues.push('Potential naming convention issue');
                subMetrics.namingIssues.push('public-api-naming');
                score -= 5;
            }
        }
        // Missing documentation for public APIs
        const publicFunctions = changedCode.match(/(?:export|public)\s+function\s+(\w+)/g);
        if (publicFunctions) {
            for (const func of publicFunctions) {
                const funcName = func.match(/function\s+(\w+)/)?.[1];
                if (funcName) {
                    // Check if there's a comment before this function
                    const funcIndex = changedCode.indexOf(func);
                    const beforeFunc = changedCode.substring(Math.max(0, funcIndex - 200), funcIndex);
                    if (!/\/\*|\/\/|"""/.test(beforeFunc)) {
                        issues.push(`Missing documentation for ${funcName}`);
                        subMetrics.documentationIssues.push(funcName);
                        score -= 10;
                        break; // Only flag once
                    }
                }
            }
        }
        score = Math.max(0, Math.min(100, score));
        return {
            name: 'Code Hygiene',
            score,
            statusIcon: score >= 85 ? '✅' : score >= 70 ? '⚠️' : '❌',
            summary: issues.length > 0
                ? issues.join('; ')
                : 'All good',
            suggestions: [
                'Run code formatter (Prettier, Black, etc.)',
                'Add docstrings for new functions',
                'Use clear commit messages following team conventions'
            ],
            weight: 0,
            subMetrics
        };
    }
    // Helper methods
    classifyStatus(score) {
        if (score > 85)
            return 'high';
        if (score >= 70)
            return 'acceptable';
        if (score >= 50)
            return 'warning';
        return 'critical';
    }
    getStatusIcon(status) {
        if (status === 'high' || status === 'acceptable')
            return '✅';
        if (status === 'warning')
            return '⚠️';
        return '❌';
    }
    detectLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const langMap = {
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.cs': 'csharp',
            '.go': 'go',
            '.rs': 'rust'
        };
        return langMap[ext] || 'plaintext';
    }
    parseGitDiff(diff) {
        const lines = diff.split('\n');
        const added = [];
        const removed = [];
        const modified = [];
        let currentLine = 0;
        for (const line of lines) {
            if (line.startsWith('@@')) {
                const match = line.match(/\+(\d+)/);
                if (match) {
                    currentLine = parseInt(match[1]) - 1;
                }
            }
            else if (line.startsWith('+') && !line.startsWith('+++')) {
                currentLine++;
                added.push(currentLine);
            }
            else if (line.startsWith('-') && !line.startsWith('---')) {
                removed.push(currentLine + 1);
            }
            else if (line.startsWith(' ')) {
                currentLine++;
            }
        }
        return { added, removed, modified };
    }
    computeLineDiff(baseline, current) {
        const baselineLines = baseline.split('\n');
        const currentLines = current.split('\n');
        const added = [];
        const removed = [];
        const modified = [];
        const maxLines = Math.max(baselineLines.length, currentLines.length);
        for (let i = 0; i < maxLines; i++) {
            const baselineLine = baselineLines[i] || '';
            const currentLine = currentLines[i] || '';
            if (i >= baselineLines.length) {
                added.push(i + 1);
            }
            else if (i >= currentLines.length) {
                removed.push(i + 1);
            }
            else if (baselineLine !== currentLine) {
                modified.push(i + 1);
            }
        }
        return { added, removed, modified };
    }
    extractChangedCode(change) {
        const lines = change.content.split('\n');
        const changedLines = [...change.addedLines, ...change.modifiedLines]
            .map(lineNum => lines[lineNum - 1])
            .filter(line => line !== undefined);
        const extracted = changedLines.join('\n');
        // Debug logging
        console.log(`[Confidence] Extracted ${changedLines.length} changed lines (total: ${lines.length})`);
        console.log(`[Confidence] Changed line numbers: ${[...change.addedLines, ...change.modifiedLines].slice(0, 20).join(', ')}${[...change.addedLines, ...change.modifiedLines].length > 20 ? '...' : ''}`);
        return extracted;
    }
    isDiagnosticInChangedLines(diagnostic, changedLines) {
        const range = diagnostic.range;
        const startLine = range.start.line + 1; // Convert to 1-based
        const endLine = range.end.line + 1;
        return changedLines.some(line => line >= startLine && line <= endLine);
    }
    async findNearbyTestFiles(filePath) {
        const dir = path.dirname(filePath);
        const fileName = path.basename(filePath, path.extname(filePath));
        const testPatterns = [
            `${fileName}.test.*`,
            `${fileName}.spec.*`,
            `**/__tests__/**/${fileName}.*`
        ];
        const testFiles = [];
        for (const pattern of testPatterns) {
            try {
                const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, pattern), '**/node_modules/**');
                testFiles.push(...matches.map(uri => uri.fsPath));
            }
            catch (error) {
                // Pattern might not match any files
            }
        }
        return testFiles;
    }
    getBaseline(filePath) {
        return this.baselineCache.get(filePath) || null;
    }
    saveBaseline(filePath, content) {
        const hash = this.computeHash(content);
        this.baselineCache.set(filePath, {
            content,
            hash,
            timestamp: Date.now()
        });
        this.persistBaselines();
    }
    computeHash(content) {
        // Simple hash - in production, use crypto
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(16);
    }
    loadBaselines() {
        try {
            const baselineFile = path.join(this.baselineDir, 'baselines.json');
            if (fs.existsSync(baselineFile)) {
                const data = fs.readFileSync(baselineFile, 'utf8');
                const baselines = JSON.parse(data);
                for (const [filePath, baseline] of Object.entries(baselines)) {
                    this.baselineCache.set(filePath, baseline);
                }
            }
        }
        catch (error) {
            console.error('Error loading baselines:', error);
        }
    }
    persistBaselines() {
        try {
            if (!fs.existsSync(this.baselineDir)) {
                fs.mkdirSync(this.baselineDir, { recursive: true });
            }
            const baselineFile = path.join(this.baselineDir, 'baselines.json');
            const baselines = {};
            for (const [filePath, baseline] of this.baselineCache.entries()) {
                baselines[filePath] = baseline;
            }
            fs.writeFileSync(baselineFile, JSON.stringify(baselines, null, 2));
        }
        catch (error) {
            console.error('Error persisting baselines:', error);
        }
    }
}
exports.ConfidenceEngine = ConfidenceEngine;
//# sourceMappingURL=ConfidenceEngine.js.map