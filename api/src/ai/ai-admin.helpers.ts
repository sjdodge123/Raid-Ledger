import type { AiStatusDto, AiUsageDto } from '@raid-ledger/contract';
import type { LlmProvider } from './llm-provider.interface';
import type { AiUsageStats } from './ai-request-log.service';

/** Build the AI status response DTO. */
export function buildStatusResponse(
  provider: LlmProvider | undefined,
  currentModel: string | null,
  isAvailable: boolean,
  dockerStatus?: 'running' | 'stopped' | 'unknown',
): AiStatusDto {
  const resolvedDocker = dockerStatus ?? (isAvailable ? 'running' : 'unknown');
  return {
    provider: provider?.key ?? 'none',
    providerName: provider?.displayName ?? 'Not configured',
    available: isAvailable,
    currentModel,
    selfHosted: provider?.selfHosted ?? false,
    dockerStatus: resolvedDocker,
  };
}

/**
 * Derive whether an AI provider is available.
 *
 * Heartbeat-first: if a successful chat ran within the freshness window we
 * skip the live probe (cheaper, and avoids probe/chat divergence — see
 * ROK-1138). Otherwise fall through to the caller-supplied probe.
 */
export async function deriveAvailability(opts: {
  providerKey: string | null;
  lastSuccessAt: Date | null;
  probe: () => Promise<boolean>;
  now: Date;
  freshnessMs: number;
}): Promise<boolean> {
  if (opts.providerKey === null) return false;
  if (
    opts.lastSuccessAt !== null &&
    opts.now.getTime() - opts.lastSuccessAt.getTime() <= opts.freshnessMs
  ) {
    return true;
  }
  try {
    return await opts.probe();
  } catch {
    return false;
  }
}

/** Build the AI usage response DTO from raw stats. */
export function buildUsageResponse(stats: AiUsageStats): AiUsageDto {
  return {
    totalRequests: stats.totalRequests,
    requestsToday: stats.requestsToday,
    avgLatencyMs: Math.round(stats.avgLatencyMs),
    errorRate: Math.round(stats.errorRate * 10_000) / 10_000,
    byFeature: stats.byFeature.map((f) => ({
      feature: f.feature,
      count: f.count,
      avgLatencyMs: Math.round(f.avgLatencyMs),
    })),
  };
}
