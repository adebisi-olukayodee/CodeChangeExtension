import * as vscode from 'vscode';

/**
 * Check if debug mode is enabled
 */
function isDebugMode(): boolean {
    const config = vscode.workspace.getConfiguration('impactAnalyzer');
    return config.get<boolean>('debugMode', false);
}

/**
 * Log debug message (only shown when debugMode is enabled)
 */
export function debugLog(message: string, ...args: any[]): void {
    if (isDebugMode()) {
        console.log(message, ...args);
    }
}

/**
 * Log error message (always shown)
 */
export function errorLog(message: string, ...args: any[]): void {
    console.error(message, ...args);
}

/**
 * Log warning message (always shown)
 */
export function warnLog(message: string, ...args: any[]): void {
    console.warn(message, ...args);
}

