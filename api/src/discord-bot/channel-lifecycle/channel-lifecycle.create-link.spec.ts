/**
 * ROK-1428 Codex r5 P1 — a created channel is never orphaned. The create +
 * bind commit in the game's transaction; hub linking runs AFTER that commit
 * in its own transaction, so a hub-link (or topic refresh) failure cannot roll
 * back the new binding and leave a Discord channel bound to nothing. The next
 * reconcile retries the link (`link_hub`, spec §2.7).
 */
import type { ChannelLifecycleSettingsDto } from '@raid-ledger/contract';
import type { Guild } from 'discord.js';
import * as ops from './channel-lifecycle.discord-ops';
import * as queries from './channel-lifecycle.store.queries';
import { executePlan } from './channel-lifecycle.run';
import type { ApplyContext, PlannedGame } from './channel-lifecycle.types';
import type { GameLifecycleActivityRow } from './game-activity.types';
import type { ChannelBindingsService } from '../services/channel-bindings.service';
import type { LifecycleDb } from './channel-lifecycle.store';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock('./channel-lifecycle.discord-ops');
jest.mock('./channel-lifecycle.store.queries');

interface FakeTx {
  log: string[];
}

/** A pool whose transactions commit their log only when `fn` resolves. */
function fakePool(): { pool: LifecycleDb; committed: string[] } {
  const committed: string[] = [];
  const pool = {
    transaction: async (fn: (tx: FakeTx) => Promise<unknown>) => {
      const tx: FakeTx = { log: [] };
      const value = await fn(tx);
      committed.push(...tx.log);
      return value;
    },
  };
  return { pool: pool as unknown as LifecycleDb, committed };
}

const ROW: GameLifecycleActivityRow = {
  gameId: 7,
  gameName: 'Valheim',
  gameSlug: 'valheim',
  signals: [],
  itemCount: 2,
  lastActivityAt: null,
  hubHold: false,
  hubNeedsLink: true,
  suppressed: false,
  binding: null,
};

const CREATE: PlannedGame = { row: ROW, action: 'create', reason: 'activity' };

function makeCtx(
  pool: LifecycleDb,
  linkError: Error,
): {
  ctx: ApplyContext;
  deleteChannel: jest.Mock;
} {
  const deleteChannel = jest.fn().mockResolvedValue(undefined);
  const guild = { id: 'g1', channels: { delete: deleteChannel } };
  const bindings = {
    bind: jest.fn((...args: unknown[]) => {
      const opts = args[7] as { db: FakeTx };
      opts.db.log.push(`bind ${String(args[1])}`);
      return Promise.resolve({});
    }),
  };
  const ctx: ApplyContext = {
    guild: guild as unknown as Guild,
    db: pool,
    bindings: bindings as unknown as ChannelBindingsService,
    settings: {} as ChannelLifecycleSettingsDto,
    categories: { gamesId: null, archiveId: 'cat-arch' },
    hubLinker: { linkHubsForGame: jest.fn().mockRejectedValue(linkError) },
    clientUrl: 'https://rl.test',
    now: new Date('2026-10-20T00:00:00Z'),
  };
  return { ctx, deleteChannel };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(queries.findGameAnnouncementBinding).mockResolvedValue(null);
  jest.mocked(ops.createTextChannel).mockResolvedValue('new-ch');
});

describe('create then hub-link failure (Codex r5 P1)', () => {
  it('keeps the committed binding and the channel when hub linking throws', async () => {
    const { pool, committed } = fakePool();
    const { ctx, deleteChannel } = makeCtx(pool, new Error('hub link boom'));
    const res = await executePlan(ctx, {
      run: [CREATE],
      deferred: [],
      skipped: 0,
      verify: [],
    });
    expect(committed).toEqual(['bind new-ch']);
    expect(deleteChannel).not.toHaveBeenCalled();
    expect(res.items.map((i) => [i.action, i.outcome])).toEqual([
      ['create', 'done'],
    ]);
    expect(res.created).toBe(1);
  });
});
