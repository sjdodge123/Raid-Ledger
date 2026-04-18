/**
 * ROK-1063 — lineup title & description Discord smoke test.
 *
 * Creates a lineup with a known title and description via the API, then
 * polls the default notification channel for the "Community Lineup —
 * Nominations Open!" embed. Asserts the lineup's title appears in the
 * embed (author/header context) and the description appears in the body.
 *
 * This test is intentionally failing until ROK-1063 ships — embeds
 * currently render a static "Community Lineup" header regardless of the
 * lineup's stored title.
 */
import { pollForEmbed } from '../../helpers/polling.js';
import { awaitProcessing } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

interface LineupPayload {
  id: number;
  title?: string;
  description?: string | null;
  [k: string]: unknown;
}

async function archiveAllLineups(api: ApiClient): Promise<void> {
  // Best effort — if an active lineup exists, archive it so we can create a new one.
  try {
    const active = await api.get<{ id: number }>('/lineups/active');
    if (active?.id) {
      await api
        .patch(`/lineups/${active.id}/status`, { status: 'archived' })
        .catch(() => null);
    }
  } catch {
    // No active lineup — nothing to archive.
  }
}

async function deleteLineup(api: ApiClient, id: number): Promise<void> {
  await api.delete(`/lineups/${id}`).catch(() => {
    // Fallback: archive so the next test can create a fresh lineup.
    return api
      .patch(`/lineups/${id}/status`, { status: 'archived' })
      .catch(() => null);
  });
}

const lineupTitleInEmbed: SmokeTest = {
  name: 'Lineup embed shows per-lineup title + description (ROK-1063)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Smoke Lineup ${Date.now()}`;
    const description =
      'Smoke-test description — vote for your favorite pick!';

    const lineup = await ctx.api.post<LineupPayload>('/lineups', {
      title,
      description,
    });

    try {
      await awaitProcessing(ctx.api);

      // Wait for the "created" embed to appear with the custom title.
      const msg = await pollForEmbed(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some((e) => {
            const haystack = [
              e.title ?? '',
              e.description ?? '',
              e.footer ?? '',
              ...e.fields.map((f) => `${f.name} ${f.value}`),
            ].join(' ');
            return haystack.includes(title);
          }),
        ctx.config.timeoutMs,
      );

      const embed = msg.embeds[0];
      const haystack = [
        embed.title ?? '',
        embed.description ?? '',
        embed.footer ?? '',
        ...embed.fields.map((f) => `${f.name} ${f.value}`),
      ].join(' ');

      if (!haystack.includes(title)) {
        throw new Error(
          `Expected lineup title "${title}" in embed, got: ${haystack.slice(0, 500)}`,
        );
      }
      if (!haystack.includes(description)) {
        throw new Error(
          `Expected lineup description "${description}" in embed, got: ${haystack.slice(0, 500)}`,
        );
      }
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const lineupTitleTests: SmokeTest[] = [lineupTitleInEmbed];
