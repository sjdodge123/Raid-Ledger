/**
 * Unit tests for the organiser "Rally" nudge's pure helpers (ROK-1618).
 *
 * The cooldown key and its TTL are asserted VERBATIM: `checkAndMarkSent` takes
 * SECONDS, and a value that silently became milliseconds would turn a 6-hour
 * cooldown into a 250-day one with no other symptom (same guard as
 * `scheduling-poll-nudge.integration.spec.ts`'s TTL assertion).
 */
import { POLL_RALLY_COOLDOWN_SECONDS } from '../lineup-notification.constants';
import { rallyCooldownKey } from './scheduling-rally.helpers';

describe('rallyCooldownKey', () => {
  it('namespaces the per-poll cooldown by match id', () => {
    expect(rallyCooldownKey(7)).toBe('sched-poll-rally-cooldown:7');
  });

  it('is distinct from the shared per-member nudge key', () => {
    // The per-member key is `sched-poll-nudge:{matchId}:{userId}` — sharing a
    // prefix would let one rally consume a member's 24h nudge budget.
    expect(rallyCooldownKey(7)).not.toContain('sched-poll-nudge:');
  });

  it('gives different matches different keys', () => {
    expect(rallyCooldownKey(1)).not.toBe(rallyCooldownKey(2));
  });
});

describe('POLL_RALLY_COOLDOWN_SECONDS', () => {
  it('is six hours expressed in SECONDS', () => {
    expect(POLL_RALLY_COOLDOWN_SECONDS).toBe(6 * 3600);
    expect(POLL_RALLY_COOLDOWN_SECONDS).toBe(21600);
  });

  it('sits between the 1h manual remind cooldown and the 24h nudge dedup', () => {
    expect(POLL_RALLY_COOLDOWN_SECONDS).toBeGreaterThan(3600);
    expect(POLL_RALLY_COOLDOWN_SECONDS).toBeLessThan(24 * 3600);
  });
});
