// Rollout guard: a stale VM that rejects `--weight medium` gets one `light` retry.
import { describe, it, expect, vi } from 'vitest';
import {
  dispatchWithWeightFallback,
  isInvalidWeightRejection,
} from '../task-weight-fallback.js';
import type { TaskWeight } from '../task-weight.js';

const rejection = (): Error & { stderr: string; code: number } =>
  Object.assign(new Error('Command failed'), {
    stderr: '{"ok":false,"error":"invalid_weight","weight":"medium"}\n',
    code: 2,
  });

describe('dispatchWithWeightFallback', () => {
  it('retries a medium task once with light when task-start answers invalid_weight', async () => {
    const seen: TaskWeight[] = [];
    const log = vi.fn();
    const out = await dispatchWithWeightFallback(
      'medium',
      async (w) => {
        seen.push(w);
        if (w === 'medium') throw rejection();
        return 'dispatched';
      },
      log,
    ).catch((err: unknown) => ({ rethrown: String(err) }));
    expect(seen, 'one medium attempt, then exactly one light retry').toEqual(['medium', 'light']);
    expect(out).toEqual({ value: 'dispatched', weight: 'light' });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain('retrying once with weight=light');
  });

  it('does not retry when medium is accepted', async () => {
    const dispatch = vi.fn(async (w: TaskWeight) => w);
    const out = await dispatchWithWeightFallback('medium', dispatch, vi.fn());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ value: 'medium', weight: 'medium' });
  });

  it('propagates an invalid_weight rejection of a heavy task (no retry)', async () => {
    const dispatch = vi.fn(async () => {
      throw rejection();
    });
    await expect(dispatchWithWeightFallback('heavy', dispatch, vi.fn())).rejects.toThrow(
      'Command failed',
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('propagates any other medium failure without retrying', async () => {
    const dispatch = vi.fn(async () => {
      throw Object.assign(new Error('ssh down'), { stderr: 'Connection refused' });
    });
    await expect(dispatchWithWeightFallback('medium', dispatch, vi.fn())).rejects.toThrow('ssh down');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('surfaces the light retry failure if the retry fails too', async () => {
    const dispatch = vi.fn(async (w: TaskWeight) => {
      throw w === 'medium' ? rejection() : new Error('light failed too');
    });
    await expect(dispatchWithWeightFallback('medium', dispatch, vi.fn())).rejects.toThrow(
      'light failed too',
    );
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe('isInvalidWeightRejection', () => {
  it('matches only the task-start invalid_weight JSON on stderr', () => {
    expect(isInvalidWeightRejection(rejection())).toBe(true);
    expect(isInvalidWeightRejection({ stderr: '{"error":"invalid_task_id"}' })).toBe(false);
    expect(isInvalidWeightRejection(new Error('invalid_weight'))).toBe(false);
    expect(isInvalidWeightRejection(null)).toBe(false);
  });
});
