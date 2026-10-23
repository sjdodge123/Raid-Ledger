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
import type { LockedBindingState } from './channel-lifecycle.store.queries';
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

/** The new binding as the post-create link re-reads it (still routed). */
const LOCKED: LockedBindingState = {
  channelId: 'new-ch',
  autoManaged: true,
  pinned: false,
  lifecycleState: 'active',
  gameId: 7,
  bindingPurpose: 'game-announcements',
  recurrenceGroupId: null,
};

const CREATE: PlannedGame = { row: ROW, action: 'create', reason: 'activity' };

function makeCtx(
  pool: LifecycleDb,
  linkError: Error,
): {
  ctx: ApplyContext;
  deleteChannel: jest.Mock;
  link: jest.Mock;
} {
  const deleteChannel = jest.fn().mockResolvedValue(undefined);
  const link = jest.fn().mockRejectedValue(linkError);
  const guild = { id: 'g1', channels: { delete: deleteChannel } };
  const bindings = {
    bind: jest.fn((...args: unknown[]) => {
      const opts = args[7] as { db: FakeTx };
      opts.db.log.push(`bind ${String(args[1])}`);
      return Promise.resolve({
        binding: { id: 'b-new' },
        replacedChannelIds: [],
      });
    }),
  };
  const ctx: ApplyContext = {
    guild: guild as unknown as Guild,
    db: pool,
    bindings: bindings as unknown as ChannelBindingsService,
    settings: {} as ChannelLifecycleSettingsDto,
    categories: { gamesId: null, archiveId: 'cat-arch' },
    hubLinker: { linkHubsForGame: link },
    clientUrl: 'https://rl.test',
    now: new Date('2026-10-20T00:00:00Z'),
  };
  return { ctx, deleteChannel, link };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(queries.findGameAnnouncementBinding).mockResolvedValue(null);
  jest.mocked(ops.createTextChannel).mockResolvedValue('new-ch');
  jest.mocked(queries.isGameSuppressed).mockResolvedValue(false);
  jest.mocked(queries.lockLifecycleBinding).mockResolvedValue(LOCKED);
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

describe('Codex r16 P2: suppressed since the read', () => {
  it('re-checks suppression on the game tx and defers instead of recreating', async () => {
    jest.mocked(queries.isGameSuppressed).mockResolvedValue(true);
    const { pool, committed } = fakePool();
    const { ctx } = makeCtx(pool, new Error('unused'));
    const res = await executePlan(ctx, {
      run: [CREATE],
      deferred: [],
      skipped: 0,
      verify: [],
    });
    expect(ops.createTextChannel).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
    expect(res.items.map((i) => [i.action, i.outcome, i.detail])).toEqual([
      ['create', 'deferred', 'deferred: suppressed since the read'],
    ]);
    expect(jest.mocked(queries.isGameSuppressed).mock.calls[0]?.[1]).toBe('g1');
  });
});

describe('Codex r18 P2: post-create link re-reads + locks the binding', () => {
  it('locks the new binding and links nothing when it was reassigned since the create', async () => {
    jest
      .mocked(queries.lockLifecycleBinding)
      .mockResolvedValue({ ...LOCKED, gameId: 99 });
    const { pool, committed } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('must not link'));
    const res = await executePlan(ctx, {
      run: [CREATE],
      deferred: [],
      skipped: 0,
      verify: [],
    });
    expect(jest.mocked(queries.lockLifecycleBinding).mock.calls[0]?.[1]).toBe(
      'b-new',
    );
    expect(link).not.toHaveBeenCalled();
    expect(ops.setTopic).not.toHaveBeenCalled();
    expect(committed).toEqual(['bind new-ch']);
    expect(res.items.map((i) => [i.action, i.outcome])).toEqual([
      ['create', 'done'],
    ]);
  });

  it('still links a binding that is unchanged since the create', async () => {
    const { pool } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('hub link boom'));
    await executePlan(ctx, {
      run: [CREATE],
      deferred: [],
      skipped: 0,
      verify: [],
    });
    expect(link).toHaveBeenCalledWith(7, 'new-ch', expect.anything());
  });
});

describe('Codex P2: LINKED is announced only after the link tx commits', () => {
  const LINKED = { channelId: 'new-ch', guildIds: [11] };
  const PLAN = { run: [CREATE], deferred: [], skipped: 0, verify: [] };

  it('announces the linked hubs once the link tx commits', async () => {
    jest
      .mocked(queries.lockLifecycleBinding)
      .mockResolvedValue({ ...LOCKED, autoManaged: false });
    const { pool } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('unused'));
    link.mockResolvedValue(LINKED);
    const announce = jest.fn();
    ctx.hubLinker.announceLinked = announce;
    const res = await executePlan(ctx, PLAN);
    expect(announce.mock.calls).toEqual([[LINKED]]);
    expect(res.items.map((i) => [i.action, i.outcome])).toEqual([
      ['create', 'done'],
    ]);
  });

  it('a rolled-back link announces nothing', async () => {
    jest.mocked(ops.setTopic).mockRejectedValueOnce(new Error('topic boom'));
    const { pool } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('unused'));
    link.mockResolvedValue(LINKED);
    const announce = jest.fn();
    ctx.hubLinker.announceLinked = announce;
    await executePlan(ctx, PLAN);
    expect(link).toHaveBeenCalledTimes(1);
    expect(announce).not.toHaveBeenCalled();
  });
});
