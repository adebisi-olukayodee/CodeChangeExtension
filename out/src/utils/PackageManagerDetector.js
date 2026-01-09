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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageManagerDetector = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Detect package manager from repository
 * Order of detection:
 * 1. pnpm-lock.yaml exists → pnpm
 * 2. yarn.lock exists → yarn
 * 3. Else → npm
 */
class PackageManagerDetector {
    constructor() {
        this.cache = new Map();
    }
    /**
     * Detect package manager for a given project root
     */
    detect(projectRoot) {
        // Check cache first
        const cached = this.cache.get(projectRoot);
        if (cached) {
            return cached;
        }
        // Strategy 1: Check for pnpm-lock.yaml
        const pnpmLockPath = path.join(projectRoot, 'pnpm-lock.yaml');
        if (fs.existsSync(pnpmLockPath)) {
            const result = {
                manager: 'pnpm',
                lockFile: 'pnpm-lock.yaml'
            };
            this.cache.set(projectRoot, result);
            return result;
        }
        // Strategy 2: Check for yarn.lock
        const yarnLockPath = path.join(projectRoot, 'yarn.lock');
        if (fs.existsSync(yarnLockPath)) {
            const result = {
                manager: 'yarn',
                lockFile: 'yarn.lock'
            };
            this.cache.set(projectRoot, result);
            return result;
        }
        // Strategy 3: Default to npm
        const result = {
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
    getCommand(projectRoot, command, args = []) {
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
    clearCache(projectRoot) {
        if (projectRoot) {
            this.cache.delete(projectRoot);
        }
        else {
            this.cache.clear();
        }
    }
}
exports.PackageManagerDetector = PackageManagerDetector;
//# sourceMappingURL=PackageManagerDetector.js.map