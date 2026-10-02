/**
 * ROK-1351 — series-level dual binding smoke tests.
 *
 * Covers AC2 / AC4: a single event series can hold BOTH a text announce
 * binding and a voice host binding at the same time, set via two sequential
 * `/bind series:X channel:#...` slash commands. After both binds:
 *   - both rows persist (asserted via the admin bindings API), and
 *   - new events in the series announce to the TEXT channel while the
 *     Discord scheduled-event location is the VOICE channel.
 *
 * These tests are TDD-first: on origin/main the clobber bug in
 * cleanupSeriesBindings deletes the first slot when the second is bound, so
 * the dual-binding assertion FAILS. Channels are passed to the slash-command
 * harness in object form ({ id, type }) so FakeInteraction surfaces the
 * voice/text channel type to the /bind handler.
 *
 * Deterministic polling only — no fixed-delay waits.
 */
import { pollForEmbed } from '../../helpers/polling.js';
import { readLastMessages } from '../../helpers/messages.js';
import { withChannelDump } from '../channel-dump.js';
import { assertBindSucceeded, type BindReply } from '../bind-reply.js';
import { deleteSeriesBindings } from '../series-binding-cleanup.js';
import { SmokeAssertionError } from '../assert.js';
import { quickPlayVoiceJoin } from '../fixtures-quick-play.js';
import {
  createEvent,
  deleteEvent,
  awaitProcessing,
  seedFixtureUser,
} from '../fixtures.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

// ---------------------------------------------------------------------------
// Types + helpers
// ---------------------------------------------------------------------------

interface BindingRow {
  id: string;
  channelId: string;
  channelType: 'text' | 'voice';
  bindingPurpose: string;
  recurrenceGroupId?: string | null;
}

/** Discord channel type discriminators (discord.js ChannelType values). */
const GUILD_TEXT = 0;
const GUILD_VOICE = 2;

/**
 * Invoke /bind via the test harness for a series + channel. The channel is
 * passed in object form with its Discord `type` so FakeInteraction surfaces
 * voice vs text to the handler (the string form carries no type and always
 * resolves as text). Throws the /bind refusal text when no binding was saved,
 * so callers sweep the series' bindings in `finally` (deleteSeriesBindings)
 * rather than collecting ids after both binds: a refused second bind would
 * skip that read and leak the first binding.
 */
async function bindSeriesChannel(
  ctx: TestContext,
  seriesId: string,
  channelId: string,
  channelType: typeof GUILD_TEXT | typeof GUILD_VOICE,
  gameName?: string,
): Promise<BindReply> {
  const options: Record<string, unknown> = {
    series: seriesId,
    channel: { id: channelId, type: channelType },
  };
  // A voice bind with an explicit game resolves to a series-linked
  // game-voice-monitor binding (ROK-1372 shouldDeriveSeriesGame is a no-op when
  // the game is explicit), which is the ROK-1390 incident shape.
  if (gameName) options.game = gameName;
  const res = await ctx.api.post<BindReply>('/admin/test/slash-command', {
    commandName: 'bind',
    options,
    discordUserId: ctx.operatorDiscordId,
    guildId: ctx.config.guildId,
    channelId,
  });
  // /bind refuses through editReply, never a throw: fail here with its words.
  const kind = channelType === GUILD_VOICE ? 'voice' : 'text';
  const game = gameName ? ` game "${gameName}"` : '';
  assertBindSucceeded(res, `series ${seriesId} -> ${kind} #${channelId}${game}`);
  return res;
}

/** Fetch all channel bindings (admin API). */
async function listBindings(api: ApiClient): Promise<BindingRow[]> {
  const res = await api.get<{ data: BindingRow[] }>('/admin/discord/bindings');
  return Array.isArray(res) ? res : (res.data ?? []);
}

