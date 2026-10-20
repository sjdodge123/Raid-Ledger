/**
 * ROK-1428 Codex r4b P1 — each game's DB writes commit in their OWN
 * transaction. Under postgres.js a failed statement poisons the whole
 * transaction (savepoints included), so one game's failing write must not
 * roll back an earlier game's committed state: its Discord change has
 * already happened and is not undone.
 *
 * The pool here is a fake with Postgres's semantics: a statement that fails
 * poisons its transaction, and a poisoned transaction's writes are discarded
 * at the end instead of committed.
 */
import type { ChannelLifecycleSettingsDto } from '@raid-ledger/contract';
import * as ops from './channel-lifecycle.discord-ops';
import * as queries from './game-activity.queries';
import { ChannelLifecycleService } from './channel-lifecycle.service';
import type { GameLifecycleActivityRow } from './game-activity.types';
import type { SettingsService } from '../../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { ChannelBindingsService } from '../services/channel-bindings.service';
import type { LifecycleDb } from './channel-lifecycle.store';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock('./channel-lifecycle.discord-ops');
jest.mock('./game-activity.queries');

const SETTINGS: ChannelLifecycleSettingsDto = {
  enabled: true,
  recentActivityDays: 30,
  createThreshold: 2,
  gamesCategoryId: 'cat-games',
  archiveCategoryId: 'cat-arch',
  hideOnArchive: false,
  maxChangesPerTick: 10,
  lastRunAt: null,
  lastRunError: null,
};

/** A thenable answering any builder chain with `settle()`. */
function chain(settle: () => Promise<unknown>): unknown {
  const proxy: unknown = new Proxy(function noop() {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
          settle().then(ok, fail);
      }
      return () => proxy;
    },
  });
  return proxy;
}

interface FakePool {
  pool: LifecycleDb;
  /** `update #n` entries whose transaction committed. */
  committed: string[];
}

/** A pool whose `failOn`-th `update` statement fails and poisons its tx. */
function fakePool(failOn: number): FakePool {
  const committed: string[] = [];
  let updates = 0;
  const makeTx = (log: string[], state: { poisoned: boolean }): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop !== 'string' || prop === 'then') return undefined;
          if (prop === 'execute')
            return () => chain(() => Promise.resolve([{ locked: true }]));
          if (prop !== 'update') return () => chain(() => Promise.resolve([]));
          return () => {
            const n = (updates += 1);
            return chain(() => {
              if (n !== failOn) {
                log.push(`update #${n}`);
                return Promise.resolve([]);
              }
              state.poisoned = true;
              return Promise.reject(new Error('insert or update violates fk'));
            });
          };
        },
      },
    );
  const transaction = async (
    fn: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    const log: string[] = [];
    const state = { poisoned: false };
    const value = await fn(makeTx(log, state));
    if (!state.poisoned) committed.push(...log);
    return value;
  };
  const pool = makeTx(committed, { poisoned: false }) as Record<
    string,
    unknown
  >;
  return {
    pool: new Proxy(pool, {
      get: (t, p) => (p === 'transaction' ? transaction : t[p as string]),
    }) as unknown as LifecycleDb,
    committed,
  };
}

function bound(gameId: number): GameLifecycleActivityRow {
  return {
    gameId,
    gameName: `Game ${gameId}`,
    gameSlug: `game-${gameId}`,
    signals: [],
    itemCount: 0,
    lastActivityAt: null,
    hubHold: false,
    hubNeedsLink: false,
    suppressed: false,
    binding: {
      id: `b-${gameId}`,
      guildId: 'g1',
      channelId: `ch-${gameId}`,
      lifecycleState: 'active',
      autoManaged: true,
      pinned: false,
      archivedAt: null,
      restoreParentId: null,
      archivedOverwrites: null,
    },
  };
}

/** A Redis fake whose lease is always free. */
const freeRedis = {
  set: jest.fn().mockResolvedValue('OK'),
  eval: jest.fn().mockResolvedValue(1),
};

function makeService(pool: LifecycleDb): ChannelLifecycleService {
  const settings = {
    getChannelLifecycleSettings: jest.fn().mockResolvedValue(SETTINGS),
    setChannelLifecycleSettings: jest.fn(),
    recordChannelLifecycleRun: jest.fn(),
    getClientUrl: jest.fn().mockResolvedValue('https://rl.test'),
  };
  const guild = { id: 'g1', channels: { delete: jest.fn() } };
  const client = {
    isConnected: jest.fn().mockReturnValue(true),
    getGuild: jest.fn().mockReturnValue(guild),
  };
  return new ChannelLifecycleService(
    pool,
    settings as unknown as SettingsService,
    client as unknown as DiscordBotClientService,
    {} as ChannelBindingsService,
    freeRedis,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(ops.ensureCategory)
    .mockImplementation((_g, o) =>
      Promise.resolve({ id: o.id ?? 'new', name: o.name, created: false }),
    );
  jest.mocked(ops.categorySeriesIds).mockReturnValue(new Set());
  jest.mocked(ops.archiveChannel).mockResolvedValue({
    previousParentId: 'cat-games',
    restoreParentId: 'cat-games',
    added: { changes: [] },
  });
  jest
    .mocked(queries.selectGameLifecycleActivity)
    .mockResolvedValue([bound(1), bound(2)]);
});

describe('per-game transactions (Codex r4b P1)', () => {
  it("game 2's failing state write leaves game 1's archived state committed", async () => {
    const { pool, committed } = fakePool(2);
    const res = await makeService(pool).reconcile({
      dryRun: false,
      trigger: 'manual',
    });
    expect(res.items.map((i) => [i.gameId, i.outcome])).toEqual([
      [1, 'done'],
      [2, 'failed'],
    ]);
    expect(committed).toEqual(['update #1']);
  });
});
