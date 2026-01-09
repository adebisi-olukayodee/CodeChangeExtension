import * as fs from 'fs';
import * as path from 'path';

export type PackageManager = 'pnpm' | 'yarn' | 'npm';

export interface PackageManagerInfo {
    manager: PackageManager;
    lockFile: string;
}

/**
 * Detect package manager from repository
 * Order of detection:
 * 1. pnpm-lock.yaml exists → pnpm
 * 2. yarn.lock exists → yarn
 * 3. Else → npm
 */
export class PackageManagerDetector {
    private cache: Map<string, PackageManagerInfo> = new Map();

    /**
     * Detect package manager for a given project root
     */
    detect(projectRoot: string): PackageManagerInfo {
        // Check cache first
        const cached = this.cache.get(projectRoot);
        if (cached) {
            return cached;
        }

        // Strategy 1: Check for pnpm-lock.yaml
        const pnpmLockPath = path.join(projectRoot, 'pnpm-lock.yaml');
        if (fs.existsSync(pnpmLockPath)) {
            const result: PackageManagerInfo = {
                manager: 'pnpm',
                lockFile: 'pnpm-lock.yaml'
            };
            this.cache.set(projectRoot, result);
            return result;
        }

        // Strategy 2: Check for yarn.lock
        const yarnLockPath = path.join(projectRoot, 'yarn.lock');
        if (fs.existsSync(yarnLockPath)) {
            const result: PackageManagerInfo = {
                manager: 'yarn',
                lockFile: 'yarn.lock'
            };
            this.cache.set(projectRoot, result);
            return result;
        }

        // Strategy 3: Default to npm
        const result: PackageManagerInfo = {
            manager: 'npm',
            lockFile: 'package-lock.json' // May or may not exist
        };
        this.cache.set(projectRoot, result);
        return result;
    }

    /**
     * Get command to run with the detected package manager
     * Uses local binaries (node_modules/.bin) instead of npx
     */
    getCommand(projectRoot: string, command: string, args: string[] = []): string {
        const info = this.detect(projectRoot);
        const nodeModulesBin = path.join(projectRoot, 'node_modules', '.bin', command);
        
        // Check if local binary exists
        if (fs.existsSync(nodeModulesBin)) {
            // Use local binary directly
            return `"${nodeModulesBin}" ${args.join(' ')}`;
        }

        // Fallback: Use package manager to run command
        switch (info.manager) {
            case 'pnpm':
                return `pnpm exec ${command} ${args.join(' ')}`;
            case 'yarn':
                return `yarn ${command} ${args.join(' ')}`;
            case 'npm':
                return `npm exec -- ${command} ${args.join(' ')}`;
        }
    }

    /**
     * Clear cache (useful for testing or when lock files change)
     */
    clearCache(projectRoot?: string): void {
        if (projectRoot) {
            this.cache.delete(projectRoot);
        } else {
            this.cache.clear();
        }
    }
}

