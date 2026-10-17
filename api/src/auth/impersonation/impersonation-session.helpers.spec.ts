/**
 * ROK-1754: pure rules for the impersonation marker (spec §3.4.2).
 */
import {
  IMPERSONATION_TTL_MS,
  markerEndReason,
  markerExpiry,
  type UserLike,
} from './impersonation-session.helpers';
import { KICK_COOLDOWN_MS } from '../auth-status.helpers';

const NOW = new Date('2026-10-11T12:00:00Z');
const ADMIN_ID = 1;
const live = { impersonatorUserId: ADMIN_ID, expiresAt: markerExpiry(NOW) };
const admin: UserLike = { id: ADMIN_ID, role: 'admin', bannedAt: null };
const member: UserLike = { id: 2, role: 'member', bannedAt: null };

function reason(
  over: {
    marker?: typeof live;
    refreshUserId?: number;
    impersonator?: UserLike | null;
    target?: UserLike | null;
  } = {},
) {
  return markerEndReason(
    over.marker ?? live,
    over.refreshUserId ?? ADMIN_ID,
    over.impersonator === undefined ? admin : over.impersonator,
    over.target === undefined ? member : over.target,
    NOW,
  );
}

describe('markerExpiry', () => {
  it('caps a marker at exactly one hour from start', () => {
    expect(markerExpiry(NOW).getTime() - NOW.getTime()).toBe(
      IMPERSONATION_TTL_MS,
    );
    expect(IMPERSONATION_TTL_MS).toBe(3_600_000);
  });
});

describe('markerEndReason', () => {
  it('a live marker for a valid admin → member pair continues', () => {
    expect(reason()).toBeNull();
    expect(reason({ impersonator: { ...admin, role: 'operator' } })).toBeNull();
  });

  it('expired at or after expires_at', () => {
    expect(reason({ marker: { ...live, expiresAt: NOW } })).toBe('expired');
  });

  it('session_mismatch when the refresh holder is not the impersonator', () => {
    expect(reason({ refreshUserId: 99 })).toBe('session_mismatch');
  });

  it('impersonator_role_lost when demoted or missing', () => {
    expect(reason({ impersonator: { ...admin, role: 'member' } })).toBe(
      'impersonator_role_lost',
    );
    expect(reason({ impersonator: null })).toBe('impersonator_role_lost');
  });

  it('impersonator_suspended when the impersonator is banned or kicked (review m4)', () => {
    expect(reason({ impersonator: { ...admin, bannedAt: NOW } })).toBe(
      'impersonator_suspended',
    );
    expect(reason({ impersonator: { ...admin, kickedAt: NOW } })).toBe(
      'impersonator_suspended',
    );
  });

  it('target_promoted when the target is gone or now an admin', () => {
    expect(reason({ target: null })).toBe('target_promoted');
    expect(reason({ target: { ...member, role: 'admin' } })).toBe(
      'target_promoted',
    );
  });

  it('target_suspended when the target is banned', () => {
    expect(reason({ target: { ...member, bannedAt: NOW } })).toBe(
      'target_suspended',
    );
  });

  it('target_suspended when the target is kicked and still in the cooldown (review r1)', () => {
    expect(reason({ target: { ...member, kickedAt: NOW } })).toBe(
      'target_suspended',
    );
  });

  it('a stale kick past the cooldown suspends neither side (review r4)', () => {
    const stale = new Date(NOW.getTime() - KICK_COOLDOWN_MS);
    expect(reason({ target: { ...member, kickedAt: stale } })).toBeNull();
    expect(reason({ impersonator: { ...admin, kickedAt: stale } })).toBeNull();
  });
});
