/**
 * ROK-1785 — GuildAccessService access matrix (spec §3) against the drizzle
 * mock. The membership query (`findLinkedMemberRows`) and the delegation
 * lookup both end at `.where()`; the SQL semantics of soft removal and
 * deactivation are proven in `guild-access.integration.spec.ts`.
 */
import { Test } from '@nestjs/testing';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  GM_RANK_IMPLIES_EDIT,
  GuildAccessService,
  viewerAccess,
  type GuildActor,
} from './guild-access.service';
import type { LinkedMemberRow } from '../plugins/wow-common/guilds/guild-membership.helpers';

const GUILD = 7;
const member = (id: number, rankIndex: number | null): LinkedMemberRow => ({
  guildId: GUILD,
  memberId: id,
  rankIndex,
});
const actor = (role: GuildActor['role']): GuildActor => ({ id: 42, role });

let db: MockDb;
let service: GuildAccessService;

beforeEach(async () => {
  db = createDrizzleMock();
  const mod = await Test.createTestingModule({
    providers: [
      GuildAccessService,
      { provide: DrizzleAsyncProvider, useValue: db },
    ],
  }).compile();
  service = mod.get(GuildAccessService);
});

/** Queue the membership rows, then the delegation grants (if queried). */
function queue(rows: LinkedMemberRow[], grants: { id: number }[] = []) {
  db.where.mockResolvedValueOnce(rows).mockResolvedValueOnce(grants);
}

async function matrix(a: GuildActor) {
  return {
    view: await service.canView(a, GUILD),
    edit: await service.canEdit(a, GUILD),
    manage: await service.canManageEditors(a, GUILD),
  };
}

describe('GuildAccessService access matrix', () => {
  it.each(['admin', 'operator'] as const)(
    '%s may view, edit and manage without any member row',
    async (role) => {
      expect(await matrix(actor(role))).toEqual({
        view: true,
        edit: true,
        manage: true,
      });
      expect(db.select).not.toHaveBeenCalled();
    },
  );

  it('the GM (rank 0) without a grant may view only (GM_RANK_IMPLIES_EDIT off)', async () => {
    db.where
      .mockResolvedValueOnce([member(1, 0)]) // canView
      .mockResolvedValueOnce([member(1, 0)]) // canEdit membership
      .mockResolvedValueOnce([]); // canEdit delegation: no grant
    expect(await matrix(actor('member'))).toEqual({
      view: true,
      edit: false,
      manage: false,
    });
  });

  it('the GM with an explicit member grant may edit but not manage editors', async () => {
    db.where
      .mockResolvedValueOnce([member(1, 0)]) // canView
      .mockResolvedValueOnce([member(1, 0)]) // canEdit membership
      .mockResolvedValueOnce([{ id: 8 }]); // canEdit delegation
    expect(await matrix(actor('member'))).toEqual({
      view: true,
      edit: true,
      manage: false,
    });
  });

  it('a delegated rank may edit but not manage editors', async () => {
    db.where
      .mockResolvedValueOnce([member(2, 1)]) // canView
      .mockResolvedValueOnce([member(2, 1)]) // canEdit membership
      .mockResolvedValueOnce([{ id: 9 }]); // canEdit delegation
    expect(await matrix(actor('member'))).toEqual({
      view: true,
      edit: true,
      manage: false,
    });
  });

  it('a delegated member row may edit (grant keyed by member id)', async () => {
    queue([member(3, 4)], [{ id: 10 }]);
    expect(await service.canEdit(actor('member'), GUILD)).toBe(true);
  });

  it('a plain member may view only', async () => {
    db.where
      .mockResolvedValueOnce([member(4, 3)]) // canView
      .mockResolvedValueOnce([member(4, 3)]) // canEdit membership
      .mockResolvedValueOnce([]); // canEdit delegation: no grant
    expect(await matrix(actor('member'))).toEqual({
      view: true,
      edit: false,
      manage: false,
    });
  });

  it('a non-member or soft-removed member (no live row) gets nothing', async () => {
    db.where.mockResolvedValue([]);
    expect(await matrix(actor('member'))).toEqual({
      view: false,
      edit: false,
      manage: false,
    });
    expect(await service.isMember(42, GUILD)).toBe(false);
  });

  it('a rank-less member row is still checked for a member grant', async () => {
    queue([member(5, null)], [{ id: 11 }]);
    expect(await service.canEdit(actor('member'), GUILD)).toBe(true);
  });
});

describe('GuildAccessService.resolveLadder (ROK-1830)', () => {
  it.each(['admin', 'operator'] as const)(
    '%s is leader without any member row',
    async (role) => {
      expect(await service.resolveLadder(actor(role), GUILD)).toBe('leader');
      expect(db.select).not.toHaveBeenCalled();
    },
  );

  it('an explicit grant (rank or member) makes an officer', async () => {
    queue([member(2, 1)], [{ id: 9 }]);
    expect(await service.resolveLadder(actor('member'), GUILD)).toBe('officer');
  });

  it('a live member without a grant — the GM included — is a member', async () => {
    queue([member(1, 0)], []);
    expect(await service.resolveLadder(actor('member'), GUILD)).toBe('member');
  });

  it('no live linked row is a visitor and skips the delegation lookup', async () => {
    db.where.mockResolvedValueOnce([]);
    expect(await service.resolveLadder(actor('member'), GUILD)).toBe('visitor');
    expect(db.where).toHaveBeenCalledTimes(1);
  });
});

describe('viewerAccess (ROK-1830)', () => {
  it.each([
    ['leader', true, true],
    ['officer', true, false],
    ['member', false, false],
    ['visitor', false, false],
  ] as const)('%s → canEdit %s, canManageEditors %s', (role, edit, manage) => {
    expect(viewerAccess(role)).toEqual({
      role,
      canEdit: edit,
      canManageEditors: manage,
    });
  });
});

describe('GM_RANK_IMPLIES_EDIT', () => {
  it('is off until character ownership is verified', () => {
    expect(GM_RANK_IMPLIES_EDIT).toBe(false);
  });
});

describe('GuildAccessService.myGuilds', () => {
  it('returns [] and skips the guild query for a non-member', async () => {
    db.where.mockResolvedValueOnce([]);
    expect(await service.myGuilds(42)).toEqual([]);
    expect(db.orderBy).not.toHaveBeenCalled();
  });

  it('maps each distinct guild to a summary with ISO timestamps', async () => {
    const snap = new Date('2026-10-01T12:00:00.000Z');
    db.where
      .mockResolvedValueOnce([member(1, 0), member(2, 5)])
      .mockReturnValueOnce(db);
    db.orderBy.mockResolvedValueOnce([
      {
        id: GUILD,
        gameId: 3,
        kind: 'wow_guild',
        name: 'Stormwind Guard',
        region: 'us',
        realmSlug: null,
        rawRealm: 'Doomhowl',
        faction: 'Alliance',
        memberCount: 12,
        lastSnapshotAt: snap,
      },
    ]);
    expect(await service.myGuilds(42)).toEqual([
      {
        id: GUILD,
        gameId: 3,
        kind: 'wow_guild',
        name: 'Stormwind Guard',
        region: 'us',
        realmSlug: null,
        realmName: 'Doomhowl',
        faction: 'Alliance',
        memberCount: 12,
        lastSnapshotAt: '2026-10-01T12:00:00.000Z',
      },
    ]);
  });
});
