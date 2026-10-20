/**
 * ROK-1431 — reconcile against a real DB (spec ROK-1428 §2.11 R1–R14, R18).
 * FLEET-ONLY (needs Postgres + the Redis sidecar). Discord ops are spied on
 * the module object (`jest.mock` never reaches the singleton app — memory
 * `reference_integration_jest_mock_singleton_app`); the bot client is stubbed.
 */
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Guild } from 'discord.js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import * as ops from './channel-lifecycle.discord-ops';
import {
  ChannelGoneError,
  LifecyclePermissionError,
} from './channel-lifecycle.errors';
import { ChannelLifecycleScheduler } from './channel-lifecycle.scheduler';
import { ChannelLifecycleService } from './channel-lifecycle.service';
import { deleteSuppression } from './channel-lifecycle.store';

const GUILD = 'rok1431-guild';
const DAY = 86_400_000;
const live = { dryRun: false, trigger: 'manual' as const };
let t: TestApp;
let svc: ChannelLifecycleService;
let settings: SettingsService;
let bindings: ChannelBindingsService;
let seq = 0;
const channelDelete = jest.fn();
/** The bits the archive stub reports adding (round-trips via `archived_overwrites`). */
const ADDED = { everyoneSend: true, everyoneView: false, botView: false };
const guild = {
  id: GUILD,
  channels: { delete: channelDelete },
} as unknown as Guild;

beforeAll(async () => {
  t = await getTestApp();
  svc = t.app.get(ChannelLifecycleService);
  settings = t.app.get(SettingsService);
  bindings = t.app.get(ChannelBindingsService);
});

