/**
 * ROK-1069 — channel-override fallback Discord smoke test.
 *
 * AC: when a lineup's `channelOverrideId` points at a channel where the
 * bot lacks permissions (or the channel id is bogus), the lifecycle
 * dispatcher must fall back to the bound default channel and still
 * deliver the embed. The fallback should be observable from the bot's
 * perspective: a phase-transition embed lands in `defaultChannelId`
 * even though the override is set.
 *
 * The override is forced via the new ROK-1069 test endpoint
 * /admin/test/lineup/revoke-channel-perms.
 *
 * The "happy path" (override → embed lands in override channel) is not
 * exercised here because the companion bot's defaultChannelId is the
 * only channel guaranteed to have the bot present; a real override
 * channel would require additional fixture wiring beyond ROK-1069
 * scope.
 */
import { pollForEmbed } from '../../helpers/polling.js';
import { awaitProcessing, flushEmbedQueue } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';
import { archiveOwnLeftoverLineups } from '../lineup-leftovers.js';

interface LineupPayload {
  id: number;
  title?: string;
  [k: string]: unknown;
}

// 18-digit snowflake the bot will never have in its cache — forces the
// resolver's `hasPostPermissions` check to return false.
const BAD_CHANNEL_ID = '999999999999999999';

/**
 * Title prefixes of the lineups this file creates. Each title is exactly
 * `<prefix>${Date.now()}`; only those stamped before RUN_STARTED_AT are
 * archived as leftovers of an earlier run (lineup-leftovers.ts).
 */
const OWN_TITLE_PREFIXES = ['Override Fallback '] as const;

/** Lineups stamped at or after this instant belong to the current run. */
const RUN_STARTED_AT = Date.now();

async function deleteLineup(api: ApiClient, id: number): Promise<void> {
  await api.delete(`/lineups/${id}`).catch(() => {
    return api
      .patch(`/lineups/${id}/status`, { status: 'archived' })
      .catch(() => null);
  });
}

const inaccessibleOverrideFallsBackToDefault: SmokeTest = {
  name: 'Inaccessible channelOverrideId falls back to bound channel for lineup embed (ROK-1069)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveOwnLeftoverLineups(ctx.api, OWN_TITLE_PREFIXES, RUN_STARTED_AT);

    const title = `Override Fallback ${Date.now()}`;
    const lineup = await ctx.api.post<LineupPayload>('/lineups', {
      title,
      description: 'ROK-1069 channel-override fallback',
      buildingDurationHours: 720,
      votingDurationHours: 720,
      decidedDurationHours: 720,
    });

    try {
      // Force the override to a snowflake the bot cannot resolve.
      await ctx.api.post('/admin/test/lineup/revoke-channel-perms', {
        lineupId: lineup.id,
        channelOverrideId: BAD_CHANNEL_ID,
      });
      await awaitProcessing(ctx.api);

      // Trigger a phase transition. The dispatcher must fall back to
      // the bound default channel (ctx.defaultChannelId) when the
      // override is unreachable.
      await ctx.api.patch(`/lineups/${lineup.id}/status`, {
        status: 'voting',
      });
      await awaitProcessing(ctx.api);
      await flushEmbedQueue(ctx.api);

      // The embed must arrive in the bound default channel — anywhere
      // mentioning the lineup title is an acceptable signal that
      // fallback worked.
      await pollForEmbed(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some((e) => {
            const hay = [
              e.title ?? '',
              e.description ?? '',
              e.footer ?? '',
              ...e.fields.map((f) => `${f.name} ${f.value}`),
            ].join(' ');
            return hay.includes(title);
          }),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const lineupChannelOverrideTests: SmokeTest[] = [
  inaccessibleOverrideFallsBackToDefault,
];
