/**
 * ROK-1941 — a bound pictures channel feeds the hub gallery, against the real
 * Discord guild: bind a Valheim server hub's media channel → the companion
 * bot posts `<name> met their demise! …` with a PNG → the hub lists it as a
 * `death` picture; deleting the post tombstones it (D11).
 *
 * Hub: `claim-drive-fixture` (worker 13) — the worker's own Valheim server
 * hub. The binding goes through the REAL `PUT guilds/:id/media-channel`
 * (which also drops the listener's channel cache); no new demo route.
 *
 * Channel: the EXISTING non-default text channel `join-post-channel.ts`
 * reserves — never a new channel, never `ci-*` or `slot-*` (ROK-1623). The
 * join-post and hub-welcome smokes post there too, so this test is `serial`.
 * The picture is matched by a run-unique name, so an earlier or parallel
 * run's picture can neither satisfy nor confuse it. The post is deleted and
 * the binding cleared in `finally`.
 *
 * The test bot is a bot, not the mod's webhook — the listener ingests every
 * author but Raid Ledger's own bot (D4), so it is accepted. Ingest is async,
 * so the gallery is polled for.
 */
import { deleteOwnMessage, sendWithAttachment, TINY_PNG } from "../../helpers/attachments.js";
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import { cleanupClaimDrive } from "../claim-drive-cleanup.js";
import { pickJoinPostChannel } from "../join-post-channel.js";
import type { DiscordChannel, SmokeTest, TestContext } from "../types.js";

const WORKER = 13;
const TIMEOUT_MS = 30_000;

interface MediaItem {
  id: number;
  kind: string;
  authorName: string | null;
}

const route = (guildId: number) => `/guilds/${String(guildId)}/media-channel`;

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

function pickChannel(ctx: TestContext): DiscordChannel {
  const channel = pickJoinPostChannel(ctx.textChannels, ctx.defaultChannelId);
  if (!channel) {
    fail(`ROK-1941 needs a non-default text channel; textChannels=${String(ctx.textChannels.length)}`);
  }
  return channel;
}

async function seedHub(ctx: TestContext, run: string): Promise<number> {
  const res = await ctx.api.post<{ guildId?: unknown }>(
    "/admin/test/valheim/claim-drive-fixture",
    { worker: WORKER, nameSuffix: run },
  );
  if (typeof res?.guildId !== "number") {
    fail(`claim-drive-fixture: no guildId in ${JSON.stringify(res)}`);
  }
  return res.guildId;
}

/** The hub's `death` pictures by `name` (the run-unique parsed author). */
async function deathsBy(ctx: TestContext, guildId: number, name: string): Promise<MediaItem[]> {
  const res = await ctx.api.get<{ items?: MediaItem[] }>(
    `/hubs/${String(guildId)}/media?kind=death`,
  );
  return (res.items ?? []).filter((i) => i.authorName === name);
}

async function expectDeathPicture(ctx: TestContext, guildId: number, name: string): Promise<void> {
  let seen: MediaItem[] = [];
  try {
    await pollForCondition(async () => {
      seen = await deathsBy(ctx, guildId, name);
      return seen.length === 1 && seen[0]?.kind === "death" ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(`expected exactly one death picture by "${name}" on hub ${String(guildId)}, got ${JSON.stringify(seen)}`);
  }
}

async function expectGone(ctx: TestContext, guildId: number, name: string): Promise<void> {
  let seen: MediaItem[] = [];
  try {
    await pollForCondition(async () => {
      seen = await deathsBy(ctx, guildId, name);
      return seen.length === 0 ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(`deleted post: "${name}" still has pictures on hub ${String(guildId)}: ${JSON.stringify(seen)}`);
  }
}

/** Unbind; never mask the failure that got us here. */
async function unbind(ctx: TestContext, guildId: number): Promise<void> {
  await ctx.api.delete(route(guildId)).catch((err: unknown) => {
    console.warn(`  media channel unbind failed: ${String(err)}`);
  });
}

async function postAndDelete(ctx: TestContext, channel: DiscordChannel, guildId: number, name: string): Promise<void> {
  let messageId: string | null = null;
  try {
    messageId = await sendWithAttachment(
      channel.id,
      `${name} met their demise! Final moments captured…`,
      { name: `${name}_2026-10-25_12-00-00.png`, data: TINY_PNG },
    );
    await expectDeathPicture(ctx, guildId, name);
    await deleteOwnMessage(channel.id, messageId);
    messageId = null;
    await expectGone(ctx, guildId, name);
  } finally {
    if (messageId) {
      await deleteOwnMessage(channel.id, messageId).catch((err: unknown) => {
        console.warn(`  media post cleanup failed: ${String(err)}`);
      });
    }
  }
}

async function ingestSmoke(ctx: TestContext): Promise<void> {
  const channel = pickChannel(ctx);
  const run = Date.now().toString(36);
  try {
    const guildId = await seedHub(ctx, run);
    await unbind(ctx, guildId); // a crashed earlier run's binding, if any
    try {
      await ctx.api.put(route(guildId), { channelId: channel.id });
      await postAndDelete(ctx, channel, guildId, `Smokey${run}`);
    } finally {
      await unbind(ctx, guildId);
    }
  } finally {
    await cleanupClaimDrive(ctx, WORKER);
  }
}

export const hubMediaIngestTests: SmokeTest[] = [
  {
    name: "ROK-1941 hub media: a death post in the bound channel lands as a death picture; deleting it removes it",
    category: "embed",
    serial: true,
    run: ingestSmoke,
  },
];
