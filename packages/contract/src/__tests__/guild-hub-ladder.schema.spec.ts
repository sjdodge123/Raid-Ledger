/**
 * ROK-1830 S1: the additive hub fields — `GuildSummary.kind` and
 * `GuildViewerAccess.role` (the Leader/Officer/Member/Visitor ladder).
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from 'vitest';
import {
  GUILD_KINDS,
  LADDER_ROLES,
  GuildSummarySchema,
  GuildViewerAccessSchema,
} from '../guilds.schema.js';

const summary = {
  id: 7,
  gameId: 1,
  kind: 'wow_guild',
  name: 'Iron Vanguard',
  region: 'us',
  realmSlug: null,
  realmName: null,
  faction: null,
  memberCount: 3,
  lastSnapshotAt: null,
};

describe('GuildSummarySchema.kind (ROK-1830)', () => {
  it.each(GUILD_KINDS)('accepts kind %s', (kind) => {
    expect(GuildSummarySchema.parse({ ...summary, kind }).kind).toBe(kind);
  });

  it('rejects an unknown kind on the kind path', () => {
    const r = GuildSummarySchema.safeParse({ ...summary, kind: 'clan' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['kind']);
  });

  it('requires kind', () => {
    const { kind, ...rest } = summary;
    void kind;
    expect(GuildSummarySchema.safeParse(rest).success).toBe(false);
  });
});

describe('GuildViewerAccessSchema.role (ROK-1830)', () => {
  it('lists the ladder highest first', () => {
    expect(LADDER_ROLES).toEqual(['leader', 'officer', 'member', 'visitor']);
  });

  it.each(LADDER_ROLES)('accepts role %s', (role) => {
    const v = { role, canEdit: false, canManageEditors: false };
    expect(GuildViewerAccessSchema.parse(v).role).toBe(role);
  });

  it('rejects an unknown role and a missing role', () => {
    const base = { canEdit: true, canManageEditors: false };
    const bad = GuildViewerAccessSchema.safeParse({ ...base, role: 'gm' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['role']);
    expect(GuildViewerAccessSchema.safeParse(base).success).toBe(false);
  });
});
