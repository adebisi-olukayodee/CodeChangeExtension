"use strict";
/**
 * Golden tests for impact analysis.
 *
 * These tests verify that the analyzer correctly detects:
 * - Changed functions
 * - Downstream files that depend on changes
 * - Tests that might be affected
 *
 * Each test follows the pattern:
 * 1. Baseline: Read original file content
 * 2. Make synthetic change
 * 3. Run analyzer
 * 4. Assert exact output
 */
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
const mocha_1 = require("mocha");
const chai_1 = require("chai");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const PureImpactAnalyzer_1 = require("../src/core/PureImpactAnalyzer");
(0, mocha_1.describe)('ImpactAnalyzer - Golden Tests', () => {
    // Use source fixtures - __dirname in compiled code is out/test, so go up to project root
    const projectRoot = path.join(__dirname, '..', '..');
    const fixturesRoot = path.join(projectRoot, 'test', 'fixtures', 'pricing');
    (0, mocha_1.describe)('function signature change', () => {
        (0, mocha_1.it)('detects downstream impact when function signature changes', async () => {
            // Step A: Baseline
            const before = fs.readFileSync(path.join(fixturesRoot, 'calculateDiscount.ts'), 'utf8');
            // Step B: Make synthetic change - add optional parameter
            const after = before.replace('calculateDiscount(price: number): number', 'calculateDiscount(price: number, coupon?: string): number');
            // Step C: Run analyzer
            const report = await (0, PureImpactAnalyzer_1.analyzeImpact)({
                file: 'calculateDiscount.ts',
                before,
                after,
                projectRoot: fixturesRoot
            });
            // Step D: Assert exact output
            (0, chai_1.expect)(report.sourceFile).to.equal('calculateDiscount.ts');
            (0, chai_1.expect)(report.functions).to.include('calculateDiscount');
            // Should detect downstream files
            (0, chai_1.expect)(report.downstreamFiles.length).to.be.greaterThan(0);
            (0, chai_1.expect)(report.downstreamFiles).to.include('checkoutController.ts');
            (0, chai_1.expect)(report.downstreamFiles).to.include('pricingService.ts');
            // Should detect affected tests (may be in downstreamFiles or tests array)
            // TestFinder may not work in test environment, but fallback should find them
            const allAffectedFiles = [...report.downstreamFiles, ...report.tests];
            (0, chai_1.expect)(allAffectedFiles.length).to.be.greaterThan(0);
            (0, chai_1.expect)(allAffectedFiles).to.include('calculateDiscount.test.ts');
            (0, chai_1.expect)(allAffectedFiles).to.include('checkoutController.test.ts');
            // Should have issues
            (0, chai_1.expect)(report.issues.length).to.be.greaterThan(0);
            // Check for downstream issues (test files may be categorized as downstream)
            (0, chai_1.expect)(report.issues.some(i => i.type === 'downstream' && i.target === 'checkoutController.ts')).to.be.true;
            // Test files might be in downstream or test type
            (0, chai_1.expect)(report.issues.some(i => (i.type === 'downstream' || i.type === 'test') &&
                i.target === 'calculateDiscount.test.ts')).to.be.true;
            (0, chai_1.expect)(report.issues.some(i => i.type === 'function' && i.target === 'calculateDiscount')).to.be.true;
        });
    });
    (0, mocha_1.describe)('no change detection', () => {
        (0, mocha_1.it)('reports no issues when file unchanged', async () => {
            const content = fs.readFileSync(path.join(fixturesRoot, 'calculateDiscount.ts'), 'utf8');
            const report = await (0, PureImpactAnalyzer_1.analyzeImpact)({
                file: 'calculateDiscount.ts',
                before: content,
                after: content,
                projectRoot: fixturesRoot
            });
            // No change should produce empty report
            (0, chai_1.expect)(report.issues.length).to.equal(0);
            (0, chai_1.expect)(report.functions.length).to.equal(0);
            (0, chai_1.expect)(report.downstreamFiles.length).to.equal(0);
            (0, chai_1.expect)(report.tests.length).to.equal(0);
        });
    });
    (0, mocha_1.describe)('function removal', () => {
        (0, mocha_1.it)('detects impact when function is deleted', async () => {
            const before = fs.readFileSync(path.join(fixturesRoot, 'calculateDiscount.ts'), 'utf8');
            // Step B: Remove the function entirely
            const after = '// Function removed';
            const report = await (0, PureImpactAnalyzer_1.analyzeImpact)({
                file: 'calculateDiscount.ts',
                before,
                after,
                projectRoot: fixturesRoot
            });
            // Should detect that function was removed
            (0, chai_1.expect)(report.functions).to.include('calculateDiscount');
            // Should detect downstream impact (tests may be in downstreamFiles or tests array)
            const allAffectedFiles = [...report.downstreamFiles, ...report.tests];
            (0, chai_1.expect)(allAffectedFiles.length).to.be.greaterThan(0);
        });
    });
});
//# sourceMappingURL=impact-analyzer.test.js.map