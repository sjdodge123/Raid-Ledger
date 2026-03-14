import type { AiStatusDto, AiUsageDto } from '@raid-ledger/contract';
import type { LlmProvider } from './llm-provider.interface';
import type { AiUsageStats } from './ai-request-log.service';

/** Build the AI status response DTO. */
export function buildStatusResponse(
  provider: LlmProvider | undefined,
  currentModel: string | null,
  isAvailable: boolean,
): AiStatusDto {
  return {
    provider: provider?.key ?? 'none',
    providerName: provider?.displayName ?? 'Not configured',
    available: isAvailable,
    currentModel,
    selfHosted: provider?.selfHosted ?? false,
    dockerStatus: isAvailable ? 'running' : 'unknown',
  };
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
