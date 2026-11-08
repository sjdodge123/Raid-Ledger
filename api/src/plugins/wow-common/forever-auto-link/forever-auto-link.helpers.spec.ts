import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  AUTOLINK_CAP,
  AUTOLINK_MAX_BACKOFF_MS,
  AUTOLINK_MIN_LEVEL,
  autoLinkCandidateWhere,
  autoLinkDueWhere,
  autoLinkOrderBy,
  backoffDelay,
  classifyAutoLinkError,
  isAutoLinkCandidate,
  isAutoLinkCandidateShape,
  nextRetryAt,
  retryAtFor,
  stopsAutoLinkRun,
  type AutoLinkCandidateRow,
} from './forever-auto-link.helpers';
import { FOREVER_NAME_SQL_PATTERN } from '../forever-character-slug';

const HOUR = 60 * 60 * 1000;

function render(fragment: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(fragment);
}

function row(over: Partial<AutoLinkCandidateRow> = {}): AutoLinkCandidateRow {
  return {
    gameId: 7,
    addonGuid: 'Player-4372-00ABCDEF',
    gameVariant: null,
    ruleset: 'normal',
    realm: null,
    region: 'us',
    level: 25,
    name: 'Ana Forever',
    ...over,
  };
}

describe('forever-auto-link constants', () => {
  it('caps a job run at 60 candidates and requires level 10', () => {
    expect(AUTOLINK_CAP).toBe(60);
    expect(AUTOLINK_MIN_LEVEL).toBe(10);
    expect(AUTOLINK_MAX_BACKOFF_MS).toBe(24 * HOUR);
  });
});

describe('backoffDelay', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
    [6, 24],
    [7, 24],
    [40, 24],
  ])('failures=%i → %i h', (failures, hours) => {
    expect(backoffDelay(failures)).toBe(hours * HOUR);
  });

  it('treats a non-positive or fractional count as the first failure', () => {
    expect(backoffDelay(0)).toBe(HOUR);
    expect(backoffDelay(-3)).toBe(HOUR);
    expect(backoffDelay(Number.NaN)).toBe(HOUR);
  });
});

describe('nextRetryAt', () => {
  it('adds the backoff for the failure count to now', () => {
    const now = new Date('2026-11-07T10:00:00.000Z');
    expect(nextRetryAt(2, now).toISOString()).toBe('2026-11-07T12:00:00.000Z');
    expect(nextRetryAt(9, now).toISOString()).toBe('2026-11-08T10:00:00.000Z');
  });
});

describe('classifyAutoLinkError', () => {
  it('maps a NotFoundException (realmless 404) to not_found', () => {
    expect(classifyAutoLinkError(new NotFoundException('hidden'))).toBe(
      'not_found',
    );
  });

  it.each([
    ['a 502 upstream error', new BadGatewayException('429')],
    ['a 400', new BadRequestException('bad')],
    ['a plain Error', new Error('ECONNRESET')],
    ['a non-error throw', 'boom'],
    ['undefined', undefined],
  ])('maps %s to upstream', (_label, err) => {
    expect(classifyAutoLinkError(err)).toBe('upstream');
  });
});

describe('stopsAutoLinkRun', () => {
  it('stops the job run only on an upstream error', () => {
    expect(stopsAutoLinkRun('upstream')).toBe(true);
    expect(stopsAutoLinkRun('not_found')).toBe(false);
    expect(stopsAutoLinkRun('external_id_conflict')).toBe(false);
    expect(stopsAutoLinkRun('invalid_name')).toBe(false);
  });
});

describe('retryAtFor (review round 1)', () => {
  const now = new Date('2026-11-08T00:00:00.000Z');
  it('backs an invalid name off the full 24 h, whatever the count', () => {
    expect(retryAtFor('invalid_name', 1, now).getTime()).toBe(
      now.getTime() + AUTOLINK_MAX_BACKOFF_MS,
    );
  });
  it('uses the exponential backoff for every other kind', () => {
    expect(retryAtFor('not_found', 2, now)).toEqual(nextRetryAt(2, now));
    expect(retryAtFor('upstream', 1, now)).toEqual(nextRetryAt(1, now));
  });
});

describe('isAutoLinkCandidateShape (review round 1)', () => {
  it('ignores the name so the service can back a bad name off', () => {
    expect(isAutoLinkCandidateShape(row({ name: 'Ana F0rever' }), 7)).toBe(
      true,
    );
    expect(isAutoLinkCandidate(row({ name: 'Ana F0rever' }), 7)).toBe(false);
  });
  it('accepts an accented two-part name', () => {
    expect(isAutoLinkCandidate(row({ name: 'Zoë Forêt' }), 7)).toBe(true);
  });
});

describe('isAutoLinkCandidate', () => {
  it('accepts a LedgerLink-bound realmless Forever row at level 10+', () => {
    expect(isAutoLinkCandidate(row(), 7)).toBe(true);
    expect(isAutoLinkCandidate(row({ level: 10 }), 7)).toBe(true);
  });

  it('accepts an unknown level (Blizzard decides)', () => {
    expect(isAutoLinkCandidate(row({ level: null }), 7)).toBe(true);
  });

  it.each<[string, Partial<AutoLinkCandidateRow>, number]>([
    ['level 9', { level: 9 }, 7],
    ['no addon_guid', { addonGuid: null }, 7],
    ['already Armory-linked', { gameVariant: 'wow_forever' }, 7],
    ['no ruleset', { ruleset: null }, 7],
    ['a realm', { realm: 'Mankrik' }, 7],
    ['no region', { region: null }, 7],
    ['another game', {}, 8],
    ['a single-word name', { name: 'Thrall' }, 7],
    ['a three-part name', { name: 'Ana Of Forever' }, 7],
  ])('rejects a row with %s', (_label, over, foreverGameId) => {
    expect(isAutoLinkCandidate(row(over), foreverGameId)).toBe(false);
  });
});

describe('autoLinkCandidateWhere', () => {
  it('renders every candidacy clause with the game id and min level bound', () => {
    const { sql, params } = render(autoLinkCandidateWhere(7));
    expect(sql).toContain('"characters"."game_id" = $1');
    expect(sql).toContain('"characters"."addon_guid" is not null');
    expect(sql).toContain('"characters"."game_variant" is null');
    expect(sql).toContain('"characters"."ruleset" is not null');
    expect(sql).toContain('"characters"."realm" is null');
    expect(sql).toContain('"characters"."region" is not null');
    expect(sql).toContain(
      '("characters"."level" is null or "characters"."level" >= $2)',
    );
    expect(sql).toContain('btrim("characters"."name") ~ $3');
    expect(params).toEqual([7, AUTOLINK_MIN_LEVEL, FOREVER_NAME_SQL_PATTERN]);
  });
});

describe('autoLinkDueWhere', () => {
  it('is due with no state row or a passed retry_at', () => {
    const now = new Date('2026-11-07T10:00:00.000Z');
    const { sql, params } = render(autoLinkDueWhere(now));
    expect(sql).toBe(
      '("wow_forever_armory_autolink"."character_id" is null or "wow_forever_armory_autolink"."retry_at" <= $1)',
    );
    expect(params).toEqual([now.toISOString()]);
  });
});

describe('autoLinkOrderBy', () => {
  it('orders never-tried rows first, then oldest character', () => {
    const [first, second] = autoLinkOrderBy();
    expect(first && render(first).sql).toBe(
      '"wow_forever_armory_autolink"."retry_at" asc nulls first',
    );
    expect(second && render(second).sql).toBe('"characters"."created_at" asc');
  });
});
