/**
 * WoW: Forever namespace canary (ROK-1716). Reuses the plugin's pure probe
 * helper (no NestJS imports) against `us` only. Ruling 2026-10-04: the CI
 * canary only REPORTS — PASS with a details line, SKIP when it cannot run,
 * never FAIL (the in-app probe owns alerting).
 */
import { registerCanary } from './canary-runner.js';
import { fetchBlizzardToken } from './blizzard.canary.js';
import type { CanaryProbeResult } from './canary.interface.js';
import {
  DEFAULT_FOREVER_CANDIDATES,
  runProbe,
} from '../plugins/wow-common/forever-namespace-probe.helpers.js';

registerCanary({
  integrationKey: 'blizzard-forever-namespace',
  name: 'Blizzard WoW: Forever namespace',
  requiredEnvVars: [
    'CANARY_BLIZZARD_CLIENT_ID',
    'CANARY_BLIZZARD_CLIENT_SECRET',
  ],
  probe: () =>
    probeForeverNamespace(
      process.env.CANARY_BLIZZARD_CLIENT_ID!,
      process.env.CANARY_BLIZZARD_CLIENT_SECRET!,
    ),
});

/**
 * Probe the default Forever candidates in `us`. Never throws and never FAILs:
 * any error becomes a SKIP so the canary cannot break the CI report.
 */
export async function probeForeverNamespace(
  clientId: string,
  clientSecret: string,
): Promise<CanaryProbeResult> {
  try {
    const token = await fetchBlizzardToken(clientId, clientSecret);
    if (token.status === 'FAIL') {
      return { status: 'SKIP', reason: token.reason };
    }
    const run = await runProbe({
      fetchFn: (url, init) => fetch(url, init),
      token: token.accessToken,
      candidates: [...DEFAULT_FOREVER_CANDIDATES],
      regions: ['us'],
      characterPath: null,
    });
    const found = run.matches[0]?.prefix;
    return {
      status: 'PASS',
      details: found ? `FOUND: ${found}` : 'no Forever namespace yet',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'SKIP', reason: `Forever probe could not run: ${msg}` };
  }
}
