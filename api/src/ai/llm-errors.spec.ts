import { LlmQuotaExhaustedError, isQuotaExhaustedSignal } from './llm-errors';

describe('llm-errors (ROK-1376)', () => {
  describe('isQuotaExhaustedSignal', () => {
    it('classifies HTTP 429 regardless of body', () => {
      expect(isQuotaExhaustedSignal(429, '')).toBe(true);
      expect(isQuotaExhaustedSignal(429, 'anything')).toBe(true);
    });

    it('classifies RESOURCE_EXHAUSTED body on any status', () => {
      expect(
        isQuotaExhaustedSignal(500, '{"status":"RESOURCE_EXHAUSTED"}'),
      ).toBe(true);
    });

    it('classifies quota message patterns', () => {
      expect(
        isQuotaExhaustedSignal(403, 'You exceeded your current quota'),
      ).toBe(true);
    });

    it('classifies spending-cap message patterns (prod 2026-06-20 shape)', () => {
      expect(
        isQuotaExhaustedSignal(
          400,
          'Your project has exceeded its monthly spending cap',
        ),
      ).toBe(true);
    });

    it('does NOT classify generic provider failures', () => {
      expect(isQuotaExhaustedSignal(500, 'internal error')).toBe(false);
      expect(isQuotaExhaustedSignal(503, 'model overloaded')).toBe(false);
      expect(isQuotaExhaustedSignal(400, 'invalid request')).toBe(false);
    });
  });

  describe('LlmQuotaExhaustedError', () => {
    it('preserves the provider HTTP status and message', () => {
      const err = new LlmQuotaExhaustedError('Gemini: HTTP 429 — quota', 429);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('LlmQuotaExhaustedError');
      expect(err.providerStatus).toBe(429);
      expect(err.message).toContain('HTTP 429');
    });
  });
});
