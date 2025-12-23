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
exports.ImpactSummaryFormatter = void 0;
const path = __importStar(require("path"));
/**
 * Formats impact analysis results into human-readable summary text
 * Used for console output, notifications, and status bar messages
 */
class ImpactSummaryFormatter {
    /**
     * Generate a quick summary for status bar/notifications
     * "Should I commit this change?"
     */
    static formatQuickSummary(result) {
        if (!result.hasActualChanges) {
            return '✅ No changes detected - Safe to commit';
        }
        const fileName = path.basename(result.filePath);
        const riskIcon = this.getRiskIcon(result.riskLevel);
        const confidence = Math.round(result.confidence);
        const affectedCount = result.affectedTests.length;
        const downstreamCount = result.downstreamComponents.length;
        if (affectedCount === 0 && downstreamCount === 0) {
            return `✅ ${fileName}: Low impact - Safe to commit (${confidence}% confidence)`;
        }
        return `${riskIcon} ${fileName}: ${affectedCount} tests, ${downstreamCount} at-risk components (${confidence}% confidence)`;
    }
    /**
     * Generate detailed formatted summary - the "what will break" answer
     */
    static formatDetailedSummary(result) {
        const fileName = path.basename(result.filePath);
        const lines = [];
        // Header with risk level and confidence
        const riskIcon = this.getRiskIcon(result.riskLevel);
        const confidence = Math.round(result.confidence);
        const confidenceLevel = this.getConfidenceLevel(result.confidenceResult);
        lines.push('');
        lines.push('┌─ IMPACT SUMMARY ────────────────────────────────┐');
        lines.push(`│ File: ${this.padRight(fileName, 40)} │`);
        lines.push(`│ Risk Level: ${this.padRight(riskIcon + ' ' + result.riskLevel.toUpperCase(), 38)} │`);
        lines.push(`│ Confidence: ${this.padRight(confidence + '% (' + confidenceLevel + ')', 38)} │`);
        // Changes section
        lines.push('├─ CHANGES ──────────────────────────────────────┤');
        if (result.changedFunctions.length > 0) {
            lines.push(`│ 📝 Functions (${result.changedFunctions.length}):${this.padRight('', 33 - result.changedFunctions.length.toString().length)} │`);
            result.changedFunctions.slice(0, 3).forEach(fn => {
                const shortFn = fn.length > 35 ? fn.substring(0, 32) + '...' : fn;
                lines.push(`│   • ${this.padRight(shortFn, 40)} │`);
            });
            if (result.changedFunctions.length > 3) {
                lines.push(`│   ... and ${result.changedFunctions.length - 3} more${this.padRight('', 27)} │`);
            }
        }
        if (result.changedClasses.length > 0) {
            lines.push(`│ 📦 Classes (${result.changedClasses.length}):${this.padRight('', 34 - result.changedClasses.length.toString().length)} │`);
            result.changedClasses.slice(0, 3).forEach(cls => {
                const shortCls = cls.length > 35 ? cls.substring(0, 32) + '...' : cls;
                lines.push(`│   • ${this.padRight(shortCls, 40)} │`);
            });
            if (result.changedClasses.length > 3) {
                lines.push(`│   ... and ${result.changedClasses.length - 3} more${this.padRight('', 27)} │`);
            }
        }
        if (result.changedFunctions.length === 0 && result.changedClasses.length === 0) {
            lines.push('│ (No specific changes identified)                │');
        }
        // Affected tests section
        lines.push('├─ AFFECTED TESTS ───────────────────────────────┤');
        if (result.affectedTests.length > 0) {
            lines.push(`│ 🧪 Total: ${this.padRight(result.affectedTests.length.toString(), 42)} │`);
            result.affectedTests.slice(0, 4).forEach(test => {
                const testName = path.basename(test);
                const shortTest = testName.length > 38 ? testName.substring(0, 35) + '...' : testName;
                lines.push(`│   • ${this.padRight(shortTest, 40)} │`);
            });
            if (result.affectedTests.length > 4) {
                lines.push(`│   ... and ${result.affectedTests.length - 4} more${this.padRight('', 27)} │`);
            }
        }
        else {
            lines.push('│ No affected tests detected                      │');
        }
        // At-risk components section
        lines.push('├─ AT-RISK COMPONENTS ───────────────────────────┤');
        if (result.downstreamComponents.length > 0) {
            lines.push(`│ ⚠️  Total: ${this.padRight(result.downstreamComponents.length.toString(), 39)} │`);
            result.downstreamComponents.slice(0, 4).forEach(comp => {
                const compName = path.basename(comp);
                const shortComp = compName.length > 38 ? compName.substring(0, 35) + '...' : compName;
                lines.push(`│   • ${this.padRight(shortComp, 40)} │`);
            });
            if (result.downstreamComponents.length > 4) {
                lines.push(`│   ... and ${result.downstreamComponents.length - 4} more${this.padRight('', 27)} │`);
            }
        }
        else {
            lines.push('│ No downstream dependencies detected             │');
        }
        // Footer with recommendations
        lines.push('├─ RECOMMENDED ACTIONS ──────────────────────────┤');
        const recommendation = this.getRecommendation(result);
        const recLines = this.wrapText(recommendation, 43);
        recLines.forEach((line, idx) => {
            if (idx === 0) {
                lines.push(`│ ${this.padRight(line, 43)} │`);
            }
            else {
                lines.push(`│ ${this.padRight(line, 43)} │`);
            }
        });
        lines.push('└────────────────────────────────────────────────┘');
        lines.push('');
        lines.push(`Run: Ctrl+Shift+T to run affected tests`);
        lines.push(`View: Click "Impact Analysis" in sidebar for details`);
        lines.push('');
        return lines.join('\n');
    }
    /**
     * Format confidence metrics for detailed display
     */
    static formatConfidenceMetrics(confidenceResult) {
        if (!confidenceResult) {
            return '';
        }
        const lines = [];
        const total = Math.round(confidenceResult.total);
        const status = confidenceResult.status;
        lines.push('');
        lines.push('┌─ CONFIDENCE ANALYSIS ──────────────────────────┐');
        lines.push(`│ Overall Score: ${this.padRight(total + '% (' + status + ')', 36)} │`);
        lines.push('├─ METRIC BREAKDOWN ─────────────────────────────┤');
        confidenceResult.metrics.forEach(metric => {
            const icon = this.getMetricIcon(metric.score);
            const score = Math.round(metric.score);
            const line = `│ ${icon} ${this.padRight(metric.name + ': ' + score + '%', 44)} │`;
            lines.push(line);
            // Add submetrics if present
            if (metric.subMetrics && Object.keys(metric.subMetrics).length > 0) {
                const subKeys = Object.keys(metric.subMetrics);
                subKeys.slice(0, 2).forEach(key => {
                    const value = metric.subMetrics[key];
                    const displayValue = typeof value === 'boolean' ? (value ? '✓' : '✗') : value;
                    const subLine = `│   └ ${this.padRight(key + ': ' + displayValue, 40)} │`;
                    lines.push(subLine);
                });
                if (subKeys.length > 2) {
                    lines.push(`│   └ ... and ${subKeys.length - 2} more metrics${this.padRight('', 20)} │`);
                }
            }
        });
        lines.push('├─ SUGGESTIONS ──────────────────────────────────┤');
        const allSuggestions = [];
        confidenceResult.metrics.forEach(metric => {
            if (metric.suggestions && metric.suggestions.length > 0) {
                allSuggestions.push(...metric.suggestions);
            }
        });
        if (allSuggestions.length > 0) {
            allSuggestions.slice(0, 3).forEach((suggestion) => {
                const suggestionLines = this.wrapText(suggestion, 41);
                suggestionLines.forEach((line, idx) => {
                    if (idx === 0) {
                        lines.push(`│ • ${this.padRight(line, 41)} │`);
                    }
                    else {
                        lines.push(`│   ${this.padRight(line, 41)} │`);
                    }
                });
            });
            if (allSuggestions.length > 3) {
                lines.push(`│ • ... and ${allSuggestions.length - 3} more suggestions${this.padRight('', 15)} │`);
            }
        }
        lines.push('└────────────────────────────────────────────────┘');
        lines.push('');
        return lines.join('\n');
    }
    // Helper methods
    static getRiskIcon(riskLevel) {
        switch (riskLevel) {
            case 'low':
                return '✅';
            case 'medium':
                return '🟡';
            case 'high':
                return '🔴';
            default:
                return '⚠️';
        }
    }
    static getConfidenceLevel(confidenceResult) {
        if (!confidenceResult) {
            return 'Unknown';
        }
        return confidenceResult.status || 'Unknown';
    }
    static getMetricIcon(score) {
        if (score >= 75)
            return '✅';
        if (score >= 50)
            return '🟡';
        return '🔴';
    }
    static getRecommendation(result) {
        if (!result.hasActualChanges) {
            return 'No changes detected. Safe to commit.';
        }
        if (result.riskLevel === 'low' && result.affectedTests.length === 0) {
            return 'Low-risk change with no affected tests. Ready to commit.';
        }
        if (result.riskLevel === 'high' || result.affectedTests.length > 5) {
            return 'High-risk change. Run affected tests before committing to ensure no regressions.';
        }
        if (result.downstreamComponents.length > 3) {
            return 'Multiple downstream dependencies detected. Review affected components before committing.';
        }
        return 'Review the affected tests and downstream components before committing.';
    }
    static padRight(text, width) {
        if (text.length >= width) {
            return text.substring(0, width);
        }
        return text + ' '.repeat(width - text.length);
    }
    static wrapText(text, maxWidth) {
        if (text.length <= maxWidth) {
            return [text];
        }
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        words.forEach(word => {
            if ((currentLine + word).length > maxWidth) {
                if (currentLine) {
                    lines.push(currentLine);
                }
                currentLine = word;
            }
            else {
                currentLine = currentLine ? currentLine + ' ' + word : word;
            }
        });
        if (currentLine) {
            lines.push(currentLine);
        }
        return lines;
    }
}
exports.ImpactSummaryFormatter = ImpactSummaryFormatter;
//# sourceMappingURL=ImpactSummaryFormatter.js.map