/** Create a weekly recurring event and return its recurrenceGroupId + id. */
async function createSeries(
  ctx: TestContext,
  tag: string,
): Promise<{ id: number; title: string; recurrenceGroupId: string }> {
  const until = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString();
  const ev = await createEvent(ctx.api, tag, {
    recurrence: { frequency: 'weekly', until },
  });
  const groupId = (ev as { recurrenceGroupId?: string }).recurrenceGroupId;
  if (!groupId) {
    throw new Error(
      `createSeries: event ${ev.id} has no recurrenceGroupId — recurrence not applied`,
    );
  }
  return { id: ev.id, title: ev.title, recurrenceGroupId: groupId };
}

// ---------------------------------------------------------------------------
// AC2 / AC4 — dual binding persists, both slots coexist
// ---------------------------------------------------------------------------

const dualBindingPersists: SmokeTest = {
  name: 'ROK-1351: text + voice series bindings both persist (AC4)',
  category: 'command',
  async run(ctx) {
    const textCh = ctx.textChannels[0];
    const voiceCh = ctx.voiceChannels[0];
    if (!textCh) throw new Error('No text channel available');
    if (!voiceCh) throw new Error('No voice channel available');

    const series = await createSeries(ctx, 'dual-bind-persist');
    try {
      // 1. Bind the TEXT announce channel for the series.
      await bindSeriesChannel(
        ctx,
        series.recurrenceGroupId,
        textCh.id,
        GUILD_TEXT,
      );
      // 2. Bind the VOICE host channel for the SAME series.
      await bindSeriesChannel(
        ctx,
        series.recurrenceGroupId,
        voiceCh.id,
        GUILD_VOICE,
      );
      await awaitProcessing(ctx.api);

      // 3. Both slot rows must coexist for the series. On main, the voice
      //    bind clobbers the text row, so only one row survives (FAILS).
      const bindings = await listBindings(ctx.api);
      const seriesRows = bindings.filter(
        (b) => b.recurrenceGroupId === series.recurrenceGroupId,
      );
      const textRow = seriesRows.find((b) => b.channelId === textCh.id);
      const voiceRow = seriesRows.find((b) => b.channelId === voiceCh.id);

      if (!textRow) {
        throw new Error(
          `Expected a text announce binding for series on #${textCh.name}; ` +
            `got rows: ${JSON.stringify(seriesRows)}`,
        );
      }
      if (!voiceRow) {
        throw new Error(
          `Expected a voice host binding for series on #${voiceCh.name}; ` +
            `got rows: ${JSON.stringify(seriesRows)}`,
        );
      }
      if (textRow.channelType !== 'text') {
        throw new Error(
          `Text slot expected channelType=text, got ${textRow.channelType}`,
        );
      }
      if (voiceRow.channelType !== 'voice') {
        throw new Error(
          `Voice slot expected channelType=voice, got ${voiceRow.channelType}`,
        );
      }
    } finally {
      await deleteSeriesBindings(ctx.api, series.recurrenceGroupId);
      await deleteEvent(ctx.api, series.id);
    }
  },
};

// ---------------------------------------------------------------------------
// AC2 — new event announces to TEXT channel while SE location is VOICE channel
// ---------------------------------------------------------------------------

