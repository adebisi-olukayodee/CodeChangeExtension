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
exports.GitAnalyzer = void 0;
const path = __importStar(require("path"));
const child_process = __importStar(require("child_process"));
const vscode = __importStar(require("vscode"));
class GitAnalyzer {
    constructor() {
        // Cache repo root by the repo root itself (or gitDir) to avoid repeated git rev-parse calls
        // Key: normalized repo root path, Value: repo root (for quick lookup)
        // Also cache by gitDir for submodule/nested repo detection
        this.repoRootCache = new Map();
        this.gitDirCache = new Map(); // gitDir -> repoRoot
        // No initialization needed for simple git commands
    }
    /**
     * Resolve Git repo root for a file path (with caching)
     * Step 1: Resolve Git repo root using git -C <fileDir> rev-parse --show-toplevel
     */
    async resolveRepoRoot(filePath) {
        const fileDir = path.dirname(filePath);
        try {
            // First, try to get gitDir to check cache
            const gitDir = await this.execGitCommand(['rev-parse', '--git-dir'], fileDir);
            if (gitDir) {
                const normalizedGitDir = path.resolve(gitDir.trim());
                // Check if we've seen this gitDir before
                const cached = this.gitDirCache.get(normalizedGitDir);
                if (cached) {
                    return cached;
                }
            }
            // Get repo root using git -C <fileDir> rev-parse --show-toplevel
            // Using -C ensures we run from the file's directory
            const gitRoot = await this.execGitCommand(['-C', fileDir, 'rev-parse', '--show-toplevel']);
            if (!gitRoot) {
                return null;
            }
            const normalizedRoot = path.resolve(gitRoot.trim());
            // Cache by the repo root itself (all files in same repo share same root)
            this.repoRootCache.set(normalizedRoot, normalizedRoot);
            // Also cache by gitDir if we got it
            if (gitDir) {
                const normalizedGitDir = path.resolve(gitDir.trim());
                this.gitDirCache.set(normalizedGitDir, normalizedRoot);
            }
            return normalizedRoot;
        }
        catch (error) {
            return null;
        }
    }
    /**
     * Convert absolute FS path → repo-relative path (normalized for Git)
     * Step 2: Convert absolute FS path → repo-relative path
     */
    normalizePathForGit(repoRoot, filePath) {
        // Resolve both paths to absolute paths to ensure correct relative calculation
        const absRepoRoot = path.resolve(repoRoot);
        const absFilePath = path.resolve(filePath);
        const relativePath = path.relative(absRepoRoot, absFilePath);
        // Handle edge case: if file is at repo root, relativePath might be just the filename
        // Handle edge case: if paths are the same, return empty (shouldn't happen for files)
        if (!relativePath || relativePath === '.' || relativePath === '') {
            // File is at repo root or same as root
            const fileName = path.basename(filePath);
            return fileName;
        }
        // Normalize to forward slashes for Git commands (works on all platforms)
        // Optional: strip leading ./ (harmless either way, but cleaner)
        return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    }
    async getFileChanges(filePath) {
        try {
            // Step 1: Resolve Git repo root
            const repoRoot = await this.resolveRepoRoot(filePath);
            if (!repoRoot) {
                return undefined;
            }
            // Step 2: Convert to repo-relative path (normalized)
            const relativePath = this.normalizePathForGit(repoRoot, filePath);
            // Get the status of the file
            const status = await this.getGitStatus();
            const changes = {
                added: [],
                modified: [],
                deleted: []
            };
            // Check if file is in staged changes
            if (status.staged.includes(relativePath)) {
                changes.modified.push(relativePath);
            }
            // Check if file is in unstaged changes
            if (status.modified.includes(relativePath)) {
                changes.modified.push(relativePath);
            }
            // Check if file is untracked (new)
            if (status.not_added.includes(relativePath)) {
                changes.added.push(relativePath);
            }
            // Check if file is deleted
            if (status.deleted.includes(relativePath)) {
                changes.deleted.push(relativePath);
            }
            return changes;
        }
        catch (error) {
            console.error('Error getting git changes:', error);
            return undefined;
        }
    }
    async getStagedChanges() {
        try {
            if (!await this.isGitRepository()) {
                return { added: [], modified: [], deleted: [] };
            }
            const status = await this.getGitStatus();
            return {
                added: status.staged.filter(file => !status.modified.includes(file)),
                modified: status.staged.filter(file => status.modified.includes(file)),
                deleted: status.deleted
            };
        }
        catch (error) {
            console.error('Error getting staged changes:', error);
            return { added: [], modified: [], deleted: [] };
        }
    }
    async getUnstagedChanges() {
        try {
            if (!await this.isGitRepository()) {
                return { added: [], modified: [], deleted: [] };
            }
            const status = await this.getGitStatus();
            return {
                added: status.not_added,
                modified: status.modified.filter(file => !status.staged.includes(file)),
                deleted: status.deleted
            };
        }
        catch (error) {
            console.error('Error getting unstaged changes:', error);
            return { added: [], modified: [], deleted: [] };
        }
    }
    async getDiffForFile(filePath) {
        try {
            // Step 1: Resolve Git repo root
            const repoRoot = await this.resolveRepoRoot(filePath);
            if (!repoRoot) {
                return undefined;
            }
            // Step 2: Convert to repo-relative path (normalized)
            const relativePath = this.normalizePathForGit(repoRoot, filePath);
            // Step 3: Use that path in Git commands
            // First check for unstaged changes
            let diff = await this.execGitCommand(['diff', '--', relativePath], repoRoot);
            // If no unstaged changes, check for staged changes
            if (!diff || diff.trim().length === 0) {
                diff = await this.execGitCommand(['diff', '--staged', '--', relativePath], repoRoot);
            }
            // If still no diff, check if file is untracked (new file)
            if (!diff || diff.trim().length === 0) {
                const isUntracked = await this.isFileUntracked(filePath);
                if (isUntracked) {
                    // For untracked files, return a placeholder diff
                    // This signals that the file exists but is not in Git
                    return 'new file';
                }
            }
            return diff || undefined;
        }
        catch (error) {
            console.error('Error getting diff for file:', error);
            return undefined;
        }
    }
    async getCommitHash(repoFullName) {
        try {
            const workspaceRoot = await this.resolveWorkspaceRoot(repoFullName);
            if (!workspaceRoot) {
                return undefined;
            }
            if (!await this.isGitRepository(workspaceRoot)) {
                return undefined;
            }
            const hash = await this.execGitCommand(['rev-parse', 'HEAD'], workspaceRoot);
            return hash || undefined;
        }
        catch (error) {
            console.error('Error getting commit hash:', error);
            return undefined;
        }
    }
    async getBranchName(repoFullName) {
        try {
            const workspaceRoot = await this.resolveWorkspaceRoot(repoFullName);
            if (!workspaceRoot) {
                return undefined;
            }
            if (!await this.isGitRepository(workspaceRoot)) {
                return undefined;
            }
            const branch = await this.execGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], workspaceRoot);
            return branch || undefined;
        }
        catch (error) {
            console.error('Error getting branch name:', error);
            return undefined;
        }
    }
    async isGitRepository(cwd) {
        try {
            const result = await this.execGitCommand(['rev-parse', '--show-toplevel'], cwd);
            return result !== null;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Get Git repository root for a path
     */
    async getRepoRoot(cwd) {
        try {
            const searchPath = cwd || this.getDefaultWorkspaceRoot() || '';
            // Check cache first
            const cached = this.repoRootCache.get(searchPath);
            if (cached) {
                return cached;
            }
            const result = await this.execGitCommand(['rev-parse', '--show-toplevel'], searchPath);
            if (result) {
                const normalized = result.trim();
                this.repoRootCache.set(searchPath, normalized);
                return normalized;
            }
            return null;
        }
        catch (error) {
            return null;
        }
    }
    async isFileUntracked(filePath) {
        try {
            // Step 1: Resolve Git repo root
            const repoRoot = await this.resolveRepoRoot(filePath);
            if (!repoRoot) {
                return true; // If not in Git repo, consider untracked
            }
            // Step 2: Convert to repo-relative path (normalized)
            const relativePath = this.normalizePathForGit(repoRoot, filePath);
            // Step 3: Use that path in Git command
            // ls-files returns the file path if tracked, or nothing if untracked
            const result = await this.execGitCommand(['ls-files', '--error-unmatch', '--', relativePath], repoRoot);
            // If command returns null (error), file is untracked
            return result === null;
        }
        catch (error) {
            // If error, assume untracked
            return true;
        }
    }
    async execGitCommand(args, cwd) {
        // Check if -C flag is already in args (git -C <dir> handles cwd internally)
        const hasCFlag = args.length >= 2 && args[0] === '-C';
        // If -C flag is present, don't use cwd parameter (git handles it)
        // Otherwise, use provided cwd or default workspace root
        const workspaceRoot = hasCFlag ? undefined : (cwd ?? this.getDefaultWorkspaceRoot());
        if (!hasCFlag && !workspaceRoot) {
            return null;
        }
        return new Promise((resolve) => {
            child_process.exec(`git ${args.join(' ')}`, {
                cwd: workspaceRoot
            }, (error, stdout) => {
                if (error) {
                    resolve(null);
                }
                else {
                    resolve(stdout.trim());
                }
            });
        });
    }
    getDefaultWorkspaceRoot() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return undefined;
        }
        return folders[0].uri.fsPath;
    }
    async resolveWorkspaceRoot(repoFullName) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return undefined;
        }
        if (!repoFullName) {
            return this.getDefaultWorkspaceRoot();
        }
        const target = repoFullName.trim().toLowerCase();
        for (const folder of folders) {
            const folderPath = folder.uri.fsPath;
            if (!await this.isGitRepository(folderPath)) {
                continue;
            }
            const remoteUrl = await this.execGitCommand(['config', '--get', 'remote.origin.url'], folderPath);
            if (remoteUrl) {
                const normalized = this.normalizeRepoFullName(remoteUrl);
                if (normalized && normalized === target) {
                    return folderPath;
                }
            }
        }
        const repoName = target.split('/').pop();
        if (repoName) {
            const byName = folders.find(folder => folder.name.toLowerCase() === repoName);
            if (byName) {
                return byName.uri.fsPath;
            }
        }
        return this.getDefaultWorkspaceRoot();
    }
    normalizeRepoFullName(remoteUrl) {
        if (!remoteUrl) {
            return undefined;
        }
        let url = remoteUrl.trim();
        if (url.endsWith('.git')) {
            url = url.slice(0, -4);
        }
        if (url.startsWith('git@')) {
            const parts = url.split(':');
            if (parts.length === 2) {
                return parts[1].toLowerCase();
            }
        }
        if (url.startsWith('http://') || url.startsWith('https://')) {
            try {
                const parsed = new URL(url);
                return parsed.pathname.replace(/^\/+/, '').toLowerCase();
            }
            catch (error) {
                return undefined;
            }
        }
        const segments = url.split('/').filter(Boolean);
        if (segments.length >= 2) {
            const owner = segments[segments.length - 2];
            const repo = segments[segments.length - 1];
            return `${owner}/${repo}`.toLowerCase();
        }
        return undefined;
    }
    async getGitStatus() {
        const status = await this.execGitCommand(['status', '--porcelain']);
        if (!status) {
            return { staged: [], modified: [], not_added: [], deleted: [] };
        }
        const lines = status.split('\n');
        const staged = [];
        const modified = [];
        const not_added = [];
        const deleted = [];
        for (const line of lines) {
            if (line.length < 3)
                continue;
            const statusCode = line.substring(0, 2);
            const fileName = line.substring(3);
            if (statusCode.includes('A') || statusCode.includes('M')) {
                staged.push(fileName);
            }
            if (statusCode.includes('M') && !statusCode.includes('A')) {
                modified.push(fileName);
            }
            if (statusCode.includes('?') || statusCode.includes('A') && statusCode.includes('M')) {
                not_added.push(fileName);
            }
            if (statusCode.includes('D')) {
                deleted.push(fileName);
            }
        }
        return { staged, modified, not_added, deleted };
    }
    async getChangedFiles() {
        try {
            if (!await this.isGitRepository()) {
                return [];
            }
            const status = await this.getGitStatus();
            return [
                ...status.staged,
                ...status.modified,
                ...status.not_added,
                ...status.deleted
            ];
        }
        catch (error) {
            console.error('Error getting changed files:', error);
            return [];
        }
    }
    async getFileContentFromHEAD(filePath) {
        try {
            // Step 1: Resolve Git repo root
            const repoRoot = await this.resolveRepoRoot(filePath);
            if (!repoRoot) {
                return null;
            }
            // Step 2: Convert to repo-relative path (normalized)
            const relativePath = this.normalizePathForGit(repoRoot, filePath);
            // Step 3: Use that path in Git command
            const content = await this.execGitCommand(['show', `HEAD:${relativePath}`], repoRoot);
            return content;
        }
        catch (error) {
            console.error('Error getting file content from HEAD:', error);
            return null;
        }
    }
    /**
     * Get current HEAD commit SHA
     */
    async getCurrentCommitSha() {
        try {
            if (!await this.isGitRepository()) {
                return null;
            }
            const sha = await this.execGitCommand(['rev-parse', 'HEAD']);
            return sha?.trim() || null;
        }
        catch (error) {
            console.error('Error getting current commit SHA:', error);
            return null;
        }
    }
    /**
     * Get merge base between HEAD and target branch (for PR mode)
     */
    async getMergeBase(targetRef = 'origin/main') {
        try {
            if (!await this.isGitRepository()) {
                return null;
            }
            const mergeBase = await this.execGitCommand(['merge-base', 'HEAD', targetRef]);
            return mergeBase?.trim() || null;
        }
        catch (error) {
            console.error(`Error getting merge base with ${targetRef}:`, error);
            return null;
        }
    }
    /**
     * Get file content from a specific commit
     */
    async getFileContentFromCommit(filePath, commitSha) {
        try {
            // Step 1: Resolve Git repo root
            const repoRoot = await this.resolveRepoRoot(filePath);
            if (!repoRoot) {
                return null;
            }
            // Step 2: Convert to repo-relative path (normalized)
            const relativePath = this.normalizePathForGit(repoRoot, filePath);
            // Step 3: Use that path in Git command
            const content = await this.execGitCommand(['show', `${commitSha}:${relativePath}`], repoRoot);
            return content;
        }
        catch (error) {
            console.error(`Error getting file content from commit ${commitSha}:`, error);
            return null;
        }
    }
    /**
     * Check if file is tracked in Git at HEAD
     */
    async isFileTracked(filePath) {
        try {
            // Step 1: Resolve Git repo root
            const repoRoot = await this.resolveRepoRoot(filePath);
            if (!repoRoot) {
                console.log(`[GitAnalyzer] isFileTracked: No repo root found for ${filePath}`);
                return false;
            }
            // Step 2: Convert to repo-relative path (normalized)
            const relativePath = this.normalizePathForGit(repoRoot, filePath);
            console.log(`[GitAnalyzer] isFileTracked: repoRoot=${repoRoot}, filePath=${filePath}, relativePath=${relativePath}`);
            // Step 3: Use that path in Git command
            const result = await this.execGitCommand(['ls-files', '--error-unmatch', '--', relativePath], repoRoot);
            const isTracked = result !== null;
            console.log(`[GitAnalyzer] isFileTracked: result=${isTracked} for ${relativePath}`);
            return isTracked;
        }
        catch (error) {
            console.error(`[GitAnalyzer] isFileTracked error: ${error}`);
            return false;
        }
    }
}
exports.GitAnalyzer = GitAnalyzer;
//# sourceMappingURL=GitAnalyzer.js.map