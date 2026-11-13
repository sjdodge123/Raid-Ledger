/**
 * Planned temporary voice channel smoke test (operator ruling 2026-11-13).
 *
 * While an event's ephemeral voice channel is PLANNED (global toggle on,
 * per-event opt-in, start still outside the create buffer, no channel yet):
 *   - the event embed's voice line is `🔊 ⏰ <name> · opens <t:UNIX:t>` —
 *     plain text, never a `<#id>` mention of the game's default channel;
 *   - the Discord Scheduled Event is External (3) with
 *     `entityMetadata.location` = that name and no channel.
 * Once the scheduler creates the channel (buffer widened + forced scan):
 *   - the SE is edited to Voice (2) in that channel;
 *   - the embed voice line becomes `🔊 <#channelId>`.
 *
 * The event starts 60 min out with a 30-min create buffer, so the every-minute
 * scheduler cron cannot create the channel before the "planned" assertions.
 * Deterministic polling only — no fixed delays.
 */
import { GuildScheduledEventEntityType } from 'discord.js';
import { getGuild } from '../../client.js';
import { pollForCondition } from '../../helpers/polling.js';
import { readLastMessages } from '../../helpers/messages.js';
import {
  createEvent,
  deleteEvent,
  futureTime,
  awaitProcessing,
  flushEmbedQueue,
  channelForTest,
  channelForGame,
} from '../fixtures.js';
import {
  acquireScheduledEvents,
  releaseScheduledEvents,
  releaseScheduledEventsAndRethrow,
} from '../scheduled-events-toggle.js';
import {
  setEphemeralVoiceConfig,
  forceEphemeralScan,
  getEphemeralChannelId,
  resolveCategoryId,
  resolveGameId,
  reportOrphanChannel,
} from './ephemeral-voice.test.js';
import type { SmokeTest, TestContext } from '../types.js';

const SPEAKER = '\u{1F50A}'; // 🔊
const BUFFER_MIN = 30;
const SE_NAME_MAX = 100;

interface SeView {
  id: string;
  name: string;
  entityType: GuildScheduledEventEntityType;
  channelId: string | null;
  location: string | null;
}

/** Mirror of `buildEphemeralChannelName` (api scheduled-event.helpers.ts). */
function expectedPlannedName(title: string, gameName: string | null): string {
  const named =
    gameName && !title.toLowerCase().includes(gameName.toLowerCase())
      ? `${title} — ${gameName}`
      : title;
  const capped =
    named.length <= SE_NAME_MAX ? named : named.slice(0, SE_NAME_MAX - 1) + '…';
  const stripped = capped.replace(/\s+event\s*$/i, '');
  const base = stripped.trim().length > 0 ? stripped : capped;
  const marked = `⏰ ${base}`;
  return marked.length <= SE_NAME_MAX
    ? marked
    : marked.slice(0, SE_NAME_MAX - 1) + '…';
}

function toSeView(se: {
  id: string;
  name: string;
  entityType: GuildScheduledEventEntityType;
  channelId: string | null;
  entityMetadata: { location?: string | null } | null;
}): SeView {
  return {
    id: se.id,
    name: se.name,
    entityType: se.entityType,
    channelId: se.channelId,
    location: se.entityMetadata?.location ?? null,
  };
}

/** Find the event's SE by its unique title (REST fetch, not cache). */
async function findSeByTitle(title: string): Promise<SeView | null> {
  const events = await getGuild().scheduledEvents.fetch();
  const match = events.find((se) => se.name.includes(title));
  return match ? toSeView(match) : null;
}

/** Fetch one SE by id, forcing a REST round-trip; null when gone. */
async function fetchSe(seId: string): Promise<SeView | null> {
  return getGuild()
    .scheduledEvents.fetch({ guildScheduledEvent: seId, force: true })
    .then(toSeView)
    .catch(() => null);
}

