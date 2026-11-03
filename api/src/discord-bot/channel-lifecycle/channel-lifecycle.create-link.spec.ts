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
import { LifecyclePermissionError } from './channel-lifecycle.errors';
import type { ApplyContext, PlannedGame } from './channel-lifecycle.types';
import type {
  GameLifecycleActivityRow,
  LifecycleCandidateBinding,
} from './game-activity.types';
import type { ChannelBindingsService } from '../services/channel-bindings.service';
import type { LifecycleDb } from './channel-lifecycle.store';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock('./channel-lifecycle.discord-ops');
jest.mock('./channel-lifecycle.store.queries');
jest.mock('./hub-link.resolver');

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

/** An existing auto-managed binding a `link_hub` action links. */
const LINK_BINDING: LifecycleCandidateBinding = {
  id: 'b-old',
  guildId: 'g1',
  channelId: 'new-ch',
  lifecycleState: 'active',
  autoManaged: true,
  pinned: false,
  archivedAt: null,
  restoreParentId: null,
  archivedOverwrites: null,
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
    const { pool, committed } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('unused'));
    link.mockImplementation((_g: number, _c: string, tx: FakeTx) => {
      tx.log.push('link 11');
      return Promise.reject(new Error('link boom'));
    });
    const announce = jest.fn();
    ctx.hubLinker.announceLinked = announce;
    await executePlan(ctx, PLAN);
    expect(link).toHaveBeenCalledTimes(1);
    expect(committed).toEqual(['bind new-ch']);
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('tech-debt 2026-10-22: the topic refresh runs after the link commits', () => {
  const LINKED = { channelId: 'new-ch', guildIds: [11] };
  const PLAN = { run: [CREATE], deferred: [], skipped: 0, verify: [] };

  it('a Discord topic failure keeps the committed hub link', async () => {
    const { pool, committed } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('unused'));
    link.mockImplementation((_g: number, _c: string, tx: FakeTx) => {
      tx.log.push('link 11');
      return Promise.resolve(LINKED);
    });
    const seenAtTopic: string[][] = [];
    jest.mocked(ops.setTopic).mockImplementation(() => {
      seenAtTopic.push([...committed]);
      return Promise.reject(new Error('topic boom'));
    });
    const announce = jest.fn();
    ctx.hubLinker.announceLinked = announce;
    const res = await executePlan(ctx, PLAN);
    expect(committed).toEqual(['bind new-ch', 'link 11']);
    expect(seenAtTopic).toEqual([['bind new-ch', 'link 11']]);
    expect(announce.mock.calls).toEqual([[LINKED]]);
    expect(res.items.map((i) => [i.action, i.outcome])).toEqual([
      ['create', 'done'],
    ]);
  });
});

describe('tech-debt 2026-11-03: topic refresh — permission stop + the link_hub path', () => {
  const LINKED = { channelId: 'new-ch', guildIds: [11] };

  /** A hub link that commits `link 11` and resolves with one guild. */
  function committingLink(link: jest.Mock): void {
    link.mockImplementation((_g: number, _c: string, tx: FakeTx) => {
      tx.log.push('link 11');
      return Promise.resolve(LINKED);
    });
  }

  it('a permission error on the refresh keeps the link and stops the tick', async () => {
    const { pool, committed } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('unused'));
    committingLink(link);
    jest
      .mocked(ops.setTopic)
      .mockRejectedValue(new LifecyclePermissionError('topic', 50013));
    const LATER: PlannedGame = { ...CREATE, row: { ...ROW, gameId: 8 } };
    const res = await executePlan(ctx, {
      run: [CREATE, LATER],
      deferred: [],
      skipped: 0,
      verify: [],
    });
    expect(committed).toEqual(['bind new-ch', 'link 11']);
    expect(res.stoppedReason).toBe('permissions');
    expect(res.items.map((i) => [i.gameId, i.outcome])).toEqual([
      [7, 'done'],
      [8, 'deferred'],
    ]);
    expect(res.items[1]?.detail).toBe('stopped: missing permissions');
    expect(ops.createTextChannel).toHaveBeenCalledTimes(1);
  });

  it('a link_hub action keeps the committed link when the refresh fails', async () => {
    const { pool, committed } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('unused'));
    committingLink(link);
    jest.mocked(ops.setTopic).mockRejectedValue(new Error('topic boom'));
    const announce = jest.fn();
    ctx.hubLinker.announceLinked = announce;
    const LINK_HUB: PlannedGame = {
      row: { ...ROW, binding: LINK_BINDING },
      action: 'link_hub',
      reason: 'hub has no channel',
    };
    const res = await executePlan(ctx, {
      run: [LINK_HUB],
      deferred: [],
      skipped: 0,
      verify: [],
    });
    expect(link).toHaveBeenCalledWith(7, 'new-ch', expect.anything());
    expect(ops.setTopic).toHaveBeenCalledTimes(1);
    expect(committed).toEqual(['link 11']);
    expect(announce.mock.calls).toEqual([[LINKED]]);
    expect(res.stoppedReason).toBeNull();
    expect(res.items.map((i) => [i.action, i.outcome])).toEqual([
      ['link_hub', 'done'],
    ]);
  });
});

