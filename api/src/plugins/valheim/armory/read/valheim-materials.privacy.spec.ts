/**
 * ROK-1853 D5/D6 — the personal-chest predicate and the read mappers, as
 * pure units. The SQL fragments are rendered with the Postgres dialect so a
 * dropped term (impersonation, the two-Steam-id guard, the claim-source
 * rule) shows up as a changed string, not a silently wider query.
 */
import { BadRequestException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { AuthenticatedUser } from '../../../../auth/types';
import {
  emptyMaterials,
  parseContainerKey,
  parseIncludeVehicles,
  toContainerSummary,
  toMaterialStack,
  toMinuteIso,
  type MaterialsContainerRow,
} from './valheim-materials.mappers';
import {
  personalVisibleSql,
  sharedSql,
  toMaterialsViewer,
  vehicleSql,
  visibleSql,
} from './valheim-materials.privacy';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);

function user(over: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 7,
    username: 'u',
    role: 'member',
    discordId: null,
    deactivatedAt: null,
    impersonatedBy: null,
    tokenVersion: 0,
    ...over,
  };
}

describe('toMaterialsViewer (D6)', () => {
  it.each([
    ['member', user({}), false, false],
    ['operator', user({ role: 'operator' }), false, false],
    ['admin', user({ role: 'admin' }), true, false],
    [
      'impersonating admin',
      user({ role: 'admin', impersonatedBy: 1 }),
      false,
      true,
    ],
    ['impersonated member', user({ impersonatedBy: 1 }), false, true],
  ])('%s', (_label, u, isAdmin, impersonated) => {
    expect(toMaterialsViewer(u)).toEqual({ id: 7, isAdmin, impersonated });
  });
});

describe('personalVisibleSql (D5)', () => {
  const member = { id: 7, isAdmin: false, impersonated: false };

  it('impersonated sessions see no private chest at all', () => {
    const q = render(personalVisibleSql({ ...member, impersonated: true }));
    expect(q.sql).toBe('false');
  });

  it('admins see every private chest and nothing shared', () => {
    const q = render(personalVisibleSql({ ...member, isAdmin: true }));
    expect(q.sql).toBe(`"valheim_containers"."privacy" = 'private'`);
    expect(q.params).toEqual([]);
  });

  it('members: own claim on that server, Steam-checked, one Steam id only', () => {
    const q = render(personalVisibleSql(member));
    expect(q.sql).toContain(`"valheim_containers"."privacy" = 'private'`);
    expect(q.sql).toContain(
      'p.pelican_server_id = "valheim_containers"."pelican_server_id"',
    );
    expect(q.sql).toContain(
      'p.player_id = "valheim_containers"."creator_player_id"',
    );
    expect(q.sql).toContain('p.claimed_by = $1');
    expect(q.sql).toContain(
      "p.claim_source = 'manual' AND u.steam_id = p.steam_id",
    );
    expect(q.sql).toMatch(/AND NOT EXISTS \([\s\S]*q\.steam_id <> p\.steam_id/);
    expect(q.params).toEqual([7]);
  });

  it('shared and vehicle fragments never carry a viewer term', () => {
    expect(render(sharedSql)).toEqual({
      sql: `"valheim_containers"."privacy" <> 'private'`,
      params: [],
    });
    expect(render(vehicleSql(true)).sql).toBe('true');
    expect(render(vehicleSql(false)).sql).toBe(
      'NOT "valheim_containers"."vehicle"',
    );
  });

  it('visibleSql = shared OR personal', () => {
    const q = render(visibleSql(member)).sql;
    expect(
      q.startsWith(`("valheim_containers"."privacy" <> 'private' OR (`),
    ).toBe(true);
  });
});

describe('materials mappers', () => {
  it('includeVehicles: default true, explicit false, else 400', () => {
    expect(parseIncludeVehicles(undefined)).toBe(true);
    expect(parseIncludeVehicles('true')).toBe(true);
    expect(parseIncludeVehicles('false')).toBe(false);
    expect(() => parseIncludeVehicles('0')).toThrow(BadRequestException);
    expect(() => parseIncludeVehicles(['true'])).toThrow(BadRequestException);
  });

  it('container key must be 22 base64url chars', () => {
    expect(parseContainerKey('A'.repeat(21) + '_')).toHaveLength(22);
    expect(() => parseContainerKey('A'.repeat(21))).toThrow(
      BadRequestException,
    );
    expect(() => parseContainerKey('A'.repeat(21) + '=')).toThrow(
      BadRequestException,
    );
  });

  it('capturedAt is truncated to the minute', () => {
    expect(toMinuteIso(new Date('2026-10-17T20:15:42.123Z'))).toBe(
      '2026-10-17T20:15:00.000Z',
    );
  });

  it('bigint totals map to numbers', () => {
    expect(
      toMaterialStack({ prefab: 'Wood', quality: 1, total: '57', chests: '2' }),
    ).toEqual({ prefab: 'Wood', quality: 1, total: 57, chests: 2 });
  });

  it('summary collapses privacy and copies only the DTO fields', () => {
    const row = {
      key: 'k'.repeat(22),
      prefab: 'piece_chest',
      x: 1,
      y: 2,
      z: 3,
      privacy: 'group',
      vehicle: false,
      slots: 30,
      usedSlots: 1,
      unreadable: false,
      omittedEntries: 0,
      stackCount: 1,
      id: 99,
      creatorPlayerId: '1000000000000001',
    } as MaterialsContainerRow & { id: number; creatorPlayerId: string };
    const out = toContainerSummary(row);
    expect(out.privacy).toBe('shared');
    expect(Object.keys(out)).not.toContain('id');
    expect(Object.keys(out)).not.toContain('creatorPlayerId');
    expect(toContainerSummary({ ...row, privacy: 'private' }).privacy).toBe(
      'personal',
    );
  });

  it('empty state: nulls and empty arrays, personal null', () => {
    const e = emptyMaterials();
    expect(e.worldUid).toBeNull();
    expect(e.personal).toBeNull();
    expect(e.shared.totals).toEqual([]);
  });
});
