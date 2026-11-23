// ROK-2205 Codex P2 — the gate preflight must stay inside the 120s MCP call
// cap: CHECK-ONLY (never a ~150s force-resync) under a hard aggregate budget.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SyncGuardResult } from '../sync-guard.js';

const ensureSyncedHead = vi.fn<(...a: unknown[]) => Promise<SyncGuardResult>>();
vi.mock('../sync-guard.js', () => ({
  ensureSyncedHead: (...a: unknown[]) => ensureSyncedHead(...a),
}));

const { verifyGateSync, GATE_SYNC_BUDGET_MS } = await import('../gate-sync.js');

const HEAD = 'e9995e61aabbccddeeff00112233445566778899';

beforeEach(() => {
  ensureSyncedHead.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('verifyGateSync — check-only, time-boxed (ROK-2205 P2)', () => {
  it('keeps the budget well under the 120s MCP call cap', () => {
    expect(GATE_SYNC_BUDGET_MS).toBeLessThanOrEqual(20_000);
  });

  it('asks the guard for a check-only probe (no force-resync on the gate path)', async () => {
    ensureSyncedHead.mockResolvedValue({ ok: true, expected_head: HEAD, synced_head: HEAD, resynced: false, attempts: 1, flush_ok: true, message: 'ok' });
    await verifyGateSync(2, '/wt');

    expect(ensureSyncedHead).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 2, worktree_path: '/wt', check_only: true }),
    );
  });

  it('records verified when the guard confirms the runner tree matches HEAD', async () => {
    ensureSyncedHead.mockResolvedValue({ ok: true, expected_head: HEAD, synced_head: HEAD, resynced: false, attempts: 1, flush_ok: true, message: 'ok' });
    const rec = await verifyGateSync(2, '/wt');

    expect(rec).toEqual({ ok: true, expected_head: HEAD, synced_head: HEAD });
  });

  it('records not-verified with a check-only reason on a mismatch', async () => {
    ensureSyncedHead.mockResolvedValue({ ok: false, error: 'sync_stuck', expected_head: HEAD, synced_head: null, resynced: false, attempts: 1, flush_ok: true, message: 'stale' });
    const rec = await verifyGateSync(2, '/wt');

    expect(rec.ok).toBe(false);
    expect(rec.message).toMatch(/did not match/);
    expect(rec.message).not.toMatch(/after a force-resync/);
  });

  it('records not-verified once the budget runs out, without waiting on the probe', async () => {
    vi.useFakeTimers();
    ensureSyncedHead.mockImplementation(() => new Promise<SyncGuardResult>(() => {}));
    let settled: Awaited<ReturnType<typeof verifyGateSync>> | null = null;
    void verifyGateSync(2, '/wt').then((r) => { settled = r; });

    await vi.advanceTimersByTimeAsync(GATE_SYNC_BUDGET_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toEqual(expect.objectContaining({ ok: false, synced_head: null }));
    expect((settled as { message?: string } | null)?.message).toMatch(/timed out after 20s/);
  });
});
