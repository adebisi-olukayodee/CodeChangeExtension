/**
 * Factory for creating language-specific analyzers.
 */

import * as path from 'path';
import { ILanguageAnalyzer } from '../ILanguageAnalyzer';
import { TypeScriptAnalyzer } from './TypeScriptAnalyzer';
import { PythonAnalyzer } from './PythonAnalyzer';
import { JavaAnalyzer } from './JavaAnalyzer';

export class LanguageAnalyzerFactory {
    private static analyzers: Map<string, ILanguageAnalyzer> = new Map();
    private static projectRoot: string | null = null;

    /**
     * Set the project root for analyzers that need it (e.g., TypeScript for type checking)
     */
    static setProjectRoot(projectRoot: string): void {
        this.projectRoot = projectRoot;
    }

    /**
     * Get the appropriate language analyzer for a file.
     * @param filePath Path to the file
     * @returns Language analyzer instance, or null if no analyzer available
     */
    static getAnalyzer(filePath: string): ILanguageAnalyzer | null {
        const ext = path.extname(filePath).toLowerCase();
        console.log(`[LanguageAnalyzerFactory] Requesting analyzer for extension: ${ext}`);
        
        // Check cache first
        const cached = this.analyzers.get(ext);
        if (cached) {
            console.log(`[LanguageAnalyzerFactory] Using cached analyzer: ${cached.constructor.name}`);
            return cached;
        }

        // Create analyzer based on extension
        let analyzer: ILanguageAnalyzer | null = null;

        if (['.ts', '.tsx'].includes(ext)) {
            console.log(`[LanguageAnalyzerFactory] Creating TypeScriptAnalyzer (projectRoot: ${this.projectRoot || 'none'})`);
            analyzer = new TypeScriptAnalyzer(this.projectRoot || undefined);
        } else if (ext === '.py') {
            console.log(`[LanguageAnalyzerFactory] Creating PythonAnalyzer`);
            analyzer = new PythonAnalyzer();
        } else if (ext === '.java') {
            console.log(`[LanguageAnalyzerFactory] Creating JavaAnalyzer`);
            analyzer = new JavaAnalyzer();
        } else {
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
    static getAnalyzerByLanguage(language: string): ILanguageAnalyzer | null {
        switch (language.toLowerCase()) {
            case 'typescript':
            case 'ts':
                return new TypeScriptAnalyzer(this.projectRoot || undefined);
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
    static getSupportedLanguages(): string[] {
        return ['typescript', 'python', 'java'];
    }

    /**
     * Check if a file extension is supported
     */
    static isSupported(ext: string): boolean {
        const supported = ['.ts', '.tsx', '.py', '.java'];
        return supported.includes(ext.toLowerCase());
    }

    /**
     * Clear the analyzer cache (useful for testing or when project root changes)
     */
    static clearCache(): void {
        this.analyzers.clear();
    }
}