/** The 🔊 line of the event's embed in `channelId`, or null when absent. */
async function readVoiceLine(
  channelId: string,
  title: string,
): Promise<{ found: boolean; line: string | null }> {
  const msgs = await readLastMessages(channelId, 30);
  const embed = msgs
    .flatMap((m) => m.embeds)
    .find((e) => e.title?.includes(title));
  if (!embed) return { found: false, line: null };
  const lines = (embed.description ?? '').split('\n');
  return { found: true, line: lines.find((l) => l.startsWith(SPEAKER)) ?? null };
}

/** Poll until the embed's voice line satisfies `accept`; explicit failure. */
async function pollVoiceLine(
  ctx: TestContext,
  channelId: string,
  title: string,
  accept: (line: string) => boolean,
  want: string,
): Promise<string> {
  let last: { found: boolean; line: string | null } = { found: false, line: null };
  try {
    return await pollForCondition(
      async () => {
        last = await readVoiceLine(channelId, title);
        return last.line !== null && accept(last.line) ? last.line : null;
      },
      ctx.config.timeoutMs,
      { intervalMs: 2000 },
    );
  } catch {
    throw new Error(
      `Embed voice line: expected ${want}; got ${last.found ? JSON.stringify(last.line) : 'no embed for the event'}`,
    );
  }
}

/** BEFORE the channel exists: SE External at the planned name, no channel. */
function assertPlannedSe(se: SeView, expectedName: string): void {
  if (se.entityType !== GuildScheduledEventEntityType.External) {
    throw new Error(
      `Planned SE: expected entityType External (3), got ${se.entityType} (channel ${se.channelId})`,
    );
  }
  if (se.location !== expectedName) {
    throw new Error(
      `Planned SE: expected location ${JSON.stringify(expectedName)}, got ${JSON.stringify(se.location)}`,
    );
  }
  if (se.channelId !== null) {
    throw new Error(`Planned SE: expected no channel, got ${se.channelId}`);
  }
}

/** BEFORE: embed line is `🔊 ⏰ <name> · opens <t:UNIX:t>`, no mention. */
async function assertPlannedEmbed(
  ctx: TestContext,
  channelId: string,
  title: string,
  opensUnix: number,
): Promise<void> {
  const line = await pollVoiceLine(ctx, channelId, title, () => true, 'a 🔊 line');
  const opens = `· opens <t:${opensUnix}:t>`;
  const problems: string[] = [];
  if (!line.startsWith(`${SPEAKER} ⏰ `)) problems.push('missing "🔊 ⏰ " prefix');
  if (!line.includes(title)) problems.push(`missing title ${title}`);
  if (!line.includes(opens)) problems.push(`missing "${opens}"`);
  if (line.includes('<#')) problems.push('contains a <# channel mention');
  if (problems.length > 0) {
    throw new Error(
      `Planned embed voice line ${JSON.stringify(line)}: ${problems.join('; ')}`,
    );
  }
}

/** AFTER the scan: SE repointed to Voice in the created channel. */
async function assertLiveSe(
  ctx: TestContext,
  seId: string,
  channelId: string,
): Promise<void> {
  const seen: { last: SeView | null } = { last: null };
  const live = await pollForCondition(
    async () => {
      seen.last = await fetchSe(seId);
      const isVoice =
        seen.last?.entityType === GuildScheduledEventEntityType.Voice;
      return isVoice ? seen.last : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 2000 },
  ).catch(() => {
    throw new Error(
      `Live SE: expected entityType Voice (2) after channel creation, got ${JSON.stringify(seen.last)}`,
    );
  });
  if (live.channelId !== channelId) {
    throw new Error(
      `Live SE: expected channelId ${channelId}, got ${live.channelId ?? 'none'}`,
    );
  }
}

/** Widen the create buffer so the event is inside it, then force the scan. */
async function createChannelNow(
  ctx: TestContext,
  eventId: number,
  categoryId: string,
): Promise<string> {
  await setEphemeralVoiceConfig(ctx.api, {
    enabled: true,
    categoryId,
    createBufferMinutes: 90,
    idleMinutes: 30,
  });
  await forceEphemeralScan(ctx.api);
  await awaitProcessing(ctx.api);
  return pollForCondition(
    async () => getEphemeralChannelId(ctx.api, eventId),
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  );
}

