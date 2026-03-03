#!/usr/bin/env npx tsx
/**
 * Canary CLI — standalone entry point.
 *
 * Usage:
 *   npx tsx api/src/canary/canary-cli.ts
 *   npx tsx api/src/canary/canary-cli.ts --report-github
 *
 * The canary module is standalone — it does NOT import from NestJS modules.
 */

// Import all canary test registrations (side effects)
import './discord.canary.js';
import './igdb.canary.js';
import './blizzard.canary.js';
import './github.canary.js';
import './relay.canary.js';

import { runAllCanaries } from './canary-runner.js';
import { reportToGitHub } from './canary-github-reporter.js';

const STATUS_ICONS: Record<string, string> = {
  PASS: '[PASS]',
  FAIL: '[FAIL]',
  SKIP: '[SKIP]',
};

async function main(): Promise<void> {
  const shouldReport = process.argv.includes('--report-github');

  console.log('Running canary tests...\n');

  const report = await runAllCanaries();

  // Print results
  for (const entry of report.results) {
    const icon = STATUS_ICONS[entry.result.status] ?? '[????]';
    const suffix = entry.result.reason ? ` — ${entry.result.reason}` : '';
    const duration =
      entry.result.durationMs != null ? ` (${entry.result.durationMs}ms)` : '';
    console.log(`  ${icon} ${entry.name}${duration}${suffix}`);
  }

  console.log(
    `\nSummary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped (${report.summary.total} total)\n`,
  );

  // Report to GitHub if requested and there are actionable results
  if (shouldReport) {
    const hasActionable = report.results.some(
      (r) => r.result.status === 'FAIL' || r.result.status === 'PASS',
    );

    if (hasActionable) {
      console.log('Reporting to GitHub...');
      reportToGitHub(report);
      console.log('GitHub reporting complete.');
    } else {
      console.log('No actionable results to report to GitHub (all skipped).');
    }
  }

  // Exit with non-zero if any failures
  if (report.summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Canary CLI failed:', error);
  process.exit(2);
});
