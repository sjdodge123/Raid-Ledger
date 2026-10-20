/**
 * ROK-1428 (L10, story ROK-1434) — channel lifecycle automation against the
 * real Discord guild: create → archive → unarchive → hand-delete, driven by
 * `POST /admin/discord/lifecycle/reconcile?dryRun=false`.
 *
 * Shared-guild isolation (ROK-1623, feedback_shared_guild_smoke_isolation):
 * no `ci-*` channel by name. Everything this test creates starts with
 * `smoke-lc-` — two run-scoped categories (Games / Archived) and the managed
 * channel (the seeded game's slug, `smoke-lc-<run>-lc`). Leftovers of an
 * earlier run are swept first; teardown deletes every channel it created and
 * restores the lifecycle settings it found.
 *
 * A live reconcile acts on EVERY game with activity, so before each live run
 * the test dry-runs and refuses to continue when the plan touches any other
 * game (createThreshold is raised to 10 and the seed carries 10 events, so
 * ordinary demo games stay below the bar). `serial`: no other test may write
 * the lifecycle settings while this one holds them.
 */
import { ChannelType, type TextChannel } from "discord.js";
import { pollForCondition } from "../../helpers/polling.js";
import {
  companionCanManageChannels,
  createSmokeCategory,
  deleteChannelQuietly,
  everyoneSendDenied,
  fetchChannelFresh,
  findTextChannelByName,
  sweepLifecycleLeftovers,
} from "../../helpers/lifecycle-channels.js";
import { SmokeAssertionError } from "../assert.js";
import { createEvent, deleteEvent } from "../fixtures.js";
import type { ApiClient } from "../api.js";
import type { SmokeTest, TestContext } from "../types.js";

const BASE = "/admin/discord/lifecycle";
const SEED = "/admin/test/channel-lifecycle/seed";
const AGE = "/admin/test/channel-lifecycle/age-binding";
const TIMEOUT_MS = 45_000;
const LIVE_ACTIONS = new Set(["create", "archive", "unarchive"]);

interface Settings {
  enabled: boolean;
  recentActivityDays: number;
  createThreshold: number;
  gamesCategoryId: string | null;
  archiveCategoryId: string | null;
  hideOnArchive: boolean;
  maxChangesPerTick: number;
}
interface ReconcileItem { gameId: number; gameName: string; action: string; outcome: string }
interface Reconcile { stoppedReason: string | null; created: number; items: ReconcileItem[] }
interface ActivityList { items: { gameId: number; binding: { id: string } | null }[] }
interface SeedResult { gameId: number; gameName: string }

interface RunState {
  created: string[];
  eventIds: number[];
  original: Settings | null;
}

