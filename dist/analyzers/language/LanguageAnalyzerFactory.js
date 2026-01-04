/**
 * Factory for creating language-specific analyzers.
 */
import * as path from 'path';
import { TypeScriptAnalyzer } from './TypeScriptAnalyzer';
import { JavaScriptAnalyzer } from './JavaScriptAnalyzer';
import { PythonAnalyzer } from './PythonAnalyzer';
import { JavaAnalyzer } from './JavaAnalyzer';
export class LanguageAnalyzerFactory {
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
            analyzer = new TypeScriptAnalyzer(this.projectRoot || undefined);
        }
        else if (['.js', '.jsx'].includes(ext)) {
            console.log(`[LanguageAnalyzerFactory] Creating JavaScriptAnalyzer (heuristic analysis - projectRoot: ${this.projectRoot || 'none'})`);
            console.log(`[LanguageAnalyzerFactory] WARNING: JavaScript analysis is heuristic and may miss runtime-breaking changes`);
            analyzer = new JavaScriptAnalyzer(this.projectRoot || undefined);
        }
        else if (ext === '.py') {
            console.log(`[LanguageAnalyzerFactory] Creating PythonAnalyzer`);
            analyzer = new PythonAnalyzer();
        }
        else if (ext === '.java') {
            console.log(`[LanguageAnalyzerFactory] Creating JavaAnalyzer`);
            analyzer = new JavaAnalyzer();
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
                return new TypeScriptAnalyzer(this.projectRoot || undefined);
            case 'javascript':
            case 'js':
                return new JavaScriptAnalyzer(this.projectRoot || undefined);
            case 'python':
            case 'py':
                return new PythonAnalyzer();
            case 'java':
                return new JavaAnalyzer();
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
LanguageAnalyzerFactory.analyzers = new Map();
LanguageAnalyzerFactory.projectRoot = null;
