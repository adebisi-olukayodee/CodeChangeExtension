// Mock vscode module for testing
// This allows tests to run without the full VS Code environment

// Create a mock vscode module before any imports
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(...args) {
    if (args[0] === 'vscode') {
        return {
            workspace: {
                workspaceFolders: [],
                findFiles: async () => []
            },
            window: {
                showInformationMessage: () => {},
                showErrorMessage: () => {},
                showWarningMessage: () => {}
            },
            Uri: {
                file: (path) => ({ fsPath: path })
            }
        };
    }
    return originalRequire.apply(this, args);
};


