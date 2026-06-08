// ROK-1362 — Zod cap behavior. index.ts self-runs on import (server.connect),
// so we replicate the exact schema fields it registers, single-sourcing the
// teaching message from task-schemas so this can't drift from production.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { WAIT_CAP_TEACHING_MESSAGE } from '../task-schemas.js';

// Mirrors index.ts taskWaitSchema.timeout_seconds.
const taskWaitTimeout = z
  .number()
  .int()
  .min(5)
  .max(120, { message: WAIT_CAP_TEACHING_MESSAGE })
  .default(120);

// Mirrors index.ts runOnRunnerSchema.timeout_seconds (max KEPT at 7200 — >120
// is auto-routed at the execution layer, NOT rejected).
const runOnRunnerTimeout = z.number().int().min(1).max(7200).optional();

describe('rl_task_wait timeout cap (rejects >120 with a teaching message)', () => {
  it('defaults to 120 and accepts <=120', () => {
    expect(taskWaitTimeout.parse(undefined)).toBe(120);
    expect(taskWaitTimeout.parse(120)).toBe(120);
    expect(taskWaitTimeout.parse(30)).toBe(30);
  });

  it('rejects >120 with the teaching message that names the re-call pattern', () => {
    const r = taskWaitTimeout.safeParse(1800);
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues[0].message;
      expect(msg).toContain('caps each blocking call at 120s');
      expect(msg).toMatch(/SAME\s+.*task_id|same task_id/i);
      expect(msg).toContain('rl_task_status');
      // Not the useless default "Number must be less than or equal to 120".
      expect(msg).not.toMatch(/^Number must be/);
    }
  });
});

describe('rl_run_on_runner timeout schema (does NOT reject >120)', () => {
  it('accepts both short and long timeouts (routing decided at exec time)', () => {
    expect(runOnRunnerTimeout.safeParse(30).success).toBe(true);
    expect(runOnRunnerTimeout.safeParse(1800).success).toBe(true);
    expect(runOnRunnerTimeout.safeParse(7200).success).toBe(true);
    expect(runOnRunnerTimeout.safeParse(7201).success).toBe(false);
  });
});

describe('shared waitFragment cap (validate-ci / build / clone / env_deploy)', () => {
  const waitTimeout = z.number().int().min(5).max(120).default(120);
  it('defaults to 120 and rejects >120', () => {
    expect(waitTimeout.parse(undefined)).toBe(120);
    expect(waitTimeout.safeParse(1800).success).toBe(false);
  });
});

describe('widened task-id regex accepts local- ids', () => {
  const taskId = z.string().regex(/^(local-)?[a-z0-9]{8,32}$/);
  it('accepts VM ids AND local- ids', () => {
    expect(taskId.safeParse('abc123def456').success).toBe(true);
    expect(taskId.safeParse('local-3f9a2c1b8d04').success).toBe(true);
    expect(taskId.safeParse('LOCAL-xx').success).toBe(false);
  });
});