/** Product teardown first (event delete), then orphan checks, then toggles. */
async function teardown(
  ctx: TestContext,
  eventId: number,
  seId: string | null,
  channelId: string | null,
): Promise<void> {
  const liveId =
    channelId ??
    (await getEphemeralChannelId(ctx.api, eventId).catch(() => null));
  await deleteEvent(ctx.api, eventId).catch(() => undefined);
  if (liveId) await reportOrphanChannel(liveId);
  if (seId) await reportOrphanSe(seId);
  await setEphemeralVoiceConfig(ctx.api, {
    enabled: false,
    categoryId: null,
  }).catch(() => undefined);
  await releaseScheduledEvents(ctx.api);
}

/** Warn + best-effort delete an SE that survived the event delete. */
async function reportOrphanSe(seId: string): Promise<void> {
  const se = await getGuild()
    .scheduledEvents.fetch({ guildScheduledEvent: seId, force: true })
    .catch(() => null);
  if (!se) return;
  console.warn(`[planned-voice] SE ${seId} survived event delete`);
  await se.delete().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[planned-voice] companion-bot delete of SE ${seId} failed: ${msg}`);
  });
}

/** Poll for the event's SE (2× timeout: reconciliation → BullMQ → Discord). */
async function awaitSe(ctx: TestContext, title: string): Promise<SeView> {
  return pollForCondition(() => findSeByTitle(title), ctx.config.timeoutMs * 2, {
    intervalMs: 2000,
  }).catch(() => {
    throw new Error(`No Scheduled Event appeared for event "${title}"`);
  });
}

const plannedVoiceSurfaces: SmokeTest = {
  name: 'Planned temporary voice channel: embed name + open time, SE External → Voice once created',
  category: 'voice',
  async run(ctx) {
    const categoryId = await resolveCategoryId(ctx);
    const gameId = channelForTest(ctx, 3).gameId ?? (await resolveGameId(ctx));
    const embedChannelId = channelForGame(ctx, gameId);
    await setEphemeralVoiceConfig(ctx.api, {
      enabled: true,
      categoryId,
      createBufferMinutes: BUFFER_MIN,
      idleMinutes: 30,
    });
    await acquireScheduledEvents(ctx.api);
    const startTime = futureTime(60);
    const ev = await createEvent(ctx.api, 'planned-voice', {
      gameId,
      startTime,
      endTime: futureTime(120),
      ephemeralVoiceEnabled: true,
    }).catch(releaseScheduledEventsAndRethrow(ctx.api));
    let seId: string | null = null;
    let channelId: string | null = null;
    try {
      await awaitProcessing(ctx.api);
      await flushEmbedQueue(ctx.api);
      const read = await ctx.api.get<{ game?: { name?: string } | null }>(
        `/events/${ev.id}`,
      );
      const expectedName = expectedPlannedName(ev.title, read.game?.name ?? null);
      const se = await awaitSe(ctx, ev.title);
      seId = se.id;
      assertPlannedSe(se, expectedName);
      const opensUnix = Math.floor(
        (Date.parse(startTime) - BUFFER_MIN * 60_000) / 1000,
      );
      await assertPlannedEmbed(ctx, embedChannelId, ev.title, opensUnix);

      channelId = await createChannelNow(ctx, ev.id, categoryId);
      await flushEmbedQueue(ctx.api);
      await assertLiveSe(ctx, seId, channelId);
      const mention = `<#${channelId}>`;
      await pollVoiceLine(ctx, embedChannelId, ev.title, (l) => l.includes(mention), mention);
    } finally {
      await teardown(ctx, ev.id, seId, channelId);
    }
  },
};

export const ephemeralVoicePlannedTests: SmokeTest[] = [plannedVoiceSurfaces];
