/**
 * Canary test system interfaces.
 *
 * The canary module is standalone — it does NOT import from NestJS modules
 * or use DI. It runs as a plain Node script via `tsx`.
 */

export interface CanaryTestDefinition {
  /** Unique key matching a plugin integration key (e.g. 'discord-oauth') */
  integrationKey: string;
  /** Human-readable name */
  name: string;
  /** Environment variable names required for this probe */
  requiredEnvVars: string[];
  /** Execute the probe. Return a CanaryProbeResult. */
  probe: () => Promise<CanaryProbeResult>;
}

export type CanaryProbeStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface CanaryProbeResult {
  status: CanaryProbeStatus;
  /** Human-readable reason (required for FAIL/SKIP) */
  reason?: string;
  /** Duration of the probe in milliseconds */
  durationMs?: number;
  /** Optional details for issue body (e.g. HTTP status, error message) */
  details?: string;
}

export interface CanaryRunReport {
  timestamp: string;
  results: Array<{
    integrationKey: string;
    name: string;
    result: CanaryProbeResult;
  }>;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}
