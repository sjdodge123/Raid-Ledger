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

// — Adversarial tests —

describe('ai-admin.helpers (adversarial)', () => {
  describe('buildStatusResponse', () => {
    it('returns dockerStatus "running" when available is true', () => {
      const provider = {
        key: 'ollama',
        displayName: 'Ollama',
        selfHosted: true,
      } as LlmProvider;
      const result = buildStatusResponse(provider, null, true);
      expect(result.dockerStatus).toBe('running');
    });

    it('returns dockerStatus "unknown" when available is false', () => {
      const provider = {
        key: 'ollama',
        displayName: 'Ollama',
        selfHosted: false,
      } as LlmProvider;
      const result = buildStatusResponse(provider, null, false);
      expect(result.dockerStatus).toBe('unknown');
    });

    it('passes through currentModel as null when not set', () => {
      const result = buildStatusResponse(undefined, null, false);
      expect(result.currentModel).toBeNull();
    });

    it('passes through non-null currentModel', () => {
      const provider = {
        key: 'test',
        displayName: 'Test',
        selfHosted: false,
      } as LlmProvider;
      const result = buildStatusResponse(provider, 'mistral:latest', true);
      expect(result.currentModel).toBe('mistral:latest');
    });
  });

  describe('buildUsageResponse — edge cases', () => {
    it('handles zero totalRequests without division errors', () => {
      const result = buildUsageResponse({
        totalRequests: 0,
        requestsToday: 0,
        avgLatencyMs: 0,
        errorRate: 0,
        byFeature: [],
      });
      expect(result.totalRequests).toBe(0);
      expect(result.errorRate).toBe(0);
    });

    it('rounds avgLatencyMs down correctly', () => {
      const result = buildUsageResponse({
        totalRequests: 1,
        requestsToday: 1,
        avgLatencyMs: 99.4,
        errorRate: 0,
        byFeature: [],
      });
      expect(result.avgLatencyMs).toBe(99);
    });

    it('rounds avgLatencyMs up correctly', () => {
      const result = buildUsageResponse({
        totalRequests: 1,
        requestsToday: 1,
        avgLatencyMs: 99.5,
        errorRate: 0,
        byFeature: [],
      });
      expect(result.avgLatencyMs).toBe(100);
    });

    it('preserves byFeature count without rounding', () => {
      const result = buildUsageResponse({
        totalRequests: 5,
        requestsToday: 5,
        avgLatencyMs: 50,
        errorRate: 0,
        byFeature: [{ feature: 'categories', count: 5, avgLatencyMs: 50 }],
      });
      expect(result.byFeature[0].count).toBe(5);
    });

    it('maps multiple byFeature entries correctly', () => {
      const result = buildUsageResponse({
        totalRequests: 10,
        requestsToday: 3,
        avgLatencyMs: 100,
        errorRate: 0.1,
        byFeature: [
          { feature: 'chat', count: 6, avgLatencyMs: 110.9 },
          { feature: 'categories', count: 4, avgLatencyMs: 85.1 },
        ],
      });
      expect(result.byFeature).toHaveLength(2);
      expect(result.byFeature[0]).toMatchObject({
        feature: 'chat',
        avgLatencyMs: 111,
      });
      expect(result.byFeature[1]).toMatchObject({
        feature: 'categories',
        avgLatencyMs: 85,
      });
    });

    it('errorRate is rounded to 4 decimal places', () => {
      const result = buildUsageResponse({
        totalRequests: 100,
        requestsToday: 0,
        avgLatencyMs: 0,
        errorRate: 0.123456789,
        byFeature: [],
      });
      // Math.round(0.123456789 * 10000) / 10000 = 0.1235
      expect(result.errorRate).toBe(0.1235);
    });
  });
});
