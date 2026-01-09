"use strict";
/**
 * Factory for creating language-specific analyzers.
 */
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
exports.LanguageAnalyzerFactory = void 0;
const path = __importStar(require("path"));
const TypeScriptAnalyzer_1 = require("./TypeScriptAnalyzer");
const JavaScriptAnalyzer_1 = require("./JavaScriptAnalyzer");
const PythonAnalyzer_1 = require("./PythonAnalyzer");
const JavaAnalyzer_1 = require("./JavaAnalyzer");
class LanguageAnalyzerFactory {
    /**
     * Set the project root for analyzers that need it (e.g., TypeScript for type checking)
     */
    static setProjectRoot(projectRoot) {
        this.projectRoot = projectRoot;
    }
    /**
     * Get the appropriate language analyzer for a file.
     * @param filePath Path to the file
     * @returns Language analyzer instance, or null if no analyzer available
     */
    static getAnalyzer(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        console.log(`[LanguageAnalyzerFactory] Requesting analyzer for extension: ${ext}`);
        // Check cache first
        const cached = this.analyzers.get(ext);
        if (cached) {
            console.log(`[LanguageAnalyzerFactory] Using cached analyzer: ${cached.constructor.name}`);
            return cached;
        }
        // Create analyzer based on extension
        let analyzer = null;
        if (['.ts', '.tsx'].includes(ext)) {
            console.log(`[LanguageAnalyzerFactory] Creating TypeScriptAnalyzer (projectRoot: ${this.projectRoot || 'none'})`);
            analyzer = new TypeScriptAnalyzer_1.TypeScriptAnalyzer(this.projectRoot || undefined);
        }
        else if (['.js', '.jsx'].includes(ext)) {
            console.log(`[LanguageAnalyzerFactory] Creating JavaScriptAnalyzer (heuristic analysis - projectRoot: ${this.projectRoot || 'none'})`);
            console.log(`[LanguageAnalyzerFactory] WARNING: JavaScript analysis is heuristic and may miss runtime-breaking changes`);
            analyzer = new JavaScriptAnalyzer_1.JavaScriptAnalyzer(this.projectRoot || undefined);
        }
        else if (ext === '.py') {
            console.log(`[LanguageAnalyzerFactory] Creating PythonAnalyzer`);
            analyzer = new PythonAnalyzer_1.PythonAnalyzer();
        }
        else if (ext === '.java') {
            console.log(`[LanguageAnalyzerFactory] Creating JavaAnalyzer`);
            analyzer = new JavaAnalyzer_1.JavaAnalyzer();
        }
        else {
            console.log(`[LanguageAnalyzerFactory] No analyzer available for extension: ${ext}`);
        }
        // Cache the analyzer
        if (analyzer) {
            this.analyzers.set(ext, analyzer);
            console.log(`[LanguageAnalyzerFactory] Cached analyzer: ${analyzer.constructor.name}`);
        }
        return analyzer;
    }
    /**
     * Get analyzer by language name
     */
    static getAnalyzerByLanguage(language) {
        switch (language.toLowerCase()) {
            case 'typescript':
            case 'ts':
                return new TypeScriptAnalyzer_1.TypeScriptAnalyzer(this.projectRoot || undefined);
            case 'javascript':
            case 'js':
                return new JavaScriptAnalyzer_1.JavaScriptAnalyzer(this.projectRoot || undefined);
            case 'python':
            case 'py':
                return new PythonAnalyzer_1.PythonAnalyzer();
            case 'java':
                return new JavaAnalyzer_1.JavaAnalyzer();
            default:
                return null;
        }
    }
    /**
     * Get all supported languages
     */
    static getSupportedLanguages() {
        return ['typescript', 'javascript', 'python', 'java'];
    }
    /**
     * Check if a file extension is supported
     */
    static isSupported(ext) {
        const supported = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java'];
        return supported.includes(ext.toLowerCase());
    }
    /**
     * Clear the analyzer cache (useful for testing or when project root changes)
     */
    static clearCache() {
        this.analyzers.clear();
    }
}
exports.LanguageAnalyzerFactory = LanguageAnalyzerFactory;
LanguageAnalyzerFactory.analyzers = new Map();
LanguageAnalyzerFactory.projectRoot = null;
//# sourceMappingURL=LanguageAnalyzerFactory.js.map