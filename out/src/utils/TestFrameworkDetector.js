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
exports.TestFrameworkDetector = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Detect test framework from repository
 * Order of truth:
 * 1. package.json scripts (test, test:unit, test:ci)
 * 2. devDependencies (vitest, jest, @jest/core, jest-cli, mocha, ava, playwright, cypress)
 * 3. config files (vitest.config.*, jest.config.*, playwright.config.*)
 */
class TestFrameworkDetector {
    constructor() {
        this.cache = new Map();
    }
    /**
     * Detect test framework for a given project root
     */
    detect(projectRoot) {
        // Check cache first
        const cached = this.cache.get(projectRoot);
        if (cached) {
            return cached;
        }
        const evidence = [];
        let framework = 'unknown';
        let confidence = 'low';
        const packageJsonPath = path.join(projectRoot, 'package.json');
        let packageJson = null;
        if (fs.existsSync(packageJsonPath)) {
            try {
                packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            }
            catch (error) {
                // Ignore parse errors
            }
        }
        // Strategy 1: Check devDependencies for vitest OR vitest.config.* exists
        const configFiles = this.findConfigFiles(projectRoot);
        const hasVitestConfig = configFiles.some(f => f.toLowerCase().startsWith('vitest.config.'));
        if (packageJson) {
            const devDeps = packageJson.devDependencies || {};
            const deps = packageJson.dependencies || {};
            const allDeps = { ...devDeps, ...deps };
            const hasVitest = 'vitest' in allDeps;
            if (hasVitest || hasVitestConfig) {
                framework = 'vitest';
                confidence = hasVitest ? 'high' : 'medium';
                if (hasVitest) {
                    evidence.push(`vitest in dependencies`);
                }
                if (hasVitestConfig) {
                    evidence.push(`vitest.config.* exists`);
                }
            }
        }
        else if (hasVitestConfig) {
            framework = 'vitest';
            confidence = 'medium';
            evidence.push(`vitest.config.* exists`);
        }
        // Strategy 2: If not vitest, check for jest/jest-cli/@jest/core in deps OR jest.config.* exists
        if (framework === 'unknown') {
            const hasJestConfig = configFiles.some(f => f.toLowerCase().startsWith('jest.config.'));
            if (packageJson) {
                const devDeps = packageJson.devDependencies || {};
                const deps = packageJson.dependencies || {};
                const allDeps = { ...devDeps, ...deps };
                const depNames = Object.keys(allDeps).map(k => k.toLowerCase());
                const hasJest = depNames.some(name => name === 'jest' ||
                    name === 'jest-cli' ||
                    name === '@jest/core' ||
                    name.startsWith('@jest/'));
                if (hasJest || hasJestConfig) {
                    framework = 'jest';
                    confidence = hasJest ? 'high' : 'medium';
                    if (hasJest) {
                        const jestPackages = depNames.filter(name => name === 'jest' ||
                            name === 'jest-cli' ||
                            name === '@jest/core' ||
                            name.startsWith('@jest/'));
                        evidence.push(`jest/jest-cli/@jest/core in dependencies: ${jestPackages.join(', ')}`);
                    }
                    if (hasJestConfig) {
                        evidence.push(`jest.config.* exists`);
                    }
                }
            }
            else if (hasJestConfig) {
                framework = 'jest';
                confidence = 'medium';
                evidence.push(`jest.config.* exists`);
            }
        }
        // Strategy 3: If still unknown, check test script as fallback
        // (This is handled by TestRunner - it will use <pm> test and report "unknown framework")
        const result = {
            framework,
            confidence,
            evidence
        };
        // Cache result
        this.cache.set(projectRoot, result);
        return result;
    }
    /**
     * Detect framework from test script content
     */
    detectFromScript(script) {
        const normalized = script.toLowerCase();
        if (normalized.includes('vitest')) {
            return 'vitest';
        }
        if (normalized.includes('jest')) {
            return 'jest';
        }
        if (normalized.includes('mocha')) {
            return 'mocha';
        }
        if (normalized.includes('ava')) {
            return 'ava';
        }
        if (normalized.includes('playwright')) {
            return 'playwright';
        }
        if (normalized.includes('cypress')) {
            return 'cypress';
        }
        return 'unknown';
    }
    /**
     * Detect framework from dependencies
     */
    detectFromDependencies(dependencies) {
        const depNames = Object.keys(dependencies).map(k => k.toLowerCase());
        // Check for vitest
        if (depNames.some(name => name === 'vitest')) {
            return 'vitest';
        }
        // Check for jest (multiple possible package names)
        if (depNames.some(name => name === 'jest' ||
            name === '@jest/core' ||
            name === 'jest-cli' ||
            name.startsWith('@jest/'))) {
            return 'jest';
        }
        // Check for mocha
        if (depNames.some(name => name === 'mocha')) {
            return 'mocha';
        }
        // Check for ava
        if (depNames.some(name => name === 'ava')) {
            return 'ava';
        }
        // Check for playwright
        if (depNames.some(name => name === 'playwright' || name === '@playwright/test')) {
            return 'playwright';
        }
        // Check for cypress
        if (depNames.some(name => name === 'cypress')) {
            return 'cypress';
        }
        return 'unknown';
    }
    /**
     * Check if a package name is a test framework package
     */
    isTestFrameworkPackage(packageName) {
        const normalized = packageName.toLowerCase();
        return (normalized === 'vitest' ||
            normalized === 'jest' ||
            normalized === '@jest/core' ||
            normalized === 'jest-cli' ||
            normalized.startsWith('@jest/') ||
            normalized === 'mocha' ||
            normalized === 'ava' ||
            normalized === 'playwright' ||
            normalized === '@playwright/test' ||
            normalized === 'cypress');
    }
    /**
     * Find test framework config files
     */
    findConfigFiles(projectRoot) {
        const configFiles = [];
        const configPatterns = [
            'vitest.config.*',
            'jest.config.*',
            'playwright.config.*',
            'cypress.config.*',
            'mocha.opts',
            '.mocharc.*',
            'ava.config.*'
        ];
        try {
            const files = fs.readdirSync(projectRoot);
            for (const file of files) {
                const filePath = path.join(projectRoot, file);
                const stat = fs.statSync(filePath);
                if (stat.isFile()) {
                    // Check exact matches
                    if (file === 'mocha.opts') {
                        configFiles.push(file);
                        continue;
                    }
                    // Check pattern matches
                    for (const pattern of configPatterns) {
                        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
                        if (regex.test(file)) {
                            configFiles.push(file);
                            break;
                        }
                    }
                }
            }
        }
        catch (error) {
            // Ignore errors
        }
        return configFiles;
    }
    /**
     * Detect framework from config file names
     */
    detectFromConfigFiles(configFiles) {
        for (const configFile of configFiles) {
            const normalized = configFile.toLowerCase();
            if (normalized.startsWith('vitest.config.')) {
                return 'vitest';
            }
            if (normalized.startsWith('jest.config.')) {
                return 'jest';
            }
            if (normalized.startsWith('playwright.config.')) {
                return 'playwright';
            }
            if (normalized.startsWith('cypress.config.')) {
                return 'cypress';
            }
            if (normalized === 'mocha.opts' || normalized.startsWith('.mocharc.')) {
                return 'mocha';
            }
            if (normalized.startsWith('ava.config.')) {
                return 'ava';
            }
        }
        return 'unknown';
    }
    /**
     * Get test framework patterns for content-based detection
     */
    getTestPatterns(framework) {
        switch (framework) {
            case 'vitest':
            case 'jest':
                return [
                    /\bdescribe\s*\(/i,
                    /\bit\s*\(/i,
                    /\btest\s*\(/i,
                    /\bexpect\s*\(/i,
                    /\bbeforeEach\s*\(/i,
                    /\bafterEach\s*\(/i,
                    /\bbeforeAll\s*\(/i,
                    /\bafterAll\s*\(/i,
                ];
            case 'mocha':
                return [
                    /\bdescribe\s*\(/i,
                    /\bit\s*\(/i,
                    /\bbeforeEach\s*\(/i,
                    /\bafterEach\s*\(/i,
                    /\bbefore\s*\(/i,
                    /\bafter\s*\(/i,
                ];
            case 'ava':
                return [
                    /\btest\s*\(/i,
                    /\btest\.(serial|skip|only|todo)\s*\(/i,
                ];
            case 'playwright':
                return [
                    /\btest\s*\(/i,
                    /\bexpect\s*\(/i,
                    /\btest\.(describe|only|skip)\s*\(/i,
                ];
            case 'cypress':
                return [
                    /\bdescribe\s*\(/i,
                    /\bit\s*\(/i,
                    /\bcy\.(visit|get|click|type)\s*\(/i,
                ];
            default:
                // Generic patterns for unknown framework
                return [
                    /\bdescribe\s*\(/i,
                    /\bit\s*\(/i,
                    /\btest\s*\(/i,
                    /\bexpect\s*\(/i,
                ];
        }
    }
    /**
     * Clear cache (useful for testing or when package.json changes)
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
exports.TestFrameworkDetector = TestFrameworkDetector;
//# sourceMappingURL=TestFrameworkDetector.js.map