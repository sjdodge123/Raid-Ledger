import type {
  CanaryTestDefinition,
  CanaryRunReport,
  CanaryProbeResult,
} from './canary.interface.js';

// ─── Static registry ────────────────────────────────────────────
const registry: CanaryTestDefinition[] = [];

export function registerCanary(test: CanaryTestDefinition): void {
  registry.push(test);
}

export function getRegistry(): readonly CanaryTestDefinition[] {
  return registry;
}

/**
 * Validate that all required env vars for a test are present.
 * Returns the missing var names, or an empty array if all present.
 */
function getMissingCredentials(test: CanaryTestDefinition): string[] {
  return test.requiredEnvVars.filter((v) => !process.env[v]);
}

/**
 * Run all registered canary tests sequentially.
 * Tests with missing credentials are SKIPped — they never throw.
 */
export async function runAllCanaries(): Promise<CanaryRunReport> {
  const results: CanaryRunReport['results'] = [];

  for (const test of registry) {
    const missing = getMissingCredentials(test);

    if (missing.length > 0) {
      results.push({
        integrationKey: test.integrationKey,
        name: test.name,
        result: {
          status: 'SKIP',
          reason: `Credential not configured: ${missing.join(', ')}`,
        },
      });
      continue;
    }

    let result: CanaryProbeResult;
    const start = Date.now();

    try {
      result = await test.probe();
      result.durationMs = result.durationMs ?? Date.now() - start;
    } catch (error) {
      result = {
        status: 'FAIL',
        reason: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      };
    }

    results.push({
      integrationKey: test.integrationKey,
      name: test.name,
      result,
    });
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.result.status === 'PASS').length,
    failed: results.filter((r) => r.result.status === 'FAIL').length,
    skipped: results.filter((r) => r.result.status === 'SKIP').length,
  };

  return {
    timestamp: new Date().toISOString(),
    results,
    summary,
  };
}
