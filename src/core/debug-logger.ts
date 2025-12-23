import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Use a fixed location that's easy to find - user's home directory
const DEBUG_LOG_FILE = path.join(os.homedir(), 'vscode-impact-analyzer-debug.log');

export function debugLog(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    // Log to console
    console.log(logMessage.trim());
    
    // Log to file
    try {
        fs.appendFileSync(DEBUG_LOG_FILE, logMessage, 'utf8');
        // Also log the path on first write so user knows where to find it
        if (!fs.existsSync(DEBUG_LOG_FILE + '.info')) {
            fs.writeFileSync(DEBUG_LOG_FILE + '.info', `Debug log location: ${DEBUG_LOG_FILE}\n`, 'utf8');
            console.log(`[DEBUG LOG] Logging to: ${DEBUG_LOG_FILE}`);
        }
    } catch (error) {
        console.error(`[DEBUG LOG] Failed to write to ${DEBUG_LOG_FILE}:`, error);
    }
}

export function getDebugLogPath(): string {
    return DEBUG_LOG_FILE;
}

export function clearDebugLog(): void {
    try {
        if (fs.existsSync(DEBUG_LOG_FILE)) {
            fs.unlinkSync(DEBUG_LOG_FILE);
        }
    } catch (error) {
        // Ignore
    }
}

