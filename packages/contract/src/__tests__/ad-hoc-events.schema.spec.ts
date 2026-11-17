/**
 * ROK-2232 — a roster participant may carry a platform player id namespaced
 * by `idKind` (additive: legacy payloads without it still parse).
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from 'vitest';
import { AdHocParticipantSchema } from '../ad-hoc-events.schema.js';

const participant = {
  id: '00000000-0000-4000-8000-000000000001',
  eventId: 1,
  userId: null,
  discordUserId: null,
  steamId: null,
  source: 'steam',
  discordUsername: 'Builder',
  discordAvatarHash: null,
  joinedAt: '2026-11-17T10:00:00.000Z',
  leftAt: null,
  totalDurationSeconds: null,
  sessionCount: 1,
};

describe('AdHocParticipantSchema platform player id (ROK-2232)', () => {
  it('accepts a legacy participant with no playerId or idKind', () => {
    const parsed = AdHocParticipantSchema.parse(participant);
    expect([parsed.playerId, parsed.idKind]).toEqual([undefined, undefined]);
  });

  it('accepts an XUID participant with no SteamID', () => {
    const parsed = AdHocParticipantSchema.parse({
      ...participant,
      playerId: '2535400000000001',
      idKind: 'xuid',
    });
    expect([parsed.playerId, parsed.idKind, parsed.steamId]).toEqual([
      '2535400000000001',
      'xuid',
      null,
    ]);
  });

  it('rejects an unknown id kind', () => {
    const result = AdHocParticipantSchema.safeParse({
      ...participant,
      playerId: 'abc',
      idKind: 'psn',
    });
    expect(result.success).toBe(false);
  });
});
