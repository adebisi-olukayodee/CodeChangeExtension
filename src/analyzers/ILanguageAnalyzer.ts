/**
 * Interface for language-specific analyzers.
 * Each language should have its own analyzer that uses the appropriate AST parser and type checker.
 */

export interface CodeElement {
    name: string;
    line: number;
    column: number;
    signature?: string;
    returnType?: string;
    parameters?: Parameter[];
    isExported?: boolean;
    isAsync?: boolean;
}

export interface Parameter {
    name: string;
    type: string;
    optional: boolean;
    defaultValue?: string;
}

export interface ClassElement {
    name: string;
    line: number;
    column: number;
    methods: CodeElement[];
    properties: Property[];
    isExported?: boolean;
    extends?: string;
    implements?: string[];
}

export interface Property {
    name: string;
    type: string;
    isOptional: boolean;
    isReadonly: boolean;
}

export interface LanguageAnalysisResult {
    functions: CodeElement[];
    classes: ClassElement[];
    imports: string[];
    exports: string[];
    modules: string[];
}

/**
 * Interface that all language-specific analyzers must implement.
 */
export interface ILanguageAnalyzer {
    /**
     * Get the language identifier (e.g., 'typescript', 'python', 'java')
     */
    getLanguage(): string;

    /**
     * Get supported file extensions (e.g., ['.ts', '.tsx'])
     */
    getSupportedExtensions(): string[];

    /**
     * Analyze a file and extract code elements (functions, classes, etc.)
     * @param filePath Path to the file
     * @param content File content
     * @returns Analysis result with extracted code elements
     */
    analyze(filePath: string, content: string): Promise<LanguageAnalysisResult>;

    /**
     * Find references to a symbol (function, class, etc.) in the codebase.
     * This should use type-aware analysis when available.
     * @param symbolName Name of the symbol to find references for
     * @param filePath Path to the file containing the symbol
     * @param projectRoot Root directory of the project
     * @returns Array of file paths that reference the symbol
     */
    findReferences(
        symbolName: string,
        filePath: string,
        projectRoot: string
    ): Promise<string[]>;

    /**
     * Check if a file uses/imports a specific symbol.
     * @param filePath Path to check
     * @param symbolName Name of the symbol
     * @param projectRoot Root directory of the project
     * @returns true if the file uses the symbol
     */
    fileUsesSymbol(
        filePath: string,
        symbolName: string,
        projectRoot: string
    ): Promise<boolean>;

    /**
     * Compare two versions of code and find changed elements.
     * @param beforeContent Content before changes
     * @param afterContent Content after changes
     * @param filePath Path to the file
     * @returns Array of changed function/class names
     */
    findChangedElements(
        beforeContent: string,
        afterContent: string,
        filePath: string
    ): Promise<{
        changedFunctions: string[];
        changedClasses: string[];
    }>;
}

