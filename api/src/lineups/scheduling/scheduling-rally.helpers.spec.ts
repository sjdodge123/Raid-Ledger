/**
 * Unit tests for the organiser "Rally" nudge's pure helpers (ROK-1618).
 *
 * The cooldown key and its TTL are asserted VERBATIM: `checkAndMarkSent` takes
 * SECONDS, and a value that silently became milliseconds would turn a 6-hour
 * cooldown into a 250-day one with no other symptom (same guard as
 * `scheduling-poll-nudge.integration.spec.ts`'s TTL assertion).
 *
 * The rally now owns its OWN per-member key, scoped to the leading slot, so
 * the copy and both key shapes are pinned here.
 */
import { POLL_RALLY_COOLDOWN_SECONDS } from '../lineup-notification.constants';
import {
  buildRallyCopy,
  rallyCooldownKey,
  rallyMemberKey,
} from './scheduling-rally.helpers';

describe('rallyCooldownKey', () => {
  it('namespaces the per-poll cooldown by match id', () => {
    expect(rallyCooldownKey(7)).toBe('sched-poll-rally-cooldown:7');
  });

  it('is distinct from the shared per-member nudge key', () => {
    // The cron's per-member key is `sched-poll-nudge:{matchId}:{userId}` —
    // sharing a prefix would let one rally consume the cron's 24h budget.
    expect(rallyCooldownKey(7)).not.toContain('sched-poll-nudge:');
  });

  it('gives different matches different keys', () => {
    expect(rallyCooldownKey(1)).not.toBe(rallyCooldownKey(2));
  });
});

describe('rallyMemberKey', () => {
  it('keys a member by match AND leading slot', () => {
    expect(rallyMemberKey(42, 9, 501)).toBe('sched-poll-rally:42:9:501');
  });

  it('lets a rally on a NEW leading slot reach the same member again', () => {
    expect(rallyMemberKey(42, 9, 501)).not.toBe(rallyMemberKey(42, 10, 501));
  });

  it('never collides with the cron nudge key it replaced', () => {
    expect(rallyMemberKey(42, 9, 501)).not.toContain('sched-poll-nudge:');
  });

  it('is a different string from the per-poll cooldown key', () => {
    // `sched-poll-rally:` and `sched-poll-rally-cooldown:` share a prefix but
    // are distinct keys; the member key always carries two more segments.
    expect(rallyMemberKey(42, 9, 501)).not.toBe(rallyCooldownKey(42));
  });
});

describe('buildRallyCopy', () => {
  it('asks whether the leading time works, with a Discord timestamp token', () => {
    const iso = '2026-10-01T19:00:00.000Z';
    const unix = Math.floor(Date.parse(iso) / 1000);

    expect(buildRallyCopy('Deep Rock Galactic', 3, 4, iso)).toEqual({
      title: 'Does this time work for you?',
      message:
        `3 of 4 picked <t:${unix}:f> for Deep Rock Galactic. ` +
        "Does it work for you? Vote, or say it doesn't.",
    });
  });

  it('renders the leading time as a token Discord localises, not a raw date', () => {
    const copy = buildRallyCopy('Valheim', 1, 2, '2026-10-01T19:00:00.000Z');
    expect(copy.message).toMatch(/<t:\d+:f>/);
    expect(copy.message).not.toContain('2026-10-01');
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