const announceRoutesToTextHostsInVoice: SmokeTest = {
  name: 'ROK-1351: series event announces to text channel, hosts in voice (AC2)',
  category: 'command',
  async run(ctx) {
    const textCh = ctx.textChannels[0];
    const voiceCh = ctx.voiceChannels[0];
    if (!textCh) throw new Error('No text channel available');
    if (!voiceCh) throw new Error('No voice channel available');

    const series = await createSeries(ctx, 'dual-bind-route');
    try {
      // Bind both slots for the series.
      await bindSeriesChannel(
        ctx,
        series.recurrenceGroupId,
        textCh.id,
        GUILD_TEXT,
      );
      await bindSeriesChannel(
        ctx,
        series.recurrenceGroupId,
        voiceCh.id,
        GUILD_VOICE,
      );
      await awaitProcessing(ctx.api);

      const seriesRows = (await listBindings(ctx.api)).filter(
        (b) => b.recurrenceGroupId === series.recurrenceGroupId,
      );

      // A new event in the series must announce to the TEXT channel.
      // resyncSeriesEvents re-emits UPDATED for all series events, so the
      // first event's embed re-routes to the text-slot channel.
      const announced = await pollForEmbed(
        textCh.id,
        (m) =>
          m.embeds.some((e) => e.title?.includes(series.title)),
        ctx.config.timeoutMs,
      );
      if (!announced) {
        throw new Error(
          `Expected series announcement embed in text channel #${textCh.name}`,
        );
      }

      // The voice slot must be the resolved SE host location: confirm a voice
      // binding exists for the series (SE location resolves via
      // getVoiceChannelForSeries → channelType='voice').
      const voiceRow = seriesRows.find(
        (b) => b.channelId === voiceCh.id && b.channelType === 'voice',
      );
      if (!voiceRow) {
        throw new Error(
          `Expected voice host binding (#${voiceCh.name}) to survive after ` +
            `text announce was set; SE location would not resolve to voice`,
        );
      }
    } finally {
      await deleteSeriesBindings(ctx.api, series.recurrenceGroupId);
      await deleteEvent(ctx.api, series.id);
    }
  },
};

// ---------------------------------------------------------------------------
// ROK-1390 — quick-play spawned in a series-linked voice channel announces to
// the series' text channel (series-announce routing tier), not #general.
// ---------------------------------------------------------------------------

/** Fetch the first game (id + name) from the registry for the routing test. */
async function firstGame(
  ctx: TestContext,
): Promise<{ id: number; name: string }> {
  const res = await ctx.api.get<{ data: { id: number; name: string }[] }>(
    '/admin/settings/games?limit=1',
  );
  const game = res.data[0];
  if (!game) throw new Error('No games in DB for quick-play routing test');
  return game;
}

/**
 * Bind text + series-linked game-voice-monitor voice slots and return the
 * voice binding's id. The caller sweeps both with deleteSeriesBindings.
 */
async function bindSeriesRoutingSlots(
  ctx: TestContext,
  recurrenceGroupId: string,
  textChId: string,
  voiceChId: string,
  gameName: string,
): Promise<string> {
  await bindSeriesChannel(ctx, recurrenceGroupId, textChId, GUILD_TEXT);
  await bindSeriesChannel(
    ctx,
    recurrenceGroupId,
    voiceChId,
    GUILD_VOICE,
    gameName,
  );
  await awaitProcessing(ctx.api);
  const rows = (await listBindings(ctx.api)).filter(
    (b) => b.recurrenceGroupId === recurrenceGroupId,
  );
  const voiceRow = rows.find((b) => b.channelId === voiceChId);
  if (!voiceRow) {
    throw new Error(
      `Expected a series-linked voice binding on #${voiceChId}; got ${JSON.stringify(rows)}`,
    );
  }
  // minPlayers=1: the one-member immediate spawn (no 15-minute delay) that the
  // quick-play seam stands in for. The series link + game survive a
  // config-only PATCH.
  await ctx.api.patch(`/admin/discord/bindings/${voiceRow.id}`, {
    config: { minPlayers: 1 },
  });
  return voiceRow.id;
}

/**
 * The series TEXT channel for the routing test: a text channel that is NOT
 * the default bot channel and NOT the game's own channel-pool binding. On slot
 * envs `textChannels[0]` IS the default channel; either collision would let an
 * embed routed by the wrong tier pass the routing assertion too.
 */
