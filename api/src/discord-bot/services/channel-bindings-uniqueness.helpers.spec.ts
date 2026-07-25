/**
 * ROK-1419 (B2-5): unit matrix for the non-series uniqueness helpers.
 *
 * These helpers back the two partial unique indexes restored by migration 0161:
 *   channel_bindings_nonseries_game_unique     (guild,channel,purpose,game)
 *                                              WHERE rgid IS NULL AND game IS NOT NULL
 *   channel_bindings_nonseries_nullgame_unique (guild,channel,purpose)
 *                                              WHERE rgid IS NULL AND game IS NULL
 *
 * Contract the implementer must satisfy (this file is written test-first):
 *   findConflictingBinding(candidate, existing[]) -> the row that would collide
 *     with `candidate` under EITHER partial index, or undefined. A conflict is
 *     a DIFFERENT existing row (id !== candidate.id) with the same
 *     (guildId, channelId, bindingPurpose), recurrence_group_id IS NULL on BOTH
 *     the candidate and the row, and matching game-nullness (both NULL, or both
 *     the same non-null gameId). Series rows (rgid != null) are invisible to
 *     the partial indexes and therefore never conflict.
 *   describeBindingConflict(conflict) -> operator-facing message string.
 *   mapUniqueViolation(err) -> throws ConflictException ONLY for a 23505 whose
 *     constraint name starts with `channel_bindings_nonseries_`; rethrows every
 *     other error untouched (including a 23505 on a different constraint).
 *
 * RED today: `./channel-bindings-uniqueness.helpers` does not exist yet, so the
 * whole file fails to resolve (fails-by-construction).
 */
import { ConflictException } from '@nestjs/common';
import {
  findConflictingBinding,
  describeBindingConflict,
  mapUniqueViolation,
} from './channel-bindings-uniqueness.helpers';

interface Candidate {
  id?: string;
  guildId: string;
  channelId: string;
  bindingPurpose: string;
  gameId: number | null;
  recurrenceGroupId: string | null;
}

const GUILD = 'g-1';
const CHANNEL = 'c-1';
const SERIES = '11111111-2222-3333-4444-555555555555';

function cand(overrides: Partial<Candidate> = {}): Candidate {
  return {
    guildId: GUILD,
    channelId: CHANNEL,
    bindingPurpose: 'game-voice-monitor',
    gameId: 5,
    recurrenceGroupId: null,
    ...overrides,
  };
}

describe('findConflictingBinding — conflict matrix', () => {
  it('conflict: same purpose + same game (both non-null)', () => {
    const existing: Candidate[] = [cand({ id: 'A' })];
    const hit = findConflictingBinding(cand(), existing);
    expect(hit?.id).toBe('A');
  });

  it('conflict: same purpose + both game_id NULL', () => {
    const existing: Candidate[] = [cand({ id: 'A', gameId: null })];
    const hit = findConflictingBinding(cand({ gameId: null }), existing);
    expect(hit?.id).toBe('A');
  });

  it('no conflict: different game', () => {
    const existing: Candidate[] = [cand({ id: 'A', gameId: 9 })];
    expect(
      findConflictingBinding(cand({ gameId: 5 }), existing),
    ).toBeUndefined();
  });

  it('no conflict: different purpose', () => {
    const existing: Candidate[] = [
      cand({ id: 'A', bindingPurpose: 'game-voice-monitor', gameId: null }),
    ];
    expect(
      findConflictingBinding(
        cand({ bindingPurpose: 'general-lobby', gameId: null }),
        existing,
      ),
    ).toBeUndefined();
  });

  it('no conflict: existing row is a series row (rgid != null)', () => {
    const existing: Candidate[] = [
      cand({ id: 'A', recurrenceGroupId: SERIES }),
    ];
    expect(findConflictingBinding(cand(), existing)).toBeUndefined();
  });

  it('no conflict: the candidate is the same row being updated (self-id exclusion)', () => {
    const existing: Candidate[] = [cand({ id: 'A' })];
    expect(findConflictingBinding(cand({ id: 'A' }), existing)).toBeUndefined();
  });
});

describe('describeBindingConflict', () => {
  it('returns a non-empty operator-facing message', () => {
    const conflict = cand({ id: 'A' });
    const msg = describeBindingConflict(conflict);
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('mapUniqueViolation', () => {
  it('maps a channel_bindings_nonseries_* 23505 to ConflictException', () => {
    const err = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "channel_bindings_nonseries_game_unique"',
      ),
      {
        code: '23505',
        constraint_name: 'channel_bindings_nonseries_game_unique',
      },
    );
    expect(() => mapUniqueViolation(err)).toThrow(ConflictException);
  });

  it('maps the null-game partial index 23505 to ConflictException too', () => {
    const err = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "channel_bindings_nonseries_nullgame_unique"',
      ),
      {
        code: '23505',
        constraint_name: 'channel_bindings_nonseries_nullgame_unique',
      },
    );
    expect(() => mapUniqueViolation(err)).toThrow(ConflictException);
  });

  it('rethrows a 23505 on a DIFFERENT constraint untouched (not a ConflictException)', () => {
    const err = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "channel_bindings_guild_channel_series_unique"',
      ),
      {
        code: '23505',
        constraint_name: 'channel_bindings_guild_channel_series_unique',
      },
    );
    expect(() => mapUniqueViolation(err)).toThrow(err);
    expect(() => mapUniqueViolation(err)).not.toThrow(ConflictException);
  });

  it('rethrows a non-23505 error untouched', () => {
    const err = Object.assign(new Error('fk violation'), { code: '23503' });
    expect(() => mapUniqueViolation(err)).toThrow(err);
    expect(() => mapUniqueViolation(err)).not.toThrow(ConflictException);
  });
});
