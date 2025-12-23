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
exports.clearDebugLog = exports.getDebugLogPath = exports.debugLog = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// Use a fixed location that's easy to find - user's home directory
const DEBUG_LOG_FILE = path.join(os.homedir(), 'vscode-impact-analyzer-debug.log');
function debugLog(message) {
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
    }
    catch (error) {
        console.error(`[DEBUG LOG] Failed to write to ${DEBUG_LOG_FILE}:`, error);
    }
}
exports.debugLog = debugLog;
function getDebugLogPath() {
    return DEBUG_LOG_FILE;
}
exports.getDebugLogPath = getDebugLogPath;
function clearDebugLog() {
    try {
        if (fs.existsSync(DEBUG_LOG_FILE)) {
            fs.unlinkSync(DEBUG_LOG_FILE);
        }
    }
    catch (error) {
        // Ignore
    }
}
exports.clearDebugLog = clearDebugLog;
//# sourceMappingURL=debug-logger.js.map