beforeEach(async () => {
  const client = t.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuild').mockReturnValue(guild);
  jest.spyOn(ops, 'ensureCategory').mockImplementation((_g, o) =>
    Promise.resolve({
      id: o.name === 'Games' ? 'cat-games' : 'cat-arch',
      name: o.name,
      created: false,
    }),
  );
  jest
    .spyOn(ops, 'createTextChannel')
    .mockImplementation(() => Promise.resolve(`ch-${++seq}`));
  // applyArchive / applyUnarchive read the guild's category cache through
  // these two — the bare guild stub has no `channels.cache`, so stub them.
  jest.spyOn(ops, 'categorySeriesIds').mockImplementation(() => new Set());
  jest.spyOn(ops, 'categoryExists').mockResolvedValue(true);
  jest.spyOn(ops, 'archiveChannel').mockResolvedValue({
    previousParentId: 'old-parent',
    restoreParentId: 'old-parent',
    added: ADDED,
  });
  jest.spyOn(ops, 'unarchiveChannel').mockResolvedValue(undefined);
  await settings.setChannelLifecycleSettings({
    enabled: true,
    maxChangesPerTick: 10,
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  channelDelete.mockReset();
  t.seed = await truncateAllTables(t.db);
});

async function game(): Promise<number> {
  seq += 1;
  const [g] = nonEmpty(
    await t.db
      .insert(schema.games)
      .values({
        name: `L5 Game ${seq}`,
        slug: `l5-game-${seq}-${Date.now()}`,
        igdbId: null,
      })
      .returning({ id: schema.games.id }),
    'game',
  );
  return g.id;
}

async function event(gameId: number, days = 3): Promise<void> {
  const start = new Date(Date.now() + days * DAY);
  await t.db.insert(schema.events).values({
    title: 'L5 event',
    gameId,
    creatorId: t.seed.adminUser.id,
    duration: [start, new Date(start.getTime() + 3_600_000)],
  });
}

/** D11-style active game: two upcoming events. */
async function activeGame(): Promise<number> {
  const id = await game();
  await event(id, 3);
  await event(id, 5);
  return id;
}

async function autoBinding(
  gameId: number,
  o: { archived?: boolean; pinned?: boolean; restore?: string } = {},
): Promise<string> {
  const { binding } = await bindings.bind(
    GUILD,
    `pre-${gameId}`,
    'text',
    'game-announcements',
    gameId,
  );
  await t.db
    .update(schema.channelBindings)
    .set({
      autoManaged: true,
      pinned: o.pinned ?? false,
      lifecycleState: o.archived ? 'archived' : 'active',
      archivedAt: o.archived ? new Date() : null,
      restoreParentId: o.restore ?? null,
    })
    .where(eq(schema.channelBindings.id, binding.id));
  return binding.id;
}

const gameBindings = (gameId: number) =>
  t.db
    .select()
    .from(schema.channelBindings)
    .where(eq(schema.channelBindings.gameId, gameId));
const suppressions = (gameId: number) =>
  t.db
    .select()
    .from(schema.channelLifecycleSuppressions)
    .where(eq(schema.channelLifecycleSuppressions.gameId, gameId));

it('R1/R2: creates one auto-managed channel named by slug under Games, then is idempotent', async () => {
  const id = await activeGame();
  await svc.reconcile(live);
  expect(ops.createTextChannel).toHaveBeenCalledTimes(1);
  expect(ops.createTextChannel).toHaveBeenCalledWith(
    guild,
    expect.objectContaining({
      name: expect.stringMatching(/^l5-game-/),
      parentId: 'cat-games',
    }),
  );
  const rows = await gameBindings(id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    autoManaged: true,
    lifecycleState: 'active',
  });
  await svc.reconcile(live);
  expect(ops.createTextChannel).toHaveBeenCalledTimes(1);
  expect(await gameBindings(id)).toHaveLength(1);
});

it('R3: a manual binding blocks create and is untouched', async () => {
  const id = await activeGame();
  await bindings.bind(GUILD, 'manual-ch', 'text', 'game-announcements', id);
  await svc.reconcile(live);
  expect(ops.createTextChannel).not.toHaveBeenCalled();
  expect((await gameBindings(id))[0]).toMatchObject({
    channelId: 'manual-ch',
    autoManaged: false,
    lifecycleState: 'active',
  });
});

it('R4/R5: archive stores the old parent; a new event unarchives back to it', async () => {
  const id = await game();
  await autoBinding(id);
  await svc.reconcile(live);
  expect(ops.archiveChannel).toHaveBeenCalledTimes(1);
  const [archived] = await gameBindings(id);
  expect(archived).toMatchObject({
    lifecycleState: 'archived',
    restoreParentId: 'old-parent',
    archivedOverwrites: ADDED,
  });
  expect(archived?.archivedAt).toBeInstanceOf(Date);
  await event(id);
  await svc.reconcile(live);
  expect(ops.unarchiveChannel).toHaveBeenCalledWith(guild, `pre-${id}`, {
    parentId: 'old-parent',
    added: ADDED,
  });
  expect((await gameBindings(id))[0]).toMatchObject({
    lifecycleState: 'active',
    archivedAt: null,
    archivedOverwrites: null,
  });
});

it('R6: a pinned quiet channel is untouched', async () => {
  const id = await game();
  await autoBinding(id, { pinned: true });
  await svc.reconcile(live);
  expect(ops.archiveChannel).not.toHaveBeenCalled();
  expect((await gameBindings(id))[0]?.lifecycleState).toBe('active');
});

it('R7: game A failing does not block game B', async () => {
  const a = await game();
  const b = await game();
  await autoBinding(a);
  await autoBinding(b);
  jest.mocked(ops.archiveChannel).mockImplementation((_g, ch) => {
    if (ch === `pre-${a}`) return Promise.reject(new Error('boom'));
    return Promise.resolve({
      previousParentId: null,
      restoreParentId: null,
      added: ADDED,
    });
  });
  const res = await svc.reconcile(live);
  expect(res.items.find((i) => i.gameId === a)?.outcome).toBe('failed');
  expect(res.items.find((i) => i.gameId === b)?.outcome).toBe('done');
});

it('R8: 50013 stops the tick and records lastRunError', async () => {
  await autoBinding(await game());
  await autoBinding(await game());
  jest
    .mocked(ops.archiveChannel)
    .mockRejectedValue(new LifecyclePermissionError('archive.move', 50013));
  const res = await svc.reconcile(live);
  expect(res.stoppedReason).toBe('permissions');
  expect(ops.archiveChannel).toHaveBeenCalledTimes(1);
  expect((await settings.getChannelLifecycleSettings()).lastRunError).toMatch(
    /Manage Channels/,
  );
});

it("R9: 10003 on archive → binding removed, suppression reason 'deleted', never recreated", async () => {
  const id = await game();
  await autoBinding(id);
  jest
    .mocked(ops.archiveChannel)
    .mockRejectedValue(new ChannelGoneError(`pre-${id}`));
  await svc.reconcile(live);
  expect(await gameBindings(id)).toHaveLength(0);
  expect((await suppressions(id))[0]?.reason).toBe('deleted');
  await event(id);
  await event(id, 6);
  await svc.reconcile(live);
  expect(ops.createTextChannel).not.toHaveBeenCalled();
});

it('R10: admin unbind → suppression unbound; clearing it lets the next reconcile create', async () => {
  const id = await activeGame();
  const bindingId = await autoBinding(id);
  await bindings.unbindById(bindingId);
  expect((await suppressions(id))[0]?.reason).toBe('unbound');
  await svc.reconcile(live);
  expect(ops.createTextChannel).not.toHaveBeenCalled();
  expect(await deleteSuppression(t.db, GUILD, id)).toBe(true);
  await svc.reconcile(live);
  expect(ops.createTextChannel).toHaveBeenCalledTimes(1);
});

it('R11: 15 creatable games, cap 10 → 10 done, 5 deferred', async () => {
  for (let i = 0; i < 15; i += 1) await activeGame();
  const res = await svc.reconcile(live);
  expect(res).toMatchObject({ created: 10, deferred: 5 });
});

it('R12: dry run plans, calls no op and writes nothing', async () => {
  const id = await activeGame();
  const before = await settings.getChannelLifecycleSettings();
  const res = await svc.reconcile({ dryRun: true, trigger: 'manual' });
  expect(res.items[0]).toMatchObject({
    gameId: id,
    action: 'create',
    outcome: 'planned',
  });
  for (const fn of [
    ops.ensureCategory,
    ops.createTextChannel,
    ops.archiveChannel,
    ops.unarchiveChannel,
  ])
    expect(fn).not.toHaveBeenCalled();
  expect(await gameBindings(id)).toHaveLength(0);
  expect((await settings.getChannelLifecycleSettings()).lastRunAt).toBe(
    before.lastRunAt,
  );
});

it('R13: concurrent reconciles → one result, one ConflictException', async () => {
  await activeGame();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let entered: () => void = () => undefined;
  const inside = new Promise<'locked'>((r) => {
    entered = () => r('locked');
  });
  jest.mocked(ops.ensureCategory).mockImplementation(async (_g, o) => {
    entered();
    await gate;
    return { id: `cat-${o.name}`, name: o.name, created: false };
  });
  const first = svc.reconcile(live);
  const firstSettled = first.then(
    () => 'settled' as const,
    () => 'settled' as const,
  );
  try {
    // Deterministic: the second call starts only once the first is inside
    // the lock (ensureCategory runs under it) — never on a setImmediate race.
    expect(await Promise.race([inside, firstSettled])).toBe('locked');
    const secondResult = await svc.reconcile(live).catch((e: unknown) => e);
    expect(secondResult).toBeInstanceOf(ConflictException);
  } finally {
    release();
  }
  await first;
});

it('R14: disabled → the cron tick runs nothing', async () => {
  await activeGame();
  await settings.setChannelLifecycleSettings({ enabled: false });
  await t.app.get(ChannelLifecycleScheduler).handleCron();
  expect((await svc.reconcile(live)).stoppedReason).toBe('disabled');
  expect(ops.createTextChannel).not.toHaveBeenCalled();
});

it('R18: bind() conflicting after create → channel deleted, failed, no binding', async () => {
  const id = await activeGame();
  jest
    .spyOn(bindings, 'bind')
    .mockRejectedValueOnce(new ConflictException('taken'));
  const res = await svc.reconcile(live);
  expect(channelDelete).toHaveBeenCalledWith('ch-' + seq, expect.any(String));
  expect(res.items[0]).toMatchObject({ gameId: id, outcome: 'failed' });
  expect(await gameBindings(id)).toHaveLength(0);
});
