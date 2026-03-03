import { registerCanary } from './canary-runner.js';

registerCanary({
  integrationKey: 'github-releases',
  name: 'GitHub',
  requiredEnvVars: [], // Public endpoint, no auth needed
  probe: async () => {
    const response = await fetch(
      'https://api.github.com/repos/sjdodge123/Raid-Ledger/releases',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'RaidLedger-Canary',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      // 404 is acceptable (no releases yet), but 403/429 means rate-limited
      if (response.status === 404) {
        return { status: 'PASS' };
      }
      return {
        status: 'FAIL',
        reason: `GitHub API returned HTTP ${response.status}`,
        details:
          response.status === 403 || response.status === 429
            ? 'Rate limited — may be transient'
            : undefined,
      };
    }

    return { status: 'PASS' };
  },
});
