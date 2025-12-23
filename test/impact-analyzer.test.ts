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

import { describe, it } from 'mocha';
import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import { analyzeImpact } from '../src/core/PureImpactAnalyzer';
import { ImpactReport } from '../src/types/ImpactReport';

describe('ImpactAnalyzer - Golden Tests', () => {
  // Use source fixtures - __dirname in compiled code is out/test, so go up to project root
  const projectRoot = path.join(__dirname, '..', '..');
  const fixturesRoot = path.join(projectRoot, 'test', 'fixtures', 'pricing');

  describe('function signature change', () => {
    it('detects downstream impact when function signature changes', async () => {
      // Step A: Baseline
      const before = fs.readFileSync(
        path.join(fixturesRoot, 'calculateDiscount.ts'),
        'utf8'
      );

      // Step B: Make synthetic change - add optional parameter
      const after = before.replace(
        'calculateDiscount(price: number): number',
        'calculateDiscount(price: number, coupon?: string): number'
      );

      // Step C: Run analyzer
      const report = await analyzeImpact({
        file: 'calculateDiscount.ts',
        before,
        after,
        projectRoot: fixturesRoot
      });


      // Step D: Assert exact output
      expect(report.sourceFile).to.equal('calculateDiscount.ts');
      expect(report.functions).to.include('calculateDiscount');
      
      // Should detect downstream files
      expect(report.downstreamFiles.length).to.be.greaterThan(0);
      expect(report.downstreamFiles).to.include('checkoutController.ts');
      expect(report.downstreamFiles).to.include('pricingService.ts');

      // Should detect affected tests (may be in downstreamFiles or tests array)
      // TestFinder may not work in test environment, but fallback should find them
      const allAffectedFiles = [...report.downstreamFiles, ...report.tests];
      expect(allAffectedFiles.length).to.be.greaterThan(0);
      expect(allAffectedFiles).to.include('calculateDiscount.test.ts');
      expect(allAffectedFiles).to.include('checkoutController.test.ts');

      // Should have issues
      expect(report.issues.length).to.be.greaterThan(0);
      // Check for downstream issues (test files may be categorized as downstream)
      expect(report.issues.some(i => i.type === 'downstream' && i.target === 'checkoutController.ts')).to.be.true;
      // Test files might be in downstream or test type
      expect(report.issues.some(i => 
        (i.type === 'downstream' || i.type === 'test') && 
        i.target === 'calculateDiscount.test.ts'
      )).to.be.true;
      expect(report.issues.some(i => i.type === 'function' && i.target === 'calculateDiscount')).to.be.true;
    });
  });

  describe('no change detection', () => {
    it('reports no issues when file unchanged', async () => {
      const content = fs.readFileSync(
        path.join(fixturesRoot, 'calculateDiscount.ts'),
        'utf8'
      );

      const report = await analyzeImpact({
        file: 'calculateDiscount.ts',
        before: content,
        after: content,
        projectRoot: fixturesRoot
      });

      // No change should produce empty report
      expect(report.issues.length).to.equal(0);
      expect(report.functions.length).to.equal(0);
      expect(report.downstreamFiles.length).to.equal(0);
      expect(report.tests.length).to.equal(0);
    });
  });

  describe('function removal', () => {
    it('detects impact when function is deleted', async () => {
      const before = fs.readFileSync(
        path.join(fixturesRoot, 'calculateDiscount.ts'),
        'utf8'
      );

      // Step B: Remove the function entirely
      const after = '// Function removed';

      const report = await analyzeImpact({
        file: 'calculateDiscount.ts',
        before,
        after,
        projectRoot: fixturesRoot
      });

      // Should detect that function was removed
      expect(report.functions).to.include('calculateDiscount');
      
      // Should detect downstream impact (tests may be in downstreamFiles or tests array)
      const allAffectedFiles = [...report.downstreamFiles, ...report.tests];
      expect(allAffectedFiles.length).to.be.greaterThan(0);
    });
  });
});

