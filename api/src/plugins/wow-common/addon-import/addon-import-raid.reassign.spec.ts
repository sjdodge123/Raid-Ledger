/**
 * ROK-1917 Codex P2 (+ round-2 review) — an exact duplicate pull keeps its
 * FIRST reporter AND content unless a hand-over happens. The raid-progress
 * trust filter (Q1) reads that reporter, so a pull would vanish once its first
 * reporter left the roster even though a current member re-imported it. The
 * rule: a re-import takes the pull only when the stored reporter is untrusted
 * (and not NULL) AND the importer is trusted — and the hand-over replaces the
 * row's CONTENT with the importer's, so an outsider's forged kill never starts
 * counting under a member's name.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { AddonEncounterPullInsert } from '../../../drizzle/schema';
import {
  buildPullInsert,
  dedupePullRows,
  takeoverEligible,
  trustWithPendingBinding,
} from './addon-import-raid.reassign';

const db = drizzle.mock({ schema });

function row(
  encounterId: number,
  startSec: number,
  success: boolean,
): AddonEncounterPullInsert {
  return {
    gameId: 1,
    region: 'us',
    encounterId,
    encounterName: `Boss ${encounterId}`,
    difficultyId: 9,
    groupSize: 40,
    instanceId: null,
    startAt: new Date(startSec * 1000),
    endAt: new Date((startSec + 60) * 1000),
    success,
    roster: [],
    guildKey: 'guild',
    reportedByUserId: 1,
    reportedByCharacterId: '00000000-0000-0000-0000-000000000001',
    payloadSha256: 'a'.repeat(64),
  };
}

describe('takeoverEligible (ROK-1917 P2)', () => {
  it('is true only for a guilded pull imported by a trusted user', () => {
    expect(takeoverEligible('guild', 1, new Set([1, 2]))).toBe(true);
  });

  it('is false for an importer off every in-scope roster', () => {
    expect(takeoverEligible('guild', 8, new Set([1, 2]))).toBe(false);
  });

  it('is false for unguilded pulls, which never count', () => {
    expect(takeoverEligible('', 1, new Set([1]))).toBe(false);
  });
});

describe('trustWithPendingBinding (ROK-1917 final P2)', () => {
  it('a first import whose pinned GUID is on the roster trusts the importer', () => {
    const trusted = trustWithPendingBinding(new Set([2]), 8, true);
    expect([...trusted].sort()).toEqual([2, 8]);
    expect(takeoverEligible('guild', 8, trusted)).toBe(true);
  });

  it('a pending GUID off every roster leaves the importer untrusted', () => {
    const trusted = trustWithPendingBinding(new Set([2]), 8, false);
    expect([...trusted]).toEqual([2]);
    expect(takeoverEligible('guild', 8, trusted)).toBe(false);
  });
});

describe('dedupePullRows (ROK-1917 P2)', () => {
  it('keeps the first row of each (encounter, start) key', () => {
    const first = row(5, 100, true);
    const out = dedupePullRows([first, row(5, 100, false), row(6, 100, false)]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(first);
  });
});

describe('buildPullInsert (ROK-1917 P2)', () => {
  it('skips every duplicate when the importer may not take over', () => {
    const { sql } = buildPullInsert(db, [row(5, 100, false)], null).toSQL();
    expect(sql).toMatch(/on conflict \([^)]*\) do nothing/);
    expect(sql).not.toMatch(/do update/);
  });

  it('a hand-over replaces the CONTENT columns, not just the reporter', () => {
    const q = buildPullInsert(db, [row(5, 100, false)], new Set([1, 2]));
    const { sql } = q.toSQL();
    for (const col of [
      'success',
      'difficulty_id',
      'end_at',
      'encounter_name',
      'group_size',
      'instance_id',
      'roster',
      'reported_by_user_id',
      'reported_by_character_id',
      'payload_sha256',
    ]) {
      expect(sql).toContain(`"${col}" = excluded."${col}"`);
    }
  });

  it('never rewrites the id, the dedupe key or importedAt', () => {
    const q = buildPullInsert(db, [row(5, 100, false)], new Set([1, 2]));
    const set = q.toSQL().sql.split('do update set')[1] ?? '';
    for (const col of [
      'id',
      'game_id',
      'region',
      'encounter_id',
      'start_at',
      'guild_key',
      'imported_at',
    ]) {
      expect(set).not.toContain(`"${col}" = excluded`);
    }
  });

  it('only takes a pull whose stored reporter is non-NULL and untrusted', () => {
    const q = buildPullInsert(db, [row(5, 100, false)], new Set([1, 2]));
    const { sql, params } = q.toSQL();
    const where = sql.split('do update set')[1] ?? '';
    expect(where).toMatch(
      /where \(?"addon_encounter_pulls"\."reported_by_user_id" is not null and "addon_encounter_pulls"\."reported_by_user_id" not in \(\$\d+, \$\d+\)/,
    );
    expect(params.slice(-2)).toEqual([1, 2]);
  });

  it('returns whether each row was a genuine insert (xmax = 0)', () => {
    const q = buildPullInsert(db, [row(5, 100, false)], new Set([1]));
    expect(q.toSQL().sql).toMatch(/returning .*\(xmax = 0\)/);
  });
});
