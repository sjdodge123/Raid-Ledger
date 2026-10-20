/**
 * ROK-1870 D14 / OQ-5 + §2.5 — the two community-hub widenings of core
 * access: visitors read the Overview widgets (`canReadOverview`), and a
 * community Leader manages the Discord channel (`canManageDiscord`) while a
 * WoW GM stays refused (ROK-1830 D5-A).
 */
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
import { GuildAccessService, type GuildActor } from './guild-access.service';
import { HubKindRegistry } from './hub-kind.registry';

const GUILD = 7;
const MEMBER_ID = 42;
const actor = (
  id: number,
  role: GuildActor['role'] = 'member',
): GuildActor => ({
  id,
  role,
});

let db: MockDb;
let service: GuildAccessService;

/** A hub kind whose only member is user 42 and whose ladder answers `role`. */
function stubHub(kind: GuildKind, role: LadderRole): HubKindAdapter {
  return {
    kind,
    pluginSlug: 'core',
    isMember: (userId) => Promise.resolve(userId === MEMBER_ID),
    resolveLadder: () => Promise.resolve(role),
    memberGroupIds: () => Promise.resolve([]),
    rankNames: () => Promise.resolve(new Map<number, string | null>()),
    isLiveMember: () => Promise.resolve(false),
    memberUserIds: () => Promise.resolve([]),
    page: () => Promise.reject(new Error('unused')),
    raids: () => Promise.reject(new Error('unused')),
  };
}

function build(adapter: HubKindAdapter): void {
  db = createDrizzleMock();
  const asDb: unknown = db;
  const typedDb = asDb as PostgresJsDatabase<typeof schema>;
  const plugins = new PluginRegistryService(typedDb, new EventEmitter2());
  plugins.registerAdapter(EXTENSION_POINTS.HUB_KIND, adapter.kind, adapter);
  service = new GuildAccessService(
    typedDb,
    new HubKindRegistry(plugins, typedDb),
  );
}

/** Queue the guild rows the next `.limit(1)` reads answer, in order. */
function rows(...answers: object[][]): void {
  for (const a of answers) db.limit.mockResolvedValueOnce(a);
}

const community = (status: string, hiddenAt: Date | null = null) => ({
  kind: 'game_community',
  status,
  hiddenAt,
});

describe('GuildAccessService.canReadOverview (D14)', () => {
  beforeEach(() => build(stubHub('game_community', 'visitor')));

  it('admits a signed-in visitor on an active community hub', async () => {
    rows([{ kind: 'game_community' }], [community('active')]);
    expect(await service.canReadOverview(actor(99), GUILD)).toBe(true);
  });

  it('admits a member through canView without the visibility read', async () => {
    rows([{ kind: 'game_community' }]);
    expect(await service.canReadOverview(actor(MEMBER_ID), GUILD)).toBe(true);
    expect(db.limit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['proposed', community('proposed')],
    ['archived', community('archived')],
    ['hidden', community('active', new Date())],
  ])('refuses a visitor on a %s community hub', async (_label, row) => {
    rows([{ kind: 'game_community' }], [row]);
    expect(await service.canReadOverview(actor(99), GUILD)).toBe(false);
  });

  it('refuses a visitor on a WoW guild and on a missing guild', async () => {
    build(stubHub('wow_guild', 'visitor'));
    rows(
      [{ kind: 'wow_guild' }],
      [{ ...community('active'), kind: 'wow_guild' }],
    );
    expect(await service.canReadOverview(actor(99), GUILD)).toBe(false);
    rows([], []);
    expect(await service.canReadOverview(actor(99), GUILD)).toBe(false);
  });
});

describe('GuildAccessService.canManageDiscord (§2.5 + D5-A)', () => {
  it.each(['admin', 'operator'] as const)(
    '%s manages without a lookup',
    async (role) => {
      build(stubHub('wow_guild', 'visitor'));
      expect(await service.canManageDiscord(actor(1, role), GUILD)).toBe(true);
      expect(db.select).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['leader', true],
    ['officer', false],
    ['member', false],
    ['visitor', false],
  ] as const)('a community %s manages: %s', async (role, allowed) => {
    build(stubHub('game_community', role));
    rows([{ kind: 'game_community' }], [{ kind: 'game_community' }]);
    expect(await service.canManageDiscord(actor(MEMBER_ID), GUILD)).toBe(
      allowed,
    );
  });

  it('a WoW GM (ladder leader) is still refused — staff-only there', async () => {
    const wow = stubHub('wow_guild', 'leader');
    const ladder = jest.spyOn(wow, 'resolveLadder');
    build(wow);
    rows([{ kind: 'wow_guild' }]);
    expect(await service.canManageDiscord(actor(MEMBER_ID), GUILD)).toBe(false);
    expect(ladder).not.toHaveBeenCalled();
  });
});
