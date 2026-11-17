/**
 * ROK-2212 — SuggestedGroupsService composition with mocked reads (real-DB
 * cases are the integration spec's). Level spans come from the catalogue.
 */
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SuggestedGroupsSchema } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import { GuildAccessService } from '../../../../guilds/guild-access.service';
import { SettingsService } from '../../../../settings/settings.service';
import { loadEventQuestSet } from '../../event-forever-progress.query';
import { WowFactsService } from '../../facts/wow-facts.service';
import { loadForeverQuestSources } from '../../forever-quest-source.query';
import { InstanceCatalogueService } from '../../instance-catalogue/instance-catalogue.service';
import { WOW_FOREVER_GAME_SLUG } from '../../wow-forever-identity.helpers';
import {
  loadPlanHub,
  loadPlanSignups,
} from '../dungeon-plan/dungeon-plan.query';
import { loadGuildRows } from '../roster-insights/roster-insights.refs';
import { SuggestedGroupsService } from './suggested-groups.service';

jest.mock('../dungeon-plan/dungeon-plan.query');
jest.mock('../../event-forever-progress.query');
jest.mock('../../forever-quest-source.query');
jest.mock('../roster-insights/roster-insights.refs', () => ({
  ...jest.requireActual<object>('../roster-insights/roster-insights.refs'),
  loadGuildRows: jest.fn(),
}));

const catalogue = new InstanceCatalogueService();
const dungeon = catalogue.list('wow_forever', 'dungeon')[0];
const LEVEL = dungeon?.minimumLevel ?? 1;
const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const actor = { id: 9, role: 'member' } as const;

/** [memberId, name, claimed owner (null = unclaimed), role] */
const ROSTER: [number, string, number | null, string | null][] = [
  [1, 'Tank', 1, 'tank'],
  [2, 'Healer', 2, 'healer'],
  [3, 'DpsA', 3, 'dps'],
  [4, 'DpsB', 4, 'dps'],
  [5, 'DpsC', null, 'dps'],
  [6, 'NoRole', null, null],
];

const canView = jest.fn();
const resolveFacts = jest.fn();

function seed(): void {
  jest.mocked(loadPlanHub).mockResolvedValue({
    kind: 'wow_guild',
    gameSlug: WOW_FOREVER_GAME_SLUG,
    faction: 'Alliance',
  });
  jest.mocked(loadGuildRows).mockResolvedValue(
    ROSTER.map(([id, name, owner]) => ({
      key: `m${id}`,
      memberId: id,
      name,
      characterId: owner === null ? null : uuid(id),
      userId: owner,
      isMain: true,
      rankIndex: 0,
      onlineAtExport: null,
      lastOnlineDays: null,
    })),
  );
  resolveFacts.mockResolvedValue({
    facts: new Map(
      ROSTER.map(([id, , , role]) => [
        `m${id}`,
        {
          level: { value: LEVEL },
          class: { value: 'Warrior' },
          ...(role === null ? {} : { role: { value: role } }),
        },
      ]),
    ),
    truncated: false,
  });
  jest.mocked(loadEventQuestSet).mockResolvedValue({
    eventQuests: [],
    lookup: new Map(),
    knownIds: new Set(),
  });
  jest.mocked(loadPlanSignups).mockResolvedValue([]);
  jest.mocked(loadForeverQuestSources).mockResolvedValue(new Map());
}

async function makeService(): Promise<SuggestedGroupsService> {
  const mod = await Test.createTestingModule({
    providers: [
      SuggestedGroupsService,
      InstanceCatalogueService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: SettingsService, useValue: {} },
      { provide: WowFactsService, useValue: { resolveFacts } },
      { provide: GuildAccessService, useValue: { canView } },
    ],
  }).compile();
  return mod.get(SuggestedGroupsService);
}

const ALL_IN_DUNGEON = { scope: 'all', instanceId: dungeon?.id } as const;

describe('SuggestedGroupsService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    seed();
  });

  it('404s off a Forever wow_guild hub', async () => {
    jest.mocked(loadPlanHub).mockResolvedValue({
      kind: 'game_community',
      gameSlug: WOW_FOREVER_GAME_SLUG,
      faction: null,
    });
    canView.mockResolvedValue(true);
    const svc = await makeService();
    await expect(
      svc.suggestedGroups(actor, 1, { scope: 'top' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a member sees one valid group with owners, incl. the unclaimed dps', async () => {
    canView.mockResolvedValue(true);
    const got = await (
      await makeService()
    ).suggestedGroups(actor, 1, ALL_IN_DUNGEON);
    expect(SuggestedGroupsSchema.safeParse(got).error).toBeUndefined();
    expect(got.groups).toHaveLength(1);
    const [group] = got.groups;
    expect(group?.instance.id).toBe(dungeon?.id);
    expect(group?.members.map((m) => [m.key, m.role, m.userId])).toEqual([
      [uuid(1), 'tank', 1],
      [uuid(2), 'healer', 2],
      [uuid(3), 'dps', 3],
      [uuid(4), 'dps', 4],
      ['m5', 'dps', null],
    ]);
    expect(group?.sharedQuests).toBe(0);
    expect(got.pool).toEqual({
      tank: 1,
      healer: 1,
      dps: 3,
      unclaimed: 1,
      skippedNoRole: 1,
      skippedNoLevel: 0,
    });
  });

  it('a visitor gets the same groups with every userId masked', async () => {
    canView.mockResolvedValue(false);
    const got = await (
      await makeService()
    ).suggestedGroups(actor, 1, ALL_IN_DUNGEON);
    expect(SuggestedGroupsSchema.safeParse(got).error).toBeUndefined();
    const members = got.groups.flatMap((g) => g.members);
    expect(members.map((m) => m.key)).toEqual([
      uuid(1),
      uuid(2),
      uuid(3),
      uuid(4),
      'm5',
    ]);
    expect(members.map((m) => m.userId)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('scope top returns at most 3 groups, each of a different dungeon', async () => {
    canView.mockResolvedValue(true);
    const got = await (
      await makeService()
    ).suggestedGroups(actor, 1, {
      scope: 'top',
    });
    const ids = got.groups.map((g) => g.instance.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('serves the second read from the per-guild cache', async () => {
    canView.mockResolvedValue(true);
    const svc = await makeService();
    await svc.suggestedGroups(actor, 1, { scope: 'top' });
    await svc.suggestedGroups(actor, 1, ALL_IN_DUNGEON);
    expect(loadGuildRows).toHaveBeenCalledTimes(1);
    expect(resolveFacts).toHaveBeenCalledTimes(1);
  });
});
