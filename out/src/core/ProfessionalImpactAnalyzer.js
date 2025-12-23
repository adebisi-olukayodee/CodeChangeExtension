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
exports.ProfessionalImpactAnalyzer = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Removed: import { ProfessionalImpactAnalyzer as ProfessionalAnalyzer } from '../analyzers/ProfessionalImpactAnalyzer';
// We use PureImpactAnalyzer instead
const GitAnalyzer_1 = require("../analyzers/GitAnalyzer");
const ConfidenceEngine_1 = require("./ConfidenceEngine");
const PureImpactAnalyzer_1 = require("./PureImpactAnalyzer");
const debug_logger_1 = require("./debug-logger");
class ProfessionalImpactAnalyzer {
    constructor(configManager) {
        this.analysisCache = new Map();
        // Baseline cache: stores file content when first analyzed (before changes)
        // NOTE: This is session-only (in-memory). On extension reload, cache is cleared.
        // This ensures we start fresh after reload, comparing against the current saved state.
        this.baselineCache = new Map();
        // Baseline ref SHA tracking: key = repoRoot|filePath|baselineMode|targetRef, value = commit SHA
        this.baselineRefShaByKey = new Map();
        // Baseline AST cache: key = repoRoot|filePath|commitSha|language, value = cached AST
        this.baselineASTCache = new Map();
        this.MAX_AST_CACHE_SIZE = 300; // LRU eviction threshold
        // Debug output channel
        this.debugOutputChannel = null;
        this.configManager = configManager;
        // NOTE: We're NOT using professionalAnalyzer anymore - using PureImpactAnalyzer instead
        // this.professionalAnalyzer = new ProfessionalAnalyzer();
        this.gitAnalyzer = new GitAnalyzer_1.GitAnalyzer();
        this.confidenceEngine = new ConfidenceEngine_1.ConfidenceEngine(configManager);
        // Create debug output channel
        this.debugOutputChannel = vscode.window.createOutputChannel('Impact Analyzer Debug');
        // Clear debug log file on extension activation and show location
        try {
            const { clearDebugLog, getDebugLogPath } = require('./debug-logger');
            clearDebugLog();
            const logPath = getDebugLogPath();
            console.log(`[Debug Logger] Log file location: ${logPath}`);
            this.debugLog(`Debug log file: ${logPath}`);
        }
        catch (error) {
            // Ignore if module not found
        }
    }
    debugLog(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [ProfessionalImpactAnalyzer] ${message}`;
        console.log(logMessage);
        if (this.debugOutputChannel) {
            this.debugOutputChannel.appendLine(logMessage);
        }
    }
    /**
     * Resolve the best available TextDocument for a file path
     * Resolution order: provided doc → open in VS Code → null (will use disk)
     */
    resolveDocument(filePath, providedDoc) {
        // If provided and matches, use it
        if (providedDoc && providedDoc.uri.fsPath === filePath) {
            return providedDoc;
        }
        // Try to find open document
        const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
        if (openDoc) {
            return openDoc;
        }
        return null;
    }
    /**
     * Generate baseline cache key: repoRoot|filePath|baselineMode|targetRef
     */
    async getBaselineCacheKey(filePath) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const repoRoot = workspaceFolder ? await this.getRepoRoot(workspaceFolder.uri.fsPath) : '';
        const baselineMode = this.configManager.getBaselineMode();
        const targetRef = baselineMode === 'pr' ? this.configManager.getPrTargetBranch() : 'HEAD';
        return `${repoRoot}|${filePath}|${baselineMode}|${targetRef}`;
    }
    /**
     * Generate AST cache key: repoRoot|filePath|commitSha|language
     */
    getASTCacheKey(filePath, commitSha, language) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const repoRoot = workspaceFolder ? workspaceFolder.uri.fsPath : '';
        return `${repoRoot}|${filePath}|${commitSha}|${language}`;
    }
    /**
     * Get Git repository root for a path
     */
    async getRepoRoot(startPath) {
        try {
            const repoRoot = await this.gitAnalyzer.getRepoRoot(startPath);
            if (repoRoot) {
                return repoRoot;
            }
        }
        catch (error) {
            // Ignore
        }
        // Fallback: use workspace root
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder ? workspaceFolder.uri.fsPath : '';
    }
    /**
     * Lazy Git state detection: check if HEAD SHA changed since last analysis
     * Returns true if baseline should be re-resolved
     */
    async shouldReResolveBaseline(filePath) {
        if (!this.configManager.get('gitIntegration', true)) {
            return false;
        }
        try {
            const baselineKey = await this.getBaselineCacheKey(filePath);
            const cachedSha = this.baselineRefShaByKey.get(baselineKey);
            const currentSha = await this.gitAnalyzer.getCurrentCommitSha();
            if (!cachedSha) {
                // No cached SHA - first time, will resolve
                return true;
            }
            if (cachedSha !== currentSha) {
                this.debugLog(`🔄 Baseline SHA changed: ${cachedSha.substring(0, 7)} → ${currentSha?.substring(0, 7) || 'null'}`);
                return true;
            }
            return false;
        }
        catch (error) {
            this.debugLog(`Error checking baseline SHA: ${error}`);
            return false; // On error, don't force re-resolution
        }
    }
    /**
     * Evict oldest AST cache entries if over limit (LRU)
     */
    evictASTCacheIfNeeded() {
        if (this.baselineASTCache.size <= this.MAX_AST_CACHE_SIZE) {
            return;
        }
        // Sort by createdAt, remove oldest entries
        const entries = Array.from(this.baselineASTCache.entries())
            .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime());
        const toRemove = entries.slice(0, entries.length - this.MAX_AST_CACHE_SIZE);
        for (const [key] of toRemove) {
            this.baselineASTCache.delete(key);
        }
        this.debugLog(`Evicted ${toRemove.length} AST cache entries (size: ${this.baselineASTCache.size})`);
    }
    /**
     * Check if file is binary (simple heuristic)
     */
    async isBinaryFile(filePath) {
        try {
            const content = fs.readFileSync(filePath);
            // Check for null bytes (common in binary files)
            if (content.includes(0)) {
                return true;
            }
            // Check file extension
            const ext = path.extname(filePath).toLowerCase();
            const binaryExts = ['.exe', '.dll', '.so', '.dylib', '.bin', '.jpg', '.jpeg', '.png', '.gif', '.pdf', '.zip', '.tar', '.gz'];
            return binaryExts.includes(ext);
        }
        catch {
            return false;
        }
    }
    /**
     * Check if file is too large for AST parsing
     */
    isFileTooLarge(filePath, maxSizeMB = 5) {
        try {
            const stats = fs.statSync(filePath);
            const sizeMB = stats.size / (1024 * 1024);
            return sizeMB > maxSizeMB;
        }
        catch {
            return false;
        }
    }
    /**
     * Initialize baseline from disk when file is first opened
     * This ensures baseline is ready before first save/analysis
     * Called from onDidOpenTextDocument listener
     */
    async initializeBaselineIfNeeded(filePath) {
        // Skip if Git is available and file is tracked (use Git baseline instead)
        if (this.configManager.get('gitIntegration', true)) {
            try {
                const isTracked = await this.gitAnalyzer.isFileTracked(filePath);
                if (isTracked) {
                    // File is tracked in Git - will use Git baseline, don't initialize snapshot
                    this.debugLog(`File is tracked in Git - skipping snapshot baseline initialization`);
                    return;
                }
            }
            catch (error) {
                // Git check failed - proceed with snapshot initialization
                this.debugLog(`Git check failed: ${error} - proceeding with snapshot initialization`);
            }
        }
        // Check if baseline already exists
        if (this.baselineCache.has(filePath)) {
            this.debugLog(`Baseline already initialized for: ${filePath}`);
            return;
        }
        // Initialize baseline from disk (saved state at open)
        try {
            const diskContent = fs.readFileSync(filePath, 'utf8');
            this.baselineCache.set(filePath, diskContent);
            this.debugLog(`✅ Initialized baseline from disk for: ${filePath} (${diskContent.length} chars)`);
            console.log(`[Baseline Init] Initialized baseline from disk: ${filePath}`);
        }
        catch (error) {
            this.debugLog(`❌ Failed to initialize baseline from disk: ${error}`);
            console.error(`[Baseline Init] Failed to initialize baseline: ${error}`);
        }
    }
    async analyzeFile(filePath, document, forceAnalysis = true) {
        // VERIFICATION: Show message to confirm NEW code is running (not old Git-based code)
        vscode.window.showInformationMessage(`✅ NEW CODE: Baseline-based analysis (NOT Git-based)`, { modal: false });
        // FORCE show debug panel immediately
        if (this.debugOutputChannel) {
            this.debugOutputChannel.show(true); // true = preserve focus
            this.debugOutputChannel.clear(); // Clear old logs
        }
        else {
            console.error('[ProfessionalImpactAnalyzer] ERROR: debugOutputChannel is NULL!');
            vscode.window.showErrorMessage('Debug channel not initialized!');
        }
        // Show notification to confirm code is running
        const logPath = require('os').homedir() + '\\vscode-impact-analyzer-debug.log';
        vscode.window.showInformationMessage(`🔍 Analyzing ${path.basename(filePath)}... Check log: ${logPath}`, { modal: false });
        try {
            this.debugLog(`========================================`);
            this.debugLog(`ProfessionalImpactAnalyzer.analyzeFile() called for: ${filePath}`);
            this.debugLog(`Baseline cache size: ${this.baselineCache.size}`);
            // Also log to console for visibility
            console.log(`[ProfessionalImpactAnalyzer] Starting analysis for: ${filePath}`);
            console.log(`[ProfessionalImpactAnalyzer] Baseline cache size: ${this.baselineCache.size}`);
            console.log(`[DEBUG] Log file: ${logPath}`);
            (0, debug_logger_1.debugLog)(`[START] analyzeFile() called for: ${filePath}`);
            (0, debug_logger_1.debugLog)(`[START] Baseline cache size: ${this.baselineCache.size}`);
            // Resolve document internally (removes reliance on call sites)
            const resolvedDoc = this.resolveDocument(filePath, document);
            // Get current file content (after) - prefer editor buffer over disk
            // This ensures we capture unsaved changes
            let after;
            let currentVersion;
            if (resolvedDoc) {
                after = resolvedDoc.getText();
                currentVersion = {
                    source: 'buffer',
                    documentVersion: resolvedDoc.version,
                    timestamp: new Date()
                };
                this.debugLog(`Using editor buffer content (${after.length} chars, version ${resolvedDoc.version}) - includes unsaved changes`);
            }
            else {
                after = fs.readFileSync(filePath, 'utf8');
                currentVersion = {
                    source: 'disk',
                    timestamp: new Date()
                };
                this.debugLog(`Using disk file content (${after.length} chars) - saved state only`);
            }
            this.debugLog(`Current file content length: ${after.length} chars`);
            // DECISION ORDER FOR BASELINE:
            // 1. Git baseline (HEAD or target branch) - most reliable source of truth
            // 2. Last-saved snapshot (baseline cache) - fallback if Git unavailable
            // 3. AST diff (on top of either) - analysis method
            let before = null;
            let baseline;
            let baselineType = 'none';
            let baselineRef;
            let baselineCommitSha;
            let fallbackReason;
            // Check for binary or too-large files early
            const isBinary = await this.isBinaryFile(filePath);
            if (isBinary) {
                this.debugLog(`⚠️ Binary file detected - skipping AST analysis`);
                return {
                    filePath,
                    changedFunctions: [],
                    changedClasses: [],
                    changedModules: [],
                    affectedTests: [],
                    downstreamComponents: [],
                    confidence: 0,
                    estimatedTestTime: 0,
                    coverageImpact: 0,
                    riskLevel: 'low',
                    timestamp: new Date(),
                    hasActualChanges: false,
                    baselineType: 'none',
                    baseline: {
                        refType: 'none',
                        availability: 'unavailable',
                        reason: 'binary_file'
                    },
                    currentVersion,
                    parseStatus: {
                        old: 'not_attempted',
                        new: 'not_attempted'
                    }
                };
            }
            const isTooLarge = this.isFileTooLarge(filePath);
            if (isTooLarge) {
                this.debugLog(`⚠️ File too large for AST analysis - using lightweight text diff`);
                // Continue but mark for lightweight diff
            }
            // STEP 1: Lazy Git state detection - check if baseline SHA changed
            const shouldReResolve = await this.shouldReResolveBaseline(filePath);
            if (shouldReResolve) {
                this.debugLog(`🔄 Baseline SHA changed - re-resolving baseline`);
            }
            // STEP 2: Try Git baseline first (HEAD or target branch)
            if (this.configManager.get('gitIntegration', true)) {
                try {
                    const baselineMode = this.configManager.getBaselineMode();
                    const baselineKey = await this.getBaselineCacheKey(filePath);
                    // Check if file is tracked
                    const isTracked = await this.gitAnalyzer.isFileTracked(filePath);
                    if (!isTracked) {
                        this.debugLog(`⚠️ File not tracked in Git - will try cached baseline`);
                        baseline = {
                            refType: 'none',
                            availability: 'unavailable',
                            reason: 'file_not_tracked'
                        };
                        fallbackReason = 'file_not_tracked';
                    }
                    else {
                        let commitSha = null;
                        let gitContent = null;
                        let refName;
                        if (baselineMode === 'pr') {
                            // PR mode: use merge-base
                            const targetRef = this.configManager.getPrTargetBranch();
                            refName = targetRef;
                            const mergeBaseSha = await this.gitAnalyzer.getMergeBase(targetRef);
                            if (mergeBaseSha) {
                                commitSha = mergeBaseSha;
                                gitContent = await this.gitAnalyzer.getFileContentFromCommit(filePath, mergeBaseSha);
                                baselineType = 'git:mergeBase';
                                baselineRef = targetRef;
                            }
                            else {
                                // Merge-base failed - fall back to HEAD
                                this.debugLog(`⚠️ Merge-base unavailable, falling back to HEAD`);
                                fallbackReason = 'merge_base_unavailable';
                                commitSha = await this.gitAnalyzer.getCurrentCommitSha();
                                gitContent = await this.gitAnalyzer.getFileContentFromHEAD(filePath);
                                baselineType = 'git:HEAD';
                                baselineRef = 'HEAD';
                            }
                        }
                        else {
                            // Local mode: use HEAD
                            refName = 'HEAD';
                            commitSha = await this.gitAnalyzer.getCurrentCommitSha();
                            gitContent = await this.gitAnalyzer.getFileContentFromHEAD(filePath);
                            baselineType = 'git:HEAD';
                            baselineRef = 'HEAD';
                        }
                        if (gitContent && commitSha) {
                            before = gitContent;
                            baselineCommitSha = commitSha;
                            // Store baseline SHA for future comparison
                            this.baselineRefShaByKey.set(baselineKey, commitSha);
                            baseline = {
                                refType: baselineType,
                                refName: refName,
                                commitSha: commitSha,
                                availability: 'available'
                            };
                            this.debugLog(`✅ Using Git ${baselineType} as baseline (${before.length} chars, SHA: ${commitSha.substring(0, 7)}, ref: ${refName})`);
                            (0, debug_logger_1.debugLog)(`[BASELINE] Using Git ${baselineType} (${commitSha.substring(0, 7)})`);
                            console.log(`[BASELINE] Git ${baselineType} found - using as baseline (${commitSha.substring(0, 7)})`);
                        }
                        else if (!gitContent && commitSha) {
                            // File exists in repo but not at this ref (deleted/renamed)
                            baseline = {
                                refType: baselineType,
                                refName: refName,
                                commitSha: commitSha,
                                availability: 'unavailable',
                                reason: 'file_not_at_ref'
                            };
                            fallbackReason = 'file_not_at_ref';
                            this.debugLog(`⚠️ File not found at ${refName} (${commitSha.substring(0, 7)}) - will try cached baseline`);
                        }
                        else {
                            baseline = {
                                refType: baselineType,
                                refName: refName,
                                availability: 'unavailable',
                                reason: 'git_ref_unavailable'
                            };
                            fallbackReason = 'git_ref_unavailable';
                            this.debugLog(`⚠️ Git ${refName} unavailable - will try cached baseline`);
                        }
                    }
                }
                catch (error) {
                    this.debugLog(`⚠️ Git error: ${error} - will try cached baseline`);
                    (0, debug_logger_1.debugLog)(`[BASELINE] Git unavailable: ${error}`);
                    baseline = {
                        refType: 'git:HEAD',
                        availability: 'unavailable',
                        reason: `git_error: ${String(error)}`
                    };
                    fallbackReason = `git_error: ${String(error)}`;
                }
            }
            else {
                this.debugLog(`⚠️ Git integration disabled - will try cached baseline`);
                baseline = {
                    refType: 'none',
                    availability: 'unavailable',
                    reason: 'git_integration_disabled'
                };
                fallbackReason = 'git_integration_disabled';
            }
            // STEP 3: Fall back to last-saved snapshot (baseline cache) if Git unavailable
            // Snapshot mode flow:
            // 1. First analysis (no cache): Initialize baseline from disk, store in cache, return empty (or analyze if changes)
            // 2. On save (has cache): Use cached baseline (previous saved state) vs current saved content
            // 3. After analysis: Update cache with current saved content
            if (!before) {
                const cachedBaseline = this.baselineCache.get(filePath);
                if (cachedBaseline) {
                    // We have a cached baseline - use it (this is "previous saved state")
                    before = cachedBaseline;
                    baselineType = 'snapshot:lastSave';
                    baseline = {
                        refType: 'snapshot:lastSave',
                        availability: 'available',
                        reason: fallbackReason ? `fallback_from_${fallbackReason}` : 'using_cached_snapshot'
                    };
                    this.debugLog(`✅ Using cached baseline (${before.length} chars) - previous saved state`);
                    if (fallbackReason) {
                        this.debugLog(`   Fallback reason: ${fallbackReason}`);
                    }
                    (0, debug_logger_1.debugLog)(`[BASELINE] Using cached snapshot (previous save)`);
                    console.log(`[BASELINE] Using cached baseline (previous save)`);
                }
                else {
                    // No cached baseline - this is first analysis
                    // Initialize snapshot baseline from disk (current saved state at open)
                    this.debugLog(`⚠️ No cached baseline - initializing from disk (first analysis)`);
                    (0, debug_logger_1.debugLog)(`[BASELINE] First analysis - initializing baseline from disk`);
                    try {
                        // Read saved state from disk as initial baseline
                        const diskContent = fs.readFileSync(filePath, 'utf8');
                        before = diskContent;
                        baselineType = 'snapshot:lastSave';
                        baseline = {
                            refType: 'snapshot:lastSave',
                            availability: 'available',
                            reason: baseline?.reason ? `fallback_from_${baseline.reason}` : 'first_analysis_initialized_from_disk'
                        };
                        this.debugLog(`✅ Initialized baseline from disk (${before.length} chars) - saved state at open`);
                        // Store in cache for next analysis
                        this.baselineCache.set(filePath, diskContent);
                        this.debugLog(`✅ Stored baseline in cache for next analysis`);
                        // Compare disk (baseline) vs current (might have unsaved changes)
                        const areEqual = before === after;
                        if (areEqual) {
                            // Disk matches current - no changes detected
                            this.debugLog(`✅ Baseline (disk) === Current - no changes detected`);
                            const emptyResult = {
                                filePath,
                                changedFunctions: [],
                                changedClasses: [],
                                changedModules: [],
                                affectedTests: [],
                                downstreamComponents: [],
                                confidence: 1.0,
                                estimatedTestTime: 0,
                                coverageImpact: 0,
                                riskLevel: 'low',
                                timestamp: new Date(),
                                hasActualChanges: false,
                                baselineType: 'snapshot:lastSave',
                                baseline,
                                currentVersion,
                                parseStatus: {
                                    old: 'not_attempted',
                                    new: 'not_attempted'
                                }
                            };
                            vscode.window.showInformationMessage(`✅ First analysis - baseline initialized, no changes detected`, { modal: false });
                            return emptyResult;
                        }
                        else {
                            // Disk differs from current - proceed with analysis
                            this.debugLog(`⚠️ Baseline (disk) !== Current - changes detected, will analyze`);
                            // Continue to AST diff below
                        }
                    }
                    catch (diskError) {
                        // Can't read disk - fall back to storing current as baseline
                        this.debugLog(`❌ Error reading disk: ${diskError} - storing current as baseline`);
                        this.baselineCache.set(filePath, after);
                        baselineType = 'none';
                        baseline = {
                            refType: 'none',
                            availability: 'unavailable',
                            reason: `disk_read_error: ${diskError}`
                        };
                        const emptyResult = {
                            filePath,
                            changedFunctions: [],
                            changedClasses: [],
                            changedModules: [],
                            affectedTests: [],
                            downstreamComponents: [],
                            confidence: 1.0,
                            estimatedTestTime: 0,
                            coverageImpact: 0,
                            riskLevel: 'low',
                            timestamp: new Date(),
                            hasActualChanges: false,
                            baselineType: 'none',
                            baseline,
                            currentVersion,
                            parseStatus: {
                                old: 'not_attempted',
                                new: 'not_attempted'
                            }
                        };
                        vscode.window.showInformationMessage(`⚠️ First analysis - baseline stored (disk read failed)`, { modal: false });
                        return emptyResult;
                    }
                }
            }
            // Log baseline source
            this.debugLog(`Baseline: ${baselineType} (${baseline?.refType || 'unknown'})`);
            if (baseline?.commitSha) {
                this.debugLog(`Baseline commit SHA: ${baseline.commitSha.substring(0, 7)}`);
            }
            this.debugLog(`Baseline length: ${before.length} chars`);
            this.debugLog(`Current length: ${after.length} chars`);
            // STEP 3: Direct buffer comparison (before AST diff)
            const areEqual = before === after;
            this.debugLog(`Buffer comparison: ${areEqual ? '✅ EQUAL' : '❌ DIFFERENT'}`);
            console.log(`[COMPARISON] before === after: ${areEqual}`);
            console.log(`[COMPARISON] before.length: ${before.length}, after.length: ${after.length}`);
            // If not equal, show why
            if (!areEqual) {
                this.debugLog(`⚠️ Strings are different!`);
                this.debugLog(`Before length: ${before.length}, After length: ${after.length}`);
                if (before.length !== after.length) {
                    this.debugLog(`Length mismatch: ${before.length} vs ${after.length}`);
                }
                // Find first difference
                const minLen = Math.min(before.length, after.length);
                for (let i = 0; i < minLen; i++) {
                    if (before[i] !== after[i]) {
                        this.debugLog(`First difference at char ${i}: '${before[i]}' (${before.charCodeAt(i)}) vs '${after[i]}' (${after.charCodeAt(i)})`);
                        this.debugLog(`Context: ...${before.substring(Math.max(0, i - 10), i + 10)}...`);
                        break;
                    }
                }
            }
            if (areEqual) {
                this.debugLog(`✅ BEFORE === AFTER - No changes detected, returning empty report`);
                (0, debug_logger_1.debugLog)(`[SUCCESS] before === after, returning empty result`);
                (0, debug_logger_1.debugLog)(`[RETURN] Empty result - 0 functions, 0 downstream, 0 tests`);
                console.log(`[ProfessionalImpactAnalyzer] ✅ NO CHANGES - Returning empty result`);
                console.log(`[RETURN] Empty result: 0 functions, 0 downstream, 0 tests`);
                // Show output channel
                if (this.debugOutputChannel) {
                    this.debugOutputChannel.show(true);
                }
                // Return empty result immediately
                const emptyResult = {
                    filePath,
                    changedFunctions: [],
                    changedClasses: [],
                    changedModules: [],
                    affectedTests: [],
                    downstreamComponents: [],
                    confidence: 1.0,
                    estimatedTestTime: 0,
                    coverageImpact: 0,
                    riskLevel: 'low',
                    timestamp: new Date(),
                    hasActualChanges: false,
                    baselineType,
                    baseline: {
                        ...baseline,
                        refName: baselineRef,
                        commitSha: baselineCommitSha,
                        reason: fallbackReason || baseline?.reason
                    },
                    currentVersion,
                    parseStatus: {
                        old: 'not_attempted',
                        new: 'not_attempted'
                    }
                };
                this.debugLog(`Returning empty result: 0 functions, 0 downstream, 0 tests`);
                this.debugLog(`========================================`);
                // Show notification to confirm
                vscode.window.showInformationMessage(`✅ No changes detected in ${path.basename(filePath)}`, { modal: false });
                return emptyResult;
            }
            // If we get here, before !== after - this should NOT happen on first analysis!
            (0, debug_logger_1.debugLog)(`[ERROR] before !== after! This means comparison failed!`);
            (0, debug_logger_1.debugLog)(`[ERROR] before.length: ${before.length}, after.length: ${after.length}`);
            (0, debug_logger_1.debugLog)(`[ERROR] Will proceed with analysis, but this is unexpected on first run`);
            // If we get here, before !== after
            (0, debug_logger_1.debugLog)(`[ERROR] before !== after on first analysis! This should not happen!`);
            (0, debug_logger_1.debugLog)(`[ERROR] before.length: ${before.length}, after.length: ${after.length}`);
            console.log(`[WARNING] before !== after, but should be equal on first analysis!`);
            console.log(`[WARNING] This means baseline comparison failed!`);
            // STEP 3: AST-based diff on top of baseline (works for both Git and snapshot baselines)
            this.debugLog(`⚠️ BEFORE !== AFTER - Changes detected, using AST-based diff`);
            this.debugLog(`Baseline: ${baselineType} (${baseline?.refType || 'unknown'})`);
            console.log(`[ProfessionalImpactAnalyzer] ⚠️ CHANGES DETECTED - Will analyze with AST diff`);
            console.log(`[BASELINE] Using ${baselineType} as baseline for AST diff`);
            // Get Git changes for context (if using Git baseline)
            let gitChanges;
            if (baselineType.startsWith('git:') && this.configManager.get('gitIntegration', true)) {
                gitChanges = await this.gitAnalyzer.getFileChanges(filePath);
            }
            // Use AST-based diff for semantic change detection (works with any baseline source)
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder found');
            }
            const projectRoot = workspaceFolder.uri.fsPath;
            const relativeFilePath = path.relative(projectRoot, filePath);
            this.debugLog(`Calling analyzeImpact() with AST diff`);
            this.debugLog(`AST diff will analyze: baseline (${baselineType}) vs current content`);
            this.debugLog(`Before content hash: ${this.simpleHash(before)}`);
            this.debugLog(`After content hash: ${this.simpleHash(after)}`);
            // Track AST parse status - don't silently fail
            let parseStatus = {
                old: 'not_attempted',
                new: 'not_attempted'
            };
            // AST-based analysis: parses both versions, finds semantic changes (functions, classes, etc.)
            let report;
            try {
                report = await (0, PureImpactAnalyzer_1.analyzeImpact)({
                    file: relativeFilePath,
                    before: before,
                    after: after,
                    projectRoot: projectRoot
                }, (msg) => this.debugLog(`[PureImpactAnalyzer] ${msg}`));
                // If we got here, parsing succeeded (analyzeImpact handles parse errors internally)
                parseStatus = {
                    old: 'success',
                    new: 'success'
                };
            }
            catch (parseError) {
                // AST parse failed - don't silently return empty
                this.debugLog(`❌ AST parse failed: ${parseError}`);
                console.error(`[AST Parse Error] ${parseError}`);
                parseStatus = {
                    old: 'failed',
                    new: 'failed',
                    fallback: 'none'
                };
                // Return result indicating parse failure
                return {
                    filePath,
                    changedFunctions: [],
                    changedClasses: [],
                    changedModules: [],
                    affectedTests: [],
                    downstreamComponents: [],
                    confidence: 0,
                    estimatedTestTime: 0,
                    coverageImpact: 0,
                    riskLevel: 'high',
                    timestamp: new Date(),
                    hasActualChanges: false,
                    baselineType,
                    baseline,
                    currentVersion,
                    parseStatus
                };
            }
            this.debugLog(`AST-based report: ${report.functions.length} functions, ${report.downstreamFiles.length} downstream, ${report.tests.length} tests`);
            (0, debug_logger_1.debugLog)(`[ANALYSIS RESULT] Functions: ${report.functions.length}, Downstream: ${report.downstreamFiles.length}, Tests: ${report.tests.length}`);
            (0, debug_logger_1.debugLog)(`[ANALYSIS RESULT] Tests: ${JSON.stringify(report.tests)}`);
            console.log(`[ANALYSIS RESULT] Functions: ${report.functions.length}, Downstream: ${report.downstreamFiles.length}, Tests: ${report.tests.length}`);
            // Update baseline cache behavior:
            // Git mode: Don't update cache - baseline stays Git HEAD (doesn't change on save)
            // Snapshot mode: Update cache with current saved content (this becomes "last saved" for next analysis)
            if (baselineType.startsWith('git:')) {
                // Git mode: Don't update baseline cache - baseline stays Git HEAD
                (0, debug_logger_1.debugLog)(`[BASELINE] Keeping Git HEAD as baseline (not updating cache)`);
                console.log(`[BASELINE] Git mode - baseline stays HEAD, cache not updated`);
            }
            else if (baselineType === 'snapshot:lastSave') {
                // Snapshot mode: Update cache with current saved content
                // On save: old = cached baseline (previous save), new = doc.getText() (current save)
                // After analysis: update cache with new saved content (becomes baseline for next save)
                // For save operations, use doc.getText() (saved content), otherwise use 'after' (current state)
                const savedContent = resolvedDoc ? resolvedDoc.getText() : after;
                this.baselineCache.set(filePath, savedContent);
                (0, debug_logger_1.debugLog)(`[BASELINE] Updated cached snapshot with saved content (${savedContent.length} chars)`);
                console.log(`[BASELINE] Snapshot mode - updated cache with saved content`);
            }
            // Transform ImpactReport to ImpactAnalysisResult
            const result = {
                filePath,
                changedFunctions: report.functions,
                changedClasses: [],
                changedModules: [],
                affectedTests: report.tests,
                downstreamComponents: report.downstreamFiles,
                confidence: this.calculateConfidenceFromReport(report),
                estimatedTestTime: this.estimateTestTime(report.tests),
                coverageImpact: this.calculateCoverageImpactFromReport(report),
                riskLevel: this.calculateRiskLevelFromReport(report),
                timestamp: new Date(),
                gitChanges,
                hasActualChanges: true,
                baselineType,
                baseline: {
                    ...baseline,
                    refName: baselineRef,
                    commitSha: baselineCommitSha,
                    reason: fallbackReason || baseline?.reason
                },
                currentVersion,
                parseStatus
            };
            // Show output channel
            if (this.debugOutputChannel) {
                this.debugOutputChannel.show();
            }
            // Cache result
            const cacheKey = this.getCacheKey(filePath);
            if (this.configManager.get('cacheEnabled', true)) {
                this.analysisCache.set(cacheKey, result);
            }
            this.debugLog(`Analysis complete`);
            this.debugLog(`========================================`);
            return result;
        }
        catch (error) {
            console.error('Error analyzing file:', error);
            return {
                filePath,
                changedFunctions: [],
                changedClasses: [],
                changedModules: [],
                affectedTests: [],
                downstreamComponents: [],
                confidence: 0,
                estimatedTestTime: 0,
                coverageImpact: 0,
                riskLevel: 'low',
                timestamp: new Date(),
                hasActualChanges: false
            };
        }
    }
    async analyzeWorkspace() {
        const files = await this.getSourceFiles();
        const results = [];
        for (const file of files) {
            try {
                const result = await this.analyzeFile(file);
                results.push(result);
            }
            catch (error) {
                console.error(`Error analyzing ${file}:`, error);
            }
        }
        return results;
    }
    async analyzeFolder(folderPath) {
        const files = await this.getSourceFilesInFolder(folderPath);
        const results = [];
        for (const file of files) {
            try {
                const result = await this.analyzeFile(file);
                results.push(result);
            }
            catch (error) {
                console.error(`Error analyzing ${file}:`, error);
            }
        }
        return results;
    }
    async getImpactedFilesForStagedChanges() {
        try {
            const gitChanges = await this.gitAnalyzer.getStagedChanges();
            return [...gitChanges.added, ...gitChanges.modified];
        }
        catch (error) {
            console.error('Error getting staged changes:', error);
            return [];
        }
    }
    async getSourceFiles() {
        const files = [];
        const patterns = this.configManager.getSourcePatterns();
        for (const pattern of patterns) {
            const matches = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
            files.push(...matches.map(uri => uri.fsPath));
        }
        return files;
    }
    async getSourceFilesInFolder(folderPath) {
        const files = [];
        const patterns = this.configManager.getSourcePatterns();
        for (const pattern of patterns) {
            const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(folderPath, pattern), '**/node_modules/**');
            files.push(...matches.map(uri => uri.fsPath));
        }
        return files;
    }
    getCacheKey(filePath) {
        try {
            const stats = fs.statSync(filePath);
            return `${filePath}-${stats.mtime.getTime()}-${stats.size}`;
        }
        catch {
            return filePath;
        }
    }
    calculateConfidenceFromReport(report) {
        let confidence = 0;
        confidence += Math.min(report.functions.length * 0.1, 0.3);
        if (report.tests.length > 0)
            confidence += 0.4;
        if (report.downstreamFiles.length > 0)
            confidence += 0.3;
        return Math.min(confidence, 1.0);
    }
    estimateTestTime(tests) {
        return tests.length * 100;
    }
    calculateCoverageImpactFromReport(report) {
        return Math.min(report.functions.length * 5, 100);
    }
    calculateRiskLevelFromReport(report) {
        const riskScore = report.functions.length + report.downstreamFiles.length + report.tests.length;
        if (riskScore <= 2)
            return 'low';
        if (riskScore <= 5)
            return 'medium';
        return 'high';
    }
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(36);
    }
    clearCache() {
        this.analysisCache.clear();
    }
    clearBaseline(filePath) {
        this.baselineCache.delete(filePath);
        this.debugLog(`Cleared baseline for: ${filePath}`);
    }
    clearAllBaselines() {
        this.baselineCache.clear();
        this.debugLog(`Cleared all baselines`);
    }
    getCachedResult(filePath) {
        for (const [key, value] of this.analysisCache.entries()) {
            if (key.startsWith(filePath)) {
                return value;
            }
        }
        return undefined;
    }
    /**
     * QUICK FIX: Detect if changes are ONLY comments/whitespace (non-breaking)
     * Returns true if the code is identical after removing all comments and whitespace
     */
    isCommentOnlyChange(oldContent, newContent) {
        try {
            // Normalize: remove all whitespace and comments
            const normalize = (content) => {
                return content
                    .replace(/\/\/.*$/gm, '') // Remove line comments
                    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
                    .replace(/#.*$/gm, '') // Remove Python-style comments
                    .replace(/\s+/g, ' ') // Normalize whitespace
                    .trim();
            };
            const oldNorm = normalize(oldContent);
            const newNorm = normalize(newContent);
            const isCommentOnly = oldNorm === newNorm;
            console.log(`[Breaking Changes] Comment-only check: ${isCommentOnly ? 'YES' : 'NO'}`);
            return isCommentOnly;
        }
        catch (error) {
            console.error('[Breaking Changes] Error checking for comment-only change:', error);
            return false; // Default to false if error - be conservative
        }
    }
    /**
     * Get baseline content for a file (previous version)
     * Used to compare current content with old content
     */
    async getBaselineContent(filePath) {
        try {
            // Try to get from git
            if (this.configManager.get('gitIntegration', true)) {
                const oldContent = await this.gitAnalyzer.getFileContentFromHEAD(filePath);
                if (oldContent) {
                    return oldContent;
                }
            }
            // Fallback: return null (will skip comment check)
            return null;
        }
        catch (error) {
            console.error('[Breaking Changes] Error getting baseline content:', error);
            return null;
        }
    }
}
exports.ProfessionalImpactAnalyzer = ProfessionalImpactAnalyzer;
//# sourceMappingURL=ProfessionalImpactAnalyzer.js.map