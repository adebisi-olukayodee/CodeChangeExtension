"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfidenceMetricsExplainer = void 0;
/**
 * Provides human-readable explanations for confidence metrics and suggestions
 * Helps developers understand WHY a particular confidence score was assigned
 */
class ConfidenceMetricsExplainer {
    /**
     * Generate a detailed markdown explanation of the confidence score
     */
    static generateExplanation(confidenceResult) {
        if (!confidenceResult) {
            return 'No confidence analysis available.';
        }
        const lines = [];
        const total = Math.round(confidenceResult.total);
        const status = confidenceResult.status;
        // Header
        lines.push('# Confidence Analysis');
        lines.push('');
        lines.push(`## Overall Score: **${total}% (${status.toUpperCase()})**`);
        lines.push('');
        // Explanation of what this score means
        lines.push(this.getScoreExplanation(total, status));
        lines.push('');
        // Metrics breakdown
        lines.push('## Metric Breakdown');
        lines.push('');
        confidenceResult.metrics.forEach((metric, index) => {
            lines.push(this.formatMetricExplanation(metric));
            lines.push('');
        });
        // Actionable suggestions from metrics
        const allSuggestions = [];
        confidenceResult.metrics.forEach((metric) => {
            if (metric.suggestions && metric.suggestions.length > 0) {
                allSuggestions.push(...metric.suggestions);
            }
        });
        if (allSuggestions.length > 0) {
            lines.push('## Recommended Actions');
            lines.push('');
            allSuggestions.slice(0, 5).forEach((suggestion, idx) => {
                lines.push(`${idx + 1}. ${suggestion}`);
            });
            lines.push('');
        }
        // Risk assessment
        lines.push('## Risk Assessment');
        lines.push('');
        lines.push(this.getRiskAssessment(confidenceResult));
        return lines.join('\n');
    }
    /**
     * Get hover text for a specific metric
     */
    static getMetricHoverText(metric) {
        const explanation = this.getMetricExplanation(metric.name);
        const lines = [];
        lines.push(`**${metric.name}**: ${Math.round(metric.score)}%`);
        lines.push('');
        lines.push(explanation);
        if (metric.subMetrics && Object.keys(metric.subMetrics).length > 0) {
            lines.push('');
            lines.push('### Details:');
            Object.entries(metric.subMetrics).forEach(([key, value]) => {
                const displayValue = typeof value === 'boolean' ? (value ? '✓ Yes' : '✗ No') : value;
                lines.push(`- **${key}**: ${displayValue}`);
            });
        }
        return lines.join('\n');
    }
    /**
     * Get explanation for what each confidence metric means
     */
    static getMetricExplanation(metricName) {
        const explanations = {
            'Code Correctness': `
This metric evaluates whether your code changes are syntactically correct and type-safe.
- ✅ High (75%+): Your changes follow proper syntax and typing conventions
- 🟡 Medium (50-75%): Some type warnings or syntax concerns
- 🔴 Low (below 50%): Potential syntax errors or type mismatches that could cause runtime failures

**Why it matters**: Type-safe changes are less likely to break at runtime.
            `.trim(),
            'Security Impact': `
This metric assesses potential security implications of your changes.
- ✅ High (75%+): No security-sensitive code modified
- 🟡 Medium (50-75%): Security-adjacent code modified (logging, validation, etc.)
- 🔴 Low (below 50%): Direct security code modified (auth, encryption, access control)

**Why it matters**: Security bugs can have severe consequences. Changes to auth/crypto need extra testing.
            `.trim(),
            'Test Validation': `
This metric checks how well-tested your changes are.
- ✅ High (75%+): Strong test coverage for modified code
- 🟡 Medium (50-75%): Partial test coverage
- 🔴 Low (below 50%): Little or no test coverage for changes

**Why it matters**: Well-tested changes are less likely to cause regressions.
            `.trim(),
            'Contracts & Architecture': `
This metric evaluates whether your changes respect the code's contracts and architecture.
- ✅ High (75%+): Changes don't violate interfaces or architecture
- 🟡 Medium (50-75%): Minor contract changes (new optional parameters)
- 🔴 Low (below 50%): Breaking changes (signature changes, interface changes)

**Why it matters**: Breaking changes can cascade through your codebase and cause widespread failures.
            `.trim(),
            'Change Risk': `
This metric measures the scope and potential blast radius of your changes.
- ✅ High (75%+): Isolated changes affecting few components
- 🟡 Medium (50-75%): Moderate scope affecting several components
- 🔴 Low (below 50%): Wide-reaching changes affecting many components

**Why it matters**: Wide-reaching changes have higher probability of unexpected side effects.
            `.trim(),
            'Code Hygiene': `
This metric evaluates code quality and maintainability (informational only).
- ✅ High (75%+): Clean, well-structured code
- 🟡 Medium (50-75%): Code quality concerns present
- 🔴 Low (below 50%): Significant quality issues

**Note**: This metric is informational and doesn't affect the final confidence score.
            `.trim(),
            'default': `
This metric is used to assess code quality and risk. Higher scores indicate lower risk changes.
            `.trim()
        };
        return explanations[metricName] || explanations['default'];
    }
    /**
     * Format a single metric explanation
     */
    static formatMetricExplanation(metric) {
        const score = Math.round(metric.score);
        const icon = score >= 75 ? '✅' : score >= 50 ? '🟡' : '🔴';
        const level = score >= 75 ? 'Good' : score >= 50 ? 'Acceptable' : 'At Risk';
        let text = `### ${icon} ${metric.name}: ${score}% (${level})`;
        const explanation = this.getMetricExplanation(metric.name);
        text += '\n\n' + explanation;
        if (metric.subMetrics && Object.keys(metric.subMetrics).length > 0) {
            text += '\n\n**Assessment Details:**\n';
            Object.entries(metric.subMetrics).forEach(([key, value]) => {
                const displayValue = typeof value === 'boolean' ? (value ? '✓' : '✗') : value;
                text += `\n- ${key}: ${displayValue}`;
            });
        }
        return text;
    }
    /**
     * Get overall score explanation
     */
    static getScoreExplanation(score, status) {
        let explanation = '';
        if (status === 'CRITICAL') {
            explanation = `
🔴 **Critical Risk** - This change has significant risk factors and should not be committed without extensive testing.

**What this means:**
- Multiple confidence metrics are in the red zone
- The change affects core functionality or security
- There are likely breaking changes that could impact downstream code
- Regression potential is high

**What you should do:**
1. Run all affected tests immediately
2. Review all downstream components that depend on this code
3. Ensure backward compatibility or plan for API migration
4. Consider breaking this change into smaller, safer chunks
5. Get code review from senior team members
            `.trim();
        }
        else if (status === 'WARNING') {
            explanation = `
🟡 **Warning** - This change has some risk factors that warrant caution.

**What this means:**
- Some confidence metrics are in the yellow zone
- The change may have moderate impact on downstream code
- There could be potential for regressions

**What you should do:**
1. Run affected tests before committing
2. Review components that depend on modified code
3. Double-check any breaking changes are intentional
4. Consider whether changes can be made backward-compatible
            `.trim();
        }
        else if (status === 'ACCEPTABLE') {
            explanation = `
✅ **Acceptable** - This change has moderate confidence and can proceed with standard testing.

**What this means:**
- Most confidence metrics are in the acceptable range
- The change is reasonably isolated
- Regression risk is manageable

**What you should do:**
1. Run affected tests to confirm they pass
2. Brief review of any risky components
3. Proceed to commit once tests are green
            `.trim();
        }
        else if (status === 'SAFE') {
            explanation = `
✅ **Safe** - This change has low risk and minimal regression potential.

**What this means:**
- Confidence metrics are strong across the board
- The change is well-isolated
- Regression risk is minimal

**What you should do:**
1. You can commit with confidence
2. Standard testing should be sufficient
3. No special precautions needed
            `.trim();
        }
        return explanation;
    }
    /**
     * Generate risk assessment summary
     */
    static getRiskAssessment(confidenceResult) {
        const lines = [];
        // Identify red zone metrics
        const riskyMetrics = confidenceResult.metrics.filter((m) => m.score < 50);
        const warningMetrics = confidenceResult.metrics.filter((m) => m.score >= 50 && m.score < 75);
        const goodMetrics = confidenceResult.metrics.filter((m) => m.score >= 75);
        if (riskyMetrics.length > 0) {
            lines.push('### 🔴 Critical Concerns:');
            riskyMetrics.forEach(m => {
                lines.push(`- **${m.name}** (${Math.round(m.score)}%): This is a risk area requiring attention`);
            });
            lines.push('');
        }
        if (warningMetrics.length > 0) {
            lines.push('### 🟡 Areas to Watch:');
            warningMetrics.forEach(m => {
                lines.push(`- **${m.name}** (${Math.round(m.score)}%): Monitor this carefully`);
            });
            lines.push('');
        }
        if (goodMetrics.length > 0) {
            lines.push('### ✅ Positive Factors:');
            goodMetrics.forEach(m => {
                lines.push(`- **${m.name}** (${Math.round(m.score)}%): This looks good`);
            });
        }
        return lines.join('\n');
    }
    /**
     * Get a quick status badge
     */
    static getStatusBadge(score, status) {
        const iconMap = {
            'SAFE': '✅',
            'ACCEPTABLE': '✅',
            'WARNING': '🟡',
            'CRITICAL': '🔴'
        };
        const icon = iconMap[status] || '⚠️';
        return `${icon} ${status} (${Math.round(score)}%)`;
    }
}
exports.ConfidenceMetricsExplainer = ConfidenceMetricsExplainer;
//# sourceMappingURL=ConfidenceMetricsExplainer.js.map