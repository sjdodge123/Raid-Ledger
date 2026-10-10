/**
 * ROK-1755 — the refresh race grace is ≤ 10 s and allows ONE sibling per
 * parent; the second replay inside the window is reuse (family revoke).
 */
import { createRedisMock } from '../../common/testing/redis-mock';
import {
  RACE_GRACE_MS,
  claimGraceOnce,
  replayVerdict,
} from './refresh-grace.helpers';

describe('refresh race grace (ROK-1755)', () => {
  it('window is at most 10 seconds', () => {
    expect(RACE_GRACE_MS).toBeLessThanOrEqual(10_000);
  });

  it('first replay in the window gets a sibling, the second is reuse', async () => {
    const { client } = createRedisMock();
    const claim = () => claimGraceOnce(client, 'parent-1');
    expect(await replayVerdict(1_000, claim)).toBe('sibling');
    expect(await replayVerdict(2_000, claim)).toBe('reuse');
  });

  it('concurrent replays of one parent: exactly one sibling', async () => {
    const { client } = createRedisMock();
    const claim = () => claimGraceOnce(client, 'parent-2');
    const verdicts = await Promise.all(
      [0, 1, 2].map(() => replayVerdict(500, claim)),
    );
    expect(verdicts.filter((v) => v === 'sibling')).toHaveLength(1);
    expect(verdicts.filter((v) => v === 'reuse')).toHaveLength(2);
  });

  it('grace is per parent row', async () => {
    const { client } = createRedisMock();
    expect(await claimGraceOnce(client, 'a')).toBe('claimed');
    expect(await claimGraceOnce(client, 'b')).toBe('claimed');
  });

  it('replay older than the window is reuse without claiming', async () => {
    const claim = jest.fn();
    expect(await replayVerdict(RACE_GRACE_MS + 1, claim)).toBe('reuse');
    expect(claim).not.toHaveBeenCalled();
  });

  it('a Redis failure rejects (401) without escalating to reuse', async () => {
    const failing = { set: jest.fn().mockRejectedValue(new Error('down')) };
    const claim = () => claimGraceOnce(failing, 'parent-3');
    expect(await replayVerdict(100, claim)).toBe('reject');
  });

  it('claims with SET NX and a TTL equal to the window', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    await claimGraceOnce({ set }, 'parent-4');
    expect(set).toHaveBeenCalledWith(
      'refresh_grace:parent-4',
      '1',
      'PX',
      RACE_GRACE_MS,
      'NX',
    );
  });
});
