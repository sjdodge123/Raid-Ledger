/**
 * ROK-1428 int-fix 3 — the tx invariant: while a game's transaction is open,
 * NOTHING reachable from `reconcile` may touch the pool (zero pool access),
 * and every game runs in a transaction of its own (Codex r4b P1 — the
 * single-flight is a Redis lease, so no tx spans the whole tick).
 *
 * Fleet evidence (R9): the gone-channel path inserted the `deleted`
 * suppression on the lock's tx, then `unbindById` re-inserted it on a POOL
 * connection. The pool insert waited on the tx's uncommitted row; the tx
 * waited on the pool insert — a self-deadlock.
 *
 * The REAL store, ChannelBindingsService and HubChannelLinkService run here;
 * only Discord ops and the activity read are mocked. The pool is a proxy that
 * records every access, the tx a chainable fake.
 */
import type {
  ChannelLifecycleSettingsDto,
  ReconcileResultDto,
} from '@raid-ledger/contract';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import * as ops from './channel-lifecycle.discord-ops';
import * as queries from './game-activity.queries';
import { ChannelGoneError } from './channel-lifecycle.errors';
import { ChannelLifecycleService } from './channel-lifecycle.service';
import { HubChannelLinkService } from './hub-channel-link.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import type { GameLifecycleActivityRow } from './game-activity.types';
import type { SettingsService } from '../../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
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

/** A thenable that answers any query-builder chain with `value`. */
function chain(value: unknown): unknown {
  const proxy: unknown = new Proxy(function noop() {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (ok: (v: unknown) => unknown) => Promise.resolve(value).then(ok);
      }
      return () => proxy;
    },
  });
  return proxy;
}

interface Harness {
  pool: LifecycleDb;
  tx: LifecycleDb;
  /** Pool accesses made while the lock's tx was open. */
  poolCallsInTx: string[];
  /** Root query methods issued on the tx, in order. */
  txCalls: string[];
  /** Transactions opened on the pool. */
  txCount: () => number;
}

/** The binding row a `delete … returning()` on the tx hands back. */
function deletedRow(gameId: number): Record<string, unknown> {
  return {
    id: `b-${gameId}`,
    guildId: 'g1',
    channelId: `ch-${gameId}`,
    gameId,
    autoManaged: true,
    recurrenceGroupId: null,
    bindingPurpose: 'game-announcements',
  };
}

function makeTx(txCalls: string[], gameId: number): LifecycleDb {
  const answers: Record<string, unknown> = {
    delete: [deletedRow(gameId)],
    insert: [deletedRow(gameId)],
  };
  const tx: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        txCalls.push(prop);
        return () => chain(answers[prop] ?? []);
      },
    },
  );
  return tx as LifecycleDb;
}

function makeHarness(gameId: number): Harness {
  const poolCallsInTx: string[] = [];
  const txCalls: string[] = [];
  const tx = makeTx(txCalls, gameId);
  let open = false;
  let opened = 0;
  const pool: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (prop === 'transaction') {
          return async (fn: (t: LifecycleDb) => Promise<unknown>) => {
            if (open) poolCallsInTx.push('nested transaction');
            open = true;
            opened += 1;
            try {
              return await fn(tx);
            } finally {
              open = false;
            }
          };
        }
        if (open) poolCallsInTx.push(prop);
        return () => chain([]);
      },
    },
  );
  const txCount = (): number => opened;
  return { pool: pool as LifecycleDb, tx, poolCallsInTx, txCalls, txCount };
}

function bound(
  gameId: number,
  state: 'active' | 'archived',
  items: number,
): GameLifecycleActivityRow {
  return {
    gameId,
    gameName: `Game ${gameId}`,
    gameSlug: `game-${gameId}`,
    signals: [],
    itemCount: items,
    lastActivityAt: null,
    hubHold: false,
    hubNeedsLink: false,
    suppressed: false,
    binding: {
      id: `b-${gameId}`,
      guildId: 'g1',
      channelId: `ch-${gameId}`,
      lifecycleState: state,
      autoManaged: true,
      pinned: false,
      archivedAt: null,
      restoreParentId: null,
      archivedOverwrites: null,
    },
  };
}

function makeService(h: Harness): ChannelLifecycleService {
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
  const emitter = { emit: jest.fn() };
  return new ChannelLifecycleService(
    h.pool,
    settings as unknown as SettingsService,
    client as unknown as DiscordBotClientService,
    new ChannelBindingsService(h.pool, emitter as unknown as EventEmitter2),
    {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    },
    new HubChannelLinkService(h.pool),
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
  jest.mocked(ops.categoryHasRoom).mockResolvedValue(true);
});

/** Run one live tick over `row` (the activity read runs before any tx opens). */
async function tick(
  h: Harness,
  row: GameLifecycleActivityRow,
): Promise<ReconcileResultDto> {
  jest.mocked(queries.selectGameLifecycleActivity).mockResolvedValue([row]);
  return makeService(h).reconcile({ dryRun: false, trigger: 'manual' });
}

const GONE = { outcome: 'failed', detail: 'channel deleted in Discord' };

describe('reconcile never touches the pool while a game tx is open', () => {
  it('10003 on archive: suppress + unbind + hub clear all run on the tx', async () => {
    const h = makeHarness(1);
    jest
      .mocked(ops.archiveChannel)
      .mockRejectedValue(new ChannelGoneError('ch-1'));
    const res = await tick(h, bound(1, 'active', 0));
    expect(res.items[0]).toMatchObject(GONE);
    expect(h.poolCallsInTx).toEqual([]);
    // archive's tx, then the gone-cleanup's own tx
    expect(h.txCount()).toBe(2);
    // suppression 'deleted' → binding delete → 'unbound' (a no-op) → hub clear
    expect(h.txCalls).toEqual(
      expect.arrayContaining(['insert', 'delete', 'update']),
    );
  });

  it('10003 on unarchive: suppress + unbind + hub clear all run on the tx', async () => {
    const h = makeHarness(2);
    jest
      .mocked(ops.unarchiveChannel)
      .mockRejectedValue(new ChannelGoneError('ch-2'));
    const res = await tick(h, bound(2, 'archived', 1));
    expect(res.items[0]).toMatchObject(GONE);
    expect(h.poolCallsInTx).toEqual([]);
    expect(h.txCalls).toEqual(
      expect.arrayContaining(['insert', 'delete', 'update']),
    );
  });

  // Codex r5 P1: the hub link runs in a SECOND tx after the create commits, so
  // a link failure cannot roll back the binding and orphan the channel.
  it('create: the race read + bind() run on the tx, the hub link on its own tx', async () => {
    const h = makeHarness(3);
    jest.mocked(ops.createTextChannel).mockResolvedValue('ch-3');
    const row = { ...bound(3, 'active', 3), binding: null };
    const res = await tick(h, row);
    expect(res.items[0]).toMatchObject({ action: 'create', outcome: 'done' });
    expect(h.poolCallsInTx).toEqual([]);
    expect(h.txCount()).toBe(2);
  });
});