function seriesTextChannel(
  ctx: TestContext,
  gameId: number,
): { id: string; name: string } {
  const gamePool = new Set(
    (ctx.channelPool ?? [])
      .filter((s) => s.gameId === gameId)
      .map((s) => s.channelId),
  );
  const textCh = ctx.textChannels.find(
    (c) => c.id !== ctx.defaultChannelId && !gamePool.has(c.id),
  );
  if (!textCh) {
    const ids = ctx.textChannels.map((c) => c.id).join(', ');
    throw new SmokeAssertionError(
      `ROK-1390 needs a text channel other than the default channel ` +
        `${ctx.defaultChannelId} to tell the series-announce tier from the ` +
        `default fall-through (and not game ${String(gameId)}'s pool channel); ` +
        `textChannels=[${ids}]`,
    );
  }
  return textCh;
}

/**
 * Wait for the quick-play LIVE embed in the series TEXT announce channel.
 * Without the ROK-1390 series-announce tier it would fall through to the
 * default bot channel (the series text slot has gameId=null, so the
 * game-announce tier can't match it).
 *
 * ROK-1447: the title is now the bare game name — "Quick Play" moved to the
 * author line, which SimpleEmbed carries since ROK-1459.
 *
 * On a timeout the failure lists the last messages of the series text channel
 * and the default channel, so an embed the predicate rejected reads
 * differently from no embed at all.
 */
async function expectLiveEmbedInSeriesChannel(
  ctx: TestContext,
  textCh: { id: string; name: string },
): Promise<void> {
  await withChannelDump(
    () =>
      pollForEmbed(
        textCh.id,
        (m) => m.embeds.some((e) => /quick play/i.test(e.author ?? '')),
        ctx.config.timeoutMs,
      ),
    `Expected quick-play LIVE embed in series announce channel #${textCh.name}; ` +
      'series-announce routing tier (ROK-1390) did not fire',
    [
      { label: `series text #${textCh.name}`, channelId: textCh.id },
      { label: 'default notification', channelId: ctx.defaultChannelId },
    ],
    (id, count) => readLastMessages(id, count, { allAuthors: true }),
  );
}

const quickPlayRoutesToSeriesAnnounce: SmokeTest = {
  name: 'ROK-1390: series-linked quick-play announces to series text channel, not #general',
  category: 'voice',
  async run(ctx) {
    const voiceCh = ctx.voiceChannels[0];
    if (!voiceCh) throw new Error('No voice channel available');

    const game = await firstGame(ctx);
    const textCh = seriesTextChannel(ctx, game.id);
    // Slot 7 is shared with the lfg-board joiner phase, which runs in the
    // parallel pool; voice tests run after it, and seeding re-links the slot.
    const fixture = await seedFixtureUser(ctx.api, 3, 7);
    const series = await createSeries(ctx, 'rok1390-route');
    let mintedEventId: number | null = null;
    try {
      const bindingId = await bindSeriesRoutingSlots(
        ctx,
        series.recurrenceGroupId,
        textCh.id,
        voiceCh.id,
        game.name,
      );
      // A seeded, linked human joins through the DEMO_MODE seam: the companion
      // bot is never rostered (ROK-1445 AC9), so its own join mints nothing.
      const joined = await quickPlayVoiceJoin(ctx.api, {
        userId: fixture.userId,
        bindingId,
        channelId: voiceCh.id,
      });
      mintedEventId = joined.eventId;
      if (!joined.spawned) {
        throw new Error(
          `quick-play/voice-join did not spawn (reason=${joined.reason ?? 'none'}, eventId=${String(joined.eventId)})`,
        );
      }
      await expectLiveEmbedInSeriesChannel(ctx, textCh);
    } finally {
      if (mintedEventId !== null) await deleteEvent(ctx.api, mintedEventId);
      await deleteSeriesBindings(ctx.api, series.recurrenceGroupId);
      await deleteEvent(ctx.api, series.id);
    }
  },
};

// The quick-play seam needs no UDP voice connection, so CI runs this test too.
export const seriesDualBindingTests: SmokeTest[] = [
  dualBindingPersists,
  announceRoutesToTextHostsInVoice,
  quickPlayRoutesToSeriesAnnounce,
];
