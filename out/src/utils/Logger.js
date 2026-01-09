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
exports.debugLog = debugLog;
exports.errorLog = errorLog;
exports.warnLog = warnLog;
const vscode = __importStar(require("vscode"));
/**
 * Check if debug mode is enabled
 */
function isDebugMode() {
    const config = vscode.workspace.getConfiguration('impactAnalyzer');
    return config.get('debugMode', false);
}
/**
 * Log debug message (only shown when debugMode is enabled)
 */
function debugLog(message, ...args) {
    if (isDebugMode()) {
        console.log(message, ...args);
    }
}
/**
 * Log error message (always shown)
 */
function errorLog(message, ...args) {
    console.error(message, ...args);
}
/**
 * Log warning message (always shown)
 */
function warnLog(message, ...args) {
    console.warn(message, ...args);
}
//# sourceMappingURL=Logger.js.map