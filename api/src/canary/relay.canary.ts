import { registerCanary } from './canary-runner.js';

const RELAY_HUB_URL = 'https://hub.raid-ledger.com';

registerCanary({
  integrationKey: 'relay-hub',
  name: 'Relay Hub',
  requiredEnvVars: [], // Public endpoint, no auth needed
  probe: async () => {
    // Simple connectivity check — the relay hub should respond to a GET
    const response = await fetch(`${RELAY_HUB_URL}/api/v1/health`, {
      signal: AbortSignal.timeout(10_000),
    });

    // Accept any 2xx or 404 (endpoint might not exist, but server is up)
    if (response.ok || response.status === 404) {
      return { status: 'PASS' };
    }

    return {
      status: 'FAIL',
      reason: `Relay Hub returned HTTP ${response.status}`,
    };
  },
});
