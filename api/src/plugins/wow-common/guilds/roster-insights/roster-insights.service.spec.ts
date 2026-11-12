/**
 * ROK-2178 (R1) — a cache miss issues its reads with as few sequential round
 * trips as the data dependencies allow, without breaking snapshot ordering:
 * the hub row lands BEFORE the roster read is issued (snapshot time first),
 * the guild kind comes from that hub row (no second `select kind`), the
 * roster read is the one the resolved adapter picks (no speculative guild
 * roster), and the raid pulls are issued before the facts resolve.
 */
import { Test } from '@nestjs/testing';
import type { GuildKind } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import { GuildAccessService } from '../../../../guilds/guild-access.service';
import { HubKindRegistry } from '../../../../guilds/hub-kind.registry';
import { WowFactsService } from '../../facts/wow-facts.service';
import {
  RosterInsightsCache,
  type InsightsRecompute,
} from './roster-insights.cache';
import { RosterInsightsService } from './roster-insights.service';
import {
  loadInsightsHubRow,
  type InsightsHubRow,
} from './roster-insights.hub-row';
import {
  emptyInsights,
  loadGuildRows,
  loadInsightRawRows,
} from './roster-insights.refs';
import { loadRaidProgress } from './roster-insights.raid-progress';

jest.mock('./roster-insights.hub-row', () => ({
  loadInsightsHubRow: jest.fn(),
}));
jest.mock('./roster-insights.refs', () => ({
  ...jest.requireActual<object>('./roster-insights.refs'),
  loadGuildRows: jest.fn(),
  loadInsightRawRows: jest.fn(),
}));
jest.mock('./roster-insights.raid-progress', () => ({
  ...jest.requireActual<object>('./roster-insights.raid-progress'),
  loadRaidProgress: jest.fn(),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = (): Promise<void> =>
  new Promise<void>((r) => {
    setImmediate(r);
  });

const hubRow = (kind: GuildKind): InsightsHubRow => ({
  at: null,
  gameId: 1,
  region: 'us',
  nameKey: 'g',
  kind,
  gameSlug: 'wow',
});

const rawRow = {
  key: 'm1',
  memberId: 1,
  name: 'Ann',
  characterId: null,
  userId: 7,
  isMain: true,
  rankIndex: 0,
  onlineAtExport: null,
  lastOnlineDays: null,
};

const hubMock = jest.mocked(loadInsightsHubRow);
const guildRowsMock = jest.mocked(loadGuildRows);
const rawRowsMock = jest.mocked(loadInsightRawRows);
const raidMock = jest.mocked(loadRaidProgress);

const forGuild = jest.fn();
interface FakeAdapter {
  kind: string;
  memberUserIds: () => Promise<number[]>;
}
const resolveKind = jest.fn((kind: string): FakeAdapter | undefined => ({
  kind,
  memberUserIds: () => Promise.resolve([7]),
}));
type FactsResult = Awaited<ReturnType<WowFactsService['resolveFacts']>>;
const resolveFacts = jest.fn();

const registerRecompute = jest.fn<void, [InsightsRecompute]>();

async function makeService(): Promise<RosterInsightsService> {
  const mod = await Test.createTestingModule({
    providers: [
      RosterInsightsService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: WowFactsService, useValue: { resolveFacts } },
      { provide: GuildAccessService, useValue: {} },
      { provide: RosterInsightsCache, useValue: { registerRecompute } },
      {
        provide: HubKindRegistry,
        useValue: { forGuild, resolve: resolveKind },
      },
    ],
  }).compile();
  return mod.get(RosterInsightsService);
}

beforeEach(() => {
  jest.clearAllMocks();
  raidMock.mockResolvedValue(null);
});

describe('RosterInsightsService.compute — read order (ROK-2178)', () => {
  it('awaits the hub row before it issues the roster read (snapshot first)', async () => {
    const hub = deferred<InsightsHubRow | null>();
    hubMock.mockReturnValue(hub.promise);
    rawRowsMock.mockResolvedValue([]);
    resolveFacts.mockResolvedValue({ facts: new Map(), truncated: false });
    const svc = await makeService();
    const done = svc.compute(3, 'member', false);
    await flush();
    expect(hubMock).toHaveBeenCalledTimes(1);
    expect(rawRowsMock).not.toHaveBeenCalled();
    expect(guildRowsMock).not.toHaveBeenCalled();
    hub.resolve(hubRow('wow_guild'));
    await done;
    expect(rawRowsMock).toHaveBeenCalledTimes(1);
  });

  it('issues the raid pulls before the facts resolve', async () => {
    hubMock.mockResolvedValue(hubRow('wow_guild'));
    rawRowsMock.mockResolvedValue([rawRow]);
    const facts = deferred<FactsResult>();
    resolveFacts.mockReturnValue(facts.promise);
    const svc = await makeService();
    const done = svc.compute(3, 'member', false);
    await flush();
    expect(raidMock).toHaveBeenCalledWith({}, hubRow('wow_guild'), [7]);
    facts.resolve({ facts: new Map(), truncated: false });
    await expect(done).resolves.toHaveProperty('classes');
  });
});

describe('RosterInsightsService.compute — hub kind from the hub row (ROK-2178)', () => {
  it('reads the guild kind once — from the hub row, not a second lookup', async () => {
    hubMock.mockResolvedValue(hubRow('wow_guild'));
    rawRowsMock.mockResolvedValue([]);
    resolveFacts.mockResolvedValue({ facts: new Map(), truncated: false });
    const svc = await makeService();
    await svc.compute(3, 'member', false);
    expect(forGuild).not.toHaveBeenCalled();
    expect(hubMock).toHaveBeenCalledTimes(1);
    expect(resolveKind).toHaveBeenCalledTimes(1);
    expect(resolveKind).toHaveBeenCalledWith('wow_guild');
    expect(rawRowsMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ kind: 'wow_guild' }),
      3,
    );
  });

  it('never loads a community roster for a visitor (Q1 = A)', async () => {
    hubMock.mockResolvedValue(hubRow('game_community'));
    const svc = await makeService();
    const dto = await svc.compute(3, 'visitor', false);
    expect(rawRowsMock).not.toHaveBeenCalled();
    expect(guildRowsMock).not.toHaveBeenCalled();
    expect(resolveFacts).not.toHaveBeenCalled();
    expect(dto).not.toHaveProperty('lastSeen');
  });

  it('loads a community roster through its adapter, never the guild roster', async () => {
    hubMock.mockResolvedValue(hubRow('game_community'));
    rawRowsMock.mockResolvedValue([]);
    resolveFacts.mockResolvedValue({ facts: new Map(), truncated: false });
    const svc = await makeService();
    await svc.compute(3, 'member', false);
    expect(rawRowsMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ kind: 'game_community' }),
      3,
    );
    expect(guildRowsMock).not.toHaveBeenCalled();
  });

  it('reads no guild roster when the kind has no live adapter', async () => {
    hubMock.mockResolvedValue(hubRow('wow_guild'));
    resolveKind.mockReturnValueOnce(undefined);
    rawRowsMock.mockResolvedValue([]);
    resolveFacts.mockResolvedValue({ facts: new Map(), truncated: false });
    const svc = await makeService();
    await svc.compute(3, 'member', false);
    expect(rawRowsMock).toHaveBeenCalledWith({}, undefined, 3);
    expect(guildRowsMock).not.toHaveBeenCalled();
    expect(resolveFacts).toHaveBeenCalledWith([]);
  });
});

describe('RosterInsightsService — cache warm wiring (ROK-2178 R2)', () => {
  it('registers its uncached compute with the cache on init', async () => {
    const svc = await makeService();
    const compute = jest
      .spyOn(svc, 'compute')
      .mockResolvedValue(emptyInsights());
    svc.onModuleInit();
    expect(registerRecompute).toHaveBeenCalledTimes(1);
    const fn = registerRecompute.mock.calls[0]?.[0];
    if (!fn) throw new Error('no recompute registered');
    await fn(4, 'visitor', true);
    expect(compute).toHaveBeenCalledWith(4, 'visitor', true);
  });
});
