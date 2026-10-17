/**
 * ROK-1830 S2b — core access is now game-agnostic: staff rights, the ladder →
 * boolean mapping, and delegation to the group's HUB_KIND adapter. The WoW
 * rank/delegation rules these cases used to assert live in
 * `plugins/wow-common/guilds/wow-hub-kind.adapter.spec.ts`; the SQL semantics
 * stay in `guild-access.integration.spec.ts`.
 */
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildKind, LadderRole } from '@raid-ledger/contract';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  EXTENSION_POINTS,
  type HubKindAdapter,
} from '../plugins/plugin-host/extension-points';
import { GuildAccessService, viewerAccess, type GuildActor } from './guild-access.service';
import { HubKindRegistry } from './hub-kind.registry';

const GUILD = 7;
const actor = (role: GuildActor['role']): GuildActor => ({ id: 42, role });

let db: MockDb;
let service: GuildAccessService;
let hub: HubKindAdapter;

/** A hub kind that records what core asked it, and answers `role`. */
function stubHub(role: LadderRole, memberGroupIds: number[] = []): HubKindAdapter {
  return {
    kind: 'wow_guild',
    pluginSlug: 'blizzard',
    isMember: (userId) => Promise.resolve(userId === 42),
    resolveLadder: () => Promise.resolve(role),
    memberGroupIds: () => Promise.resolve(memberGroupIds),
    rankNames: () => Promise.resolve(new Map<number, string | null>()),
    isLiveMember: () => Promise.resolve(true),
  };
}

function build(adapter: HubKindAdapter | null): void {
  db = createDrizzleMock();
  const asDb: unknown = db;
  const typedDb = asDb as PostgresJsDatabase<typeof schema>;
  const plugins = new PluginRegistryService(typedDb, new EventEmitter2());
  if (adapter) {
    plugins.registerAdapter(EXTENSION_POINTS.HUB_KIND, adapter.kind, adapter);
  }
  service = new GuildAccessService(typedDb, new HubKindRegistry(plugins, typedDb));
}

/** The guild row `findGuildKind` reads (ends at `.limit(1)`). */
function guildOfKind(kind: GuildKind): void {
  db.limit.mockResolvedValueOnce([{ kind }]);
}

beforeEach(() => {
  hub = stubHub('member');
  build(hub);
});

describe('GuildAccessService access matrix', () => {
  it.each(['admin', 'operator'] as const)(
    '%s may view, edit and manage without consulting the hub kind',
    async (role) => {
      const a = actor(role);
      expect({
        view: await service.canView(a, GUILD),
        edit: await service.canEdit(a, GUILD),
        manage: await service.canManageEditors(a, GUILD),
      }).toEqual({ view: true, edit: true, manage: true });
      expect(db.select).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['leader', true, false],
    ['officer', true, false],
    ['member', false, false],
    ['visitor', false, false],
  ] as const)(
    'a non-staff %s may edit %s and manage editors %s',
    async (role, edit, manage) => {
      build(stubHub(role));
      guildOfKind('wow_guild');
      expect(await service.canEdit(actor('member'), GUILD)).toBe(edit);
      expect(await service.canManageEditors(actor('member'), GUILD)).toBe(
        manage,
      );
    },
  );

  it('asks the hub kind whether the caller is a member', async () => {
    guildOfKind('wow_guild');
    expect(await service.isMember(42, GUILD)).toBe(true);
    guildOfKind('wow_guild');
    expect(await service.canView(actor('member'), GUILD)).toBe(true);
  });

  it('is not a member of a guild that does not exist', async () => {
    db.limit.mockResolvedValueOnce([]);
    expect(await service.isMember(42, GUILD)).toBe(false);
  });
});

describe('GuildAccessService.resolveLadder (ROK-1830)', () => {
  it.each(['admin', 'operator'] as const)(
    '%s is leader without any lookup',
    async (role) => {
      expect(await service.resolveLadder(actor(role), GUILD)).toBe('leader');
      expect(db.select).not.toHaveBeenCalled();
    },
  );

  it('returns whatever the guild kind adapter answers', async () => {
    build(stubHub('officer'));
    guildOfKind('wow_guild');
    expect(await service.resolveLadder(actor('member'), GUILD)).toBe('officer');
  });

  it('a guild that does not exist has no ladder: visitor', async () => {
    db.limit.mockResolvedValueOnce([]);
    expect(await service.resolveLadder(actor('member'), GUILD)).toBe('visitor');
  });

  it('refuses a kind no plugin registered with a 404', async () => {
    build(null);
    guildOfKind('wow_guild');
    await expect(service.resolveLadder(actor('member'), GUILD)).rejects.toThrow(
      new NotFoundException('No hub module for kind "wow_guild"'),
    );
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

describe('GuildAccessService.myGuilds', () => {
  it('returns [] and skips the guild query when no hub kind claims the user', async () => {
    expect(await service.myGuilds(42)).toEqual([]);
    expect(db.orderBy).not.toHaveBeenCalled();
  });

  it('maps each distinct guild id a hub kind reports to a summary with ISO timestamps', async () => {
    build(stubHub('member', [GUILD, GUILD]));
    const snap = new Date('2026-10-01T12:00:00.000Z');
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
