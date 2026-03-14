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

// — Adversarial tests —

describe('llm-pipeline.helpers (adversarial)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('prepareMessages — edge cases', () => {
    it('returns messages unchanged when system message already exists', () => {
      const messages = [
        { role: 'system' as const, content: 'My custom prompt' },
        { role: 'user' as const, content: 'Hello' },
      ];
      const result = prepareMessages(messages, 'Ignored base prompt');
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('My custom prompt');
    });

    it('handles empty messages array by prepending system prompt', () => {
      const result = prepareMessages([], 'Base prompt');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'system', content: 'Base prompt' });
    });

    it('does not mutate the original messages array', () => {
      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const original = [...messages];
      prepareMessages(messages, 'Base prompt');
      expect(messages).toEqual(original);
    });

    it('prepends system prompt when only assistant messages exist', () => {
      const messages = [{ role: 'assistant' as const, content: 'Hello' }];
      const result = prepareMessages(messages, 'Base prompt');
      expect(result[0].role).toBe('system');
    });
  });

  describe('enforceTokenCap — edge cases', () => {
    it('does not modify maxTokens when exactly at the cap', () => {
      const options: LlmChatOptions = { messages: [], maxTokens: 1024 };
      enforceTokenCap(options, 1024);
      expect(options.maxTokens).toBe(1024);
    });

    it('does not modify maxTokens when one below the cap', () => {
      const options: LlmChatOptions = { messages: [], maxTokens: 1023 };
      enforceTokenCap(options, 1024);
      expect(options.maxTokens).toBe(1023);
    });

    it('caps maxTokens when one above the cap', () => {
      const options: LlmChatOptions = { messages: [], maxTokens: 1025 };
      enforceTokenCap(options, 1024);
      expect(options.maxTokens).toBe(1024);
    });

    it('sets maxTokens when explicitly set to 0 (falsy)', () => {
      const options: LlmChatOptions = { messages: [], maxTokens: 0 };
      enforceTokenCap(options, 1024);
      // maxTokens=0 is falsy so it should be overwritten
      expect(options.maxTokens).toBe(1024);
    });
  });

  describe('executeWithTimeout — edge cases', () => {
    it('does not reject before timeout expires', async () => {
      jest.useFakeTimers();
      let resolved = false;
      const promise = executeWithTimeout(
        () => new Promise<string>((res) => setTimeout(() => res('done'), 50)),
        200,
      );
      jest.advanceTimersByTime(50);
      const result = await promise;
      resolved = true;
      expect(resolved).toBe(true);
      expect(result).toBe('done');
    });

    it('wraps non-Error rejections in an Error', async () => {
      const err = await executeWithTimeout(
        () => Promise.reject('plain string error'),
        1000,
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('plain string error');
    });

    it('clears the timer on successful resolution (no dangling timers)', async () => {
      jest.useFakeTimers();
      const spy = jest.spyOn(global, 'clearTimeout');
      await executeWithTimeout(() => Promise.resolve('fast'), 10_000);
      expect(spy).toHaveBeenCalled();
    });

    it('clears the timer when fn rejects early', async () => {
      jest.useFakeTimers();
      const spy = jest.spyOn(global, 'clearTimeout');
      await executeWithTimeout(
        () => Promise.reject(new Error('early reject')),
        10_000,
      ).catch(() => null);
      expect(spy).toHaveBeenCalled();
    });
  });
});