describe('Codex P2 2026-11-03: the topic refresh re-locks + re-validates the binding', () => {
  const LINKED = { channelId: 'new-ch', guildIds: [11] };
  const PLAN = { run: [CREATE], deferred: [], skipped: 0, verify: [] };

  /** A create whose hub link commits; `afterLink` is the topic tx's re-read. */
  async function runCreate(afterLink: LockedBindingState | null): Promise<{
    committed: string[];
    pool: LifecycleDb;
  }> {
    jest
      .mocked(queries.lockLifecycleBinding)
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(afterLink);
    jest.mocked(ops.setTopic).mockResolvedValue(undefined);
    const { pool, committed } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('unused'));
    link.mockImplementation((_g: number, _c: string, tx: FakeTx) => {
      tx.log.push('link 11');
      return Promise.resolve(LINKED);
    });
    await executePlan(ctx, PLAN);
    return { committed, pool };
  }

  it('skips the topic edit when the binding was removed after the link committed', async () => {
    const { committed } = await runCreate(null);
    expect(jest.mocked(queries.lockLifecycleBinding).mock.calls).toHaveLength(
      2,
    );
    expect(ops.setTopic).not.toHaveBeenCalled();
    expect(committed).toEqual(['bind new-ch', 'link 11']);
  });

  it('skips the topic edit when the binding was reassigned to another game', async () => {
    const { committed } = await runCreate({ ...LOCKED, gameId: 99 });
    expect(ops.setTopic).not.toHaveBeenCalled();
    expect(committed).toEqual(['bind new-ch', 'link 11']);
  });

  it('skips the topic edit when the binding is no longer auto-managed', async () => {
    await runCreate({ ...LOCKED, autoManaged: false });
    expect(ops.setTopic).not.toHaveBeenCalled();
  });

  it('edits the topic of an unchanged binding, re-locked in a tx of its own', async () => {
    const { pool } = await runCreate(LOCKED);
    const locks = jest.mocked(queries.lockLifecycleBinding).mock.calls;
    expect(locks.map((c) => c[1])).toEqual(['b-new', 'b-new']);
    expect(locks[1]?.[0]).not.toBe(pool);
    expect(locks[1]?.[0]).not.toBe(locks[0]?.[0]);
    expect(jest.mocked(ops.setTopic).mock.calls.map((c) => c[1])).toEqual([
      'new-ch',
    ]);
  });
});

describe('Codex P2 2026-11-03: a link_hub topic refresh', () => {
  it('re-locks the existing binding by its id', async () => {
    jest.mocked(ops.setTopic).mockResolvedValue(undefined);
    const { pool } = fakePool();
    const { ctx, link } = makeCtx(pool, new Error('unused'));
    link.mockResolvedValue({ channelId: 'new-ch', guildIds: [11] });
    const LINK_HUB: PlannedGame = {
      row: { ...ROW, binding: LINK_BINDING },
      action: 'link_hub',
      reason: 'hub has no channel',
    };
    await executePlan(ctx, {
      run: [LINK_HUB],
      deferred: [],
      skipped: 0,
      verify: [],
    });
    const locks = jest.mocked(queries.lockLifecycleBinding).mock.calls;
    expect(locks.map((c) => c[1])).toEqual(['b-old', 'b-old']);
    expect(ops.setTopic).toHaveBeenCalledTimes(1);
  });
});
