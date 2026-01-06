"use strict";
/**
 * Unit tests for EnhancedReportFormatter
 */
Object.defineProperty(exports, "__esModule", { value: true });
const mocha_1 = require("mocha");
const chai_1 = require("chai");
const EnhancedReportFormatter_1 = require("../../src/utils/EnhancedReportFormatter");
const EnhancedImpactReport_1 = require("../../src/types/EnhancedImpactReport");
(0, mocha_1.describe)('EnhancedReportFormatter - applyHeuristicSuffix', () => {
    (0, mocha_1.it)('does not suffix denylisted rule', () => {
        const message = "Constructor was removed from exported class 'A'.";
        const ruleId = EnhancedImpactReport_1.BreakingChangeRule.JSAPI_CLS_CONSTRUCTOR_REMOVED; // 'JSAPI-CLS-003'
        const result = EnhancedReportFormatter_1.EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        (0, chai_1.expect)(result).to.equal(message);
        (0, chai_1.expect)(result).to.not.include('JavaScript heuristic');
    });
    (0, mocha_1.it)('does not suffix when message already indicates uncertainty', () => {
        const message = "Function parameter count decreased. Potential breaking change.";
        const ruleId = EnhancedImpactReport_1.BreakingChangeRule.JSAPI_FN_PARAM_COUNT_DECREASED; // 'JSAPI-FN-002'
        const result = EnhancedReportFormatter_1.EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        (0, chai_1.expect)(result).to.equal(message);
        (0, chai_1.expect)(result).to.not.include('JavaScript heuristic');
    });
    (0, mocha_1.it)('does not suffix when message contains "likely"', () => {
        const message = "Module export shape changed. This is likely breaking for consumers.";
        const ruleId = EnhancedImpactReport_1.BreakingChangeRule.JSAPI_MODULE_SYSTEM_CHANGED; // 'JSAPI-MOD-001'
        const result = EnhancedReportFormatter_1.EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        (0, chai_1.expect)(result).to.equal(message);
        (0, chai_1.expect)(result).to.not.include('JavaScript heuristic');
    });
    (0, mocha_1.it)('does not suffix when message contains "may miss"', () => {
        const message = "This analysis may miss runtime changes.";
        const ruleId = EnhancedImpactReport_1.BreakingChangeRule.JSAPI_FN_REMOVED; // 'JSAPI-FN-001'
        const result = EnhancedReportFormatter_1.EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        (0, chai_1.expect)(result).to.equal(message);
        (0, chai_1.expect)(result).to.not.include('JavaScript heuristic');
    });
    (0, mocha_1.it)('does suffix for a generic heuristic warning', () => {
        const message = "Exported function 'foo' was removed.";
        const ruleId = EnhancedImpactReport_1.BreakingChangeRule.JSAPI_FN_REMOVED; // 'JSAPI-FN-001'
        const result = EnhancedReportFormatter_1.EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        (0, chai_1.expect)(result).to.include('JavaScript heuristic - may miss runtime changes');
        (0, chai_1.expect)(result).to.equal(`${message} (JavaScript heuristic - may miss runtime changes)`);
    });
    (0, mocha_1.it)('does not suffix for non-heuristic rules', () => {
        const message = "Export 'foo' was removed.";
        const ruleId = EnhancedImpactReport_1.BreakingChangeRule.JSAPI_EXPORT_REMOVED; // 'JSAPI-EXP-001' - not heuristic
        const result = EnhancedReportFormatter_1.EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        (0, chai_1.expect)(result).to.equal(message);
        (0, chai_1.expect)(result).to.not.include('JavaScript heuristic');
    });
    (0, mocha_1.it)('does not suffix for TypeScript rules', () => {
        const message = "Function 'foo' was removed.";
        const ruleId = EnhancedImpactReport_1.BreakingChangeRule.FN_REMOVED; // TypeScript rule - not heuristic
        const result = EnhancedReportFormatter_1.EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        (0, chai_1.expect)(result).to.equal(message);
        (0, chai_1.expect)(result).to.not.include('JavaScript heuristic');
    });
});
//# sourceMappingURL=EnhancedReportFormatter.test.js.map