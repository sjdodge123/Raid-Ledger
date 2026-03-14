import {
  prepareMessages,
  enforceTokenCap,
  executeWithTimeout,
} from './llm-pipeline.helpers';
import type { LlmChatOptions } from './llm-provider.interface';

describe('llm-pipeline.helpers', () => {
  describe('prepareMessages', () => {
    it('prepends system prompt when none exists', () => {
      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const result = prepareMessages(messages, 'You are a helper.');
      expect(result[0]).toEqual({
        role: 'system',
        content: 'You are a helper.',
      });
      expect(result).toHaveLength(2);
    });

    it('does not add system prompt when one already exists', () => {
      const messages = [
        { role: 'system' as const, content: 'Custom prompt' },
        { role: 'user' as const, content: 'Hi' },
      ];
      const result = prepareMessages(messages, 'Default prompt');
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Custom prompt');
    });
  });

  describe('enforceTokenCap', () => {
    it('sets maxTokens when not specified', () => {
      const options: LlmChatOptions = { messages: [] };
      enforceTokenCap(options, 1024);
      expect(options.maxTokens).toBe(1024);
    });

    it('caps maxTokens when it exceeds the limit', () => {
      const options: LlmChatOptions = { messages: [], maxTokens: 5000 };
      enforceTokenCap(options, 1024);
      expect(options.maxTokens).toBe(1024);
    });

    it('keeps maxTokens when within limit', () => {
      const options: LlmChatOptions = { messages: [], maxTokens: 512 };
      enforceTokenCap(options, 1024);
      expect(options.maxTokens).toBe(512);
    });
  });

  describe('executeWithTimeout', () => {
    it('resolves when function completes in time', async () => {
      const result = await executeWithTimeout(
        () => Promise.resolve('ok'),
        1000,
      );
      expect(result).toBe('ok');
    });

    it('rejects when function exceeds timeout', async () => {
      jest.useFakeTimers();
      const promise = executeWithTimeout(() => new Promise(() => {}), 100);
      jest.advanceTimersByTime(101);
      await expect(promise).rejects.toThrow('LLM request timed out');
      jest.useRealTimers();
    });

    it('propagates errors from the function', async () => {
      await expect(
        executeWithTimeout(
          () => Promise.reject(new Error('provider error')),
          1000,
        ),
      ).rejects.toThrow('provider error');
    });
  });
});
