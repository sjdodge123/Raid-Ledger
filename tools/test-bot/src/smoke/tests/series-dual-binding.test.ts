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
import {
  createEvent,
  deleteEvent,
  deleteBinding,
  awaitProcessing,
} from '../fixtures.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

// ---------------------------------------------------------------------------
// Types + helpers
// ---------------------------------------------------------------------------

interface SlashCommandResponse {
  content?: string;
  embeds?: { title?: string; description?: string }[];
}

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
 * resolves as text).
 */
async function bindSeriesChannel(
  ctx: TestContext,
  seriesId: string,
  channelId: string,
  channelType: typeof GUILD_TEXT | typeof GUILD_VOICE,
): Promise<SlashCommandResponse> {
  return ctx.api.post<SlashCommandResponse>('/admin/test/slash-command', {
    commandName: 'bind',
    options: {
      series: seriesId,
      channel: { id: channelId, type: channelType },
    },
    discordUserId: ctx.testBotDiscordId,
    guildId: ctx.config.guildId,
    channelId,
  });
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
    let textBindingId: string | undefined;
    let voiceBindingId: string | undefined;
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
      textBindingId = textRow?.id;
      voiceBindingId = voiceRow?.id;

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
      if (textBindingId) await deleteBinding(ctx.api, textBindingId);
      if (voiceBindingId) await deleteBinding(ctx.api, voiceBindingId);
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
    const bindingIds: string[] = [];
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
      for (const r of seriesRows) bindingIds.push(r.id);

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
      for (const id of bindingIds) await deleteBinding(ctx.api, id);
      await deleteEvent(ctx.api, series.id);
    }
  },
};

export const seriesDualBindingTests: SmokeTest[] = [
  dualBindingPersists,
  announceRoutesToTextHostsInVoice,
];