/** POST reconcile, retrying while the cron / a nudge holds the lock (409). */
async function reconcile(api: ApiClient, dryRun: boolean): Promise<Reconcile> {
  return pollForCondition(async () => {
    try {
      return await api.post<Reconcile>(`${BASE}/reconcile?dryRun=${String(dryRun)}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("→ 409")) return null;
      throw err;
    }
  }, TIMEOUT_MS);
}

/** Dry-run first; refuse a live run that would touch any game but ours. */
async function reconcileOnlyOurs(api: ApiClient, gameId: number): Promise<Reconcile> {
  const plan = await reconcile(api, true);
  const foreign = plan.items.filter(
    (i) => i.gameId !== gameId && i.outcome === "planned" && LIVE_ACTIONS.has(i.action),
  );
  if (foreign.length > 0) {
    const names = foreign.map((i) => `${i.gameName}:${i.action}`).join(", ");
    throw new SmokeAssertionError(`refusing live reconcile — it would also change: ${names}`);
  }
  const live = await reconcile(api, false);
  if (live.stoppedReason !== null) {
    throw new SmokeAssertionError(`live reconcile stopped: ${live.stoppedReason}`);
  }
  return live;
}

/** Point automation at the smoke categories, then enable (the RL bot may lag the new ids). */
async function enableWith(api: ApiClient, gamesId: string, archiveId: string): Promise<void> {
  await pollForCondition(async () => {
    try {
      return await api.patch<Settings>(`${BASE}/settings`, {
        gamesCategoryId: gamesId,
        archiveCategoryId: archiveId,
        hideOnArchive: false,
        recentActivityDays: 7,
        createThreshold: 10,
        maxChangesPerTick: 25,
        enabled: true,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("→ 400")) return null;
      throw err;
    }
  }, TIMEOUT_MS);
}

/** Poll until the managed channel matches `check`; fail naming what Discord held. */
async function waitForChannel(
  name: string,
  label: string,
  check: (c: TextChannel) => boolean,
): Promise<TextChannel> {
  let last: TextChannel | null = null;
  try {
    return await pollForCondition(async () => {
      last = await findTextChannelByName(name);
      return last && check(last) ? last : null;
    }, TIMEOUT_MS);
  } catch {
    const seen = last === null ? "no channel" : describeChannel(last);
    throw new SmokeAssertionError(`#${name} ${label}: got ${seen}`);
  }
}

function describeChannel(c: TextChannel): string {
  return `parent=${String(c.parentId)} topic=${JSON.stringify(c.topic)} sendDenied=${String(everyoneSendDenied(c))}`;
}

/** The game's managed binding id, from the activity table. */
async function bindingIdFor(api: ApiClient, gameId: number): Promise<string> {
  const list = await api.get<ActivityList>(`${BASE}/activity?all=true`);
  const id = list.items.find((i) => i.gameId === gameId)?.binding?.id;
  if (!id) throw new SmokeAssertionError(`game ${String(gameId)} has no binding after create`);
  return id;
}

async function restoreSettings(api: ApiClient, original: Settings | null): Promise<void> {
  if (!original) return;
  const { enabled, ...rest } = original;
  await api.patch(`${BASE}/settings`, { enabled: false }).catch(() => null);
  await api.patch(`${BASE}/settings`, { ...rest, ...(enabled ? { enabled } : {}) }).catch((err: unknown) => {
    console.warn(`  lifecycle smoke: settings restore failed: ${String(err)}`);
  });
}

async function teardown(ctx: TestContext, state: RunState): Promise<void> {
  await restoreSettings(ctx.api, state.original);
  for (const id of state.eventIds) await deleteEvent(ctx.api, id);
  // Children before their categories.
  for (const id of [...state.created].reverse()) await deleteChannelQuietly(id);
}

async function phaseCreate(ctx: TestContext, seed: SeedResult, slug: string, gamesId: string): Promise<TextChannel> {
  const live = await reconcileOnlyOurs(ctx.api, seed.gameId);
  if (live.created < 1) throw new SmokeAssertionError(`reconcile created ${String(live.created)} channels`);
  return waitForChannel(slug, "under Games with the topic", (c) =>
    c.parentId === gamesId && (c.topic ?? "").includes(`${seed.gameName} on Raid Ledger`),
  );
}

async function phaseArchive(ctx: TestContext, seed: SeedResult, slug: string, archiveId: string): Promise<void> {
  const bindingId = await bindingIdFor(ctx.api, seed.gameId);
  await ctx.api.post(AGE, { bindingId, daysAgo: 40 });
  await reconcileOnlyOurs(ctx.api, seed.gameId);
  await waitForChannel(slug, "archived (parent Archived, @everyone SendMessages denied)", (c) =>
    c.parentId === archiveId && everyoneSendDenied(c),
  );
}

async function phaseUnarchive(ctx: TestContext, state: RunState, seed: SeedResult, slug: string, gamesId: string): Promise<void> {
  const event = await createEvent(ctx.api, "lc", { gameId: seed.gameId });
  state.eventIds.push(event.id);
  await reconcileOnlyOurs(ctx.api, seed.gameId);
  await waitForChannel(slug, "unarchived (back under Games, deny removed)", (c) =>
    c.parentId === gamesId && !everyoneSendDenied(c),
  );
}

/** Hand-deleted managed channel → the next reconcile does not recreate it (D9). */
async function phaseHandDelete(ctx: TestContext, seed: SeedResult, channel: TextChannel): Promise<void> {
  await channel.delete("ROK-1428 smoke: hand-delete");
  await pollForCondition(async () => ((await fetchChannelFresh(channel.id)) ? null : true), TIMEOUT_MS);
  await reconcileOnlyOurs(ctx.api, seed.gameId);
  const again = await findTextChannelByName(channel.name);
  if (again) throw new SmokeAssertionError(`#${channel.name} was recreated (${again.id}) after a hand delete`);
}

async function lifecycleRoundTrip(ctx: TestContext): Promise<void> {
  if (!(await companionCanManageChannels())) {
    throw new SmokeAssertionError("companion bot lacks Manage Channels — cannot create/clean smoke-lc-* channels");
  }
  await sweepLifecycleLeftovers();
  const run = Date.now().toString(36);
  const state: RunState = { created: [], eventIds: [], original: null };
  try {
    state.original = await ctx.api.get<Settings>(`${BASE}/settings`);
    const games = await createSmokeCategory(`smoke-lc-games-${run}`);
    state.created.push(games.id);
    const archive = await createSmokeCategory(`smoke-lc-archived-${run}`);
    state.created.push(archive.id);
    const seed = await ctx.api.post<SeedResult>(SEED, { gameName: `smoke-lc ${run}`, items: { events: 10 } });
    const slug = `smoke-lc-${run}-lc`;
    await enableWith(ctx.api, games.id, archive.id);
    const channel = await phaseCreate(ctx, seed, slug, games.id);
    state.created.push(channel.id);
    if (channel.type !== ChannelType.GuildText) throw new SmokeAssertionError("managed channel is not text");
    await phaseArchive(ctx, seed, slug, archive.id);
    await phaseUnarchive(ctx, state, seed, slug, games.id);
    await phaseHandDelete(ctx, seed, channel);
  } finally {
    await teardown(ctx, state);
  }
}

export const channelLifecycleTests: SmokeTest[] = [
  {
    name: "channel-lifecycle: create → archive → unarchive → no recreate after hand delete (ROK-1428)",
    category: "flow",
    serial: true,
    run: lifecycleRoundTrip,
  },
];
