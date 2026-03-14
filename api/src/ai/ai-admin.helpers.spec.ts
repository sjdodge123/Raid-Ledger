import { buildStatusResponse, buildUsageResponse } from './ai-admin.helpers';
import type { LlmProvider } from './llm-provider.interface';

describe('ai-admin.helpers', () => {
  describe('buildStatusResponse', () => {
    it('builds a status response when provider is available', () => {
      const provider = {
        key: 'ollama',
        displayName: 'Ollama (Local)',
        selfHosted: true,
      } as LlmProvider;
      const result = buildStatusResponse(provider, 'llama3.2:3b', true);
      expect(result).toEqual({
        provider: 'ollama',
        providerName: 'Ollama (Local)',
        available: true,
        currentModel: 'llama3.2:3b',
        selfHosted: true,
        dockerStatus: 'running',
      });
    });

    it('handles missing provider gracefully', () => {
      const result = buildStatusResponse(undefined, null, false);
      expect(result).toEqual({
        provider: 'none',
        providerName: 'Not configured',
        available: false,
        currentModel: null,
        selfHosted: false,
        dockerStatus: 'unknown',
      });
    });
  });

  describe('buildUsageResponse', () => {
    it('rounds values and maps feature breakdown', () => {
      const result = buildUsageResponse({
        totalRequests: 100,
        requestsToday: 20,
        avgLatencyMs: 150.7,
        errorRate: 0.05123,
        byFeature: [{ feature: 'chat', count: 80, avgLatencyMs: 140.3 }],
      });
      expect(result.avgLatencyMs).toBe(151);
      expect(result.errorRate).toBe(0.0512);
      expect(result.byFeature[0].avgLatencyMs).toBe(140);
    });
  });
});
