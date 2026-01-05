/**
 * Unit tests for EnhancedReportFormatter
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { EnhancedReportFormatter } from '../../src/utils/EnhancedReportFormatter';
import { BreakingChangeRule } from '../../src/types/EnhancedImpactReport';

describe('EnhancedReportFormatter - applyHeuristicSuffix', () => {
    it('does not suffix denylisted rule', () => {
        const message = "Constructor was removed from exported class 'A'.";
        const ruleId = BreakingChangeRule.JSAPI_CLS_CONSTRUCTOR_REMOVED; // 'JSAPI-CLS-003'
        const result = EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        expect(result).to.equal(message);
        expect(result).to.not.include('JavaScript heuristic');
    });

    it('does not suffix when message already indicates uncertainty', () => {
        const message = "Function parameter count decreased. Potential breaking change.";
        const ruleId = BreakingChangeRule.JSAPI_FN_PARAM_COUNT_DECREASED; // 'JSAPI-FN-002'
        const result = EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        expect(result).to.equal(message);
        expect(result).to.not.include('JavaScript heuristic');
    });

    it('does not suffix when message contains "likely"', () => {
        const message = "Module export shape changed. This is likely breaking for consumers.";
        const ruleId = BreakingChangeRule.JSAPI_MODULE_SYSTEM_CHANGED; // 'JSAPI-MOD-001'
        const result = EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        expect(result).to.equal(message);
        expect(result).to.not.include('JavaScript heuristic');
    });

    it('does not suffix when message contains "may miss"', () => {
        const message = "This analysis may miss runtime changes.";
        const ruleId = BreakingChangeRule.JSAPI_FN_REMOVED; // 'JSAPI-FN-001'
        const result = EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        expect(result).to.equal(message);
        expect(result).to.not.include('JavaScript heuristic');
    });

    it('does suffix for a generic heuristic warning', () => {
        const message = "Exported function 'foo' was removed.";
        const ruleId = BreakingChangeRule.JSAPI_FN_REMOVED; // 'JSAPI-FN-001'
        const result = EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        expect(result).to.include('JavaScript heuristic - may miss runtime changes');
        expect(result).to.equal(`${message} (JavaScript heuristic - may miss runtime changes)`);
    });

    it('does not suffix for non-heuristic rules', () => {
        const message = "Export 'foo' was removed.";
        const ruleId = BreakingChangeRule.JSAPI_EXPORT_REMOVED; // 'JSAPI-EXP-001' - not heuristic
        const result = EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        expect(result).to.equal(message);
        expect(result).to.not.include('JavaScript heuristic');
    });

    it('does not suffix for TypeScript rules', () => {
        const message = "Function 'foo' was removed.";
        const ruleId = BreakingChangeRule.FN_REMOVED; // TypeScript rule - not heuristic
        const result = EnhancedReportFormatter.applyHeuristicSuffix(message, ruleId);
        expect(result).to.equal(message);
        expect(result).to.not.include('JavaScript heuristic');
    });
});












