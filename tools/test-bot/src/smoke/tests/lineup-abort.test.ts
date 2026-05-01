/**
 * ROK-1062 — admin abort lineup Discord smoke tests.
 *
 * AC:
 *   1. Admin aborts a building lineup with reason "Test abort" → an
 *      embed appears in the bound channel whose title contains
 *      "Aborted" and whose description contains both "aborted by"
 *      and "Test abort".
 *   2. Admin aborts without a reason → an embed is posted whose
 *      description contains "aborted by" but NO reason line.
 *
 * TDD gate: the `POST /lineups/:id/abort` route and the
 * `buildAbortedEmbed` builder do not yet exist, so these tests must
 * fail until the dev agent ships the feature.
 *
 * Strategy mirrors `lineup-title.test.ts`:
 *   - Create a fresh public lineup via the API.
 *   - POST the new abort endpoint.
 *   - Drain BullMQ queues with `awaitProcessing` + `flushEmbedQueue`.
 *   - Use `pollForEmbed` (NEVER `sleep()`) to look for the channel
 *     embed.
 */
import { pollForEmbed } from '../../helpers/polling.js';
import { awaitProcessing, flushEmbedQueue } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

interface LineupPayload {
  id: number;
  title?: string;
  description?: string | null;
  [k: string]: unknown;
}

async function archiveAllLineups(api: ApiClient): Promise<void> {
  try {
    const res = await api.get<
      { id: number }[] | { id: number } | null
    >('/lineups/active');
    const list = Array.isArray(res) ? res : res ? [res] : [];
    for (const row of list) {
      if (!row?.id) continue;
      // Best effort — if abort isn't implemented yet, fall back to status.
      await api
        .post(`/lineups/${row.id}/abort`, {})
        .catch(() =>
          api
            .patch(`/lineups/${row.id}/status`, { status: 'archived' })
            .catch(() => null),
        );
    }
  } catch {
    /* no active lineups */
  }
}

async function deleteLineup(api: ApiClient, id: number): Promise<void> {
  await api.delete(`/lineups/${id}`).catch(() => {
    return api
      .patch(`/lineups/${id}/status`, { status: 'archived' })
      .catch(() => null);
  });
}

async function createLineup(
  api: ApiClient,
  title: string,
): Promise<LineupPayload> {
  return api.post<LineupPayload>('/lineups', {
    title,
    description: 'ROK-1062 abort smoke',
    buildingDurationHours: 720,
    votingDurationHours: 720,
    decidedDurationHours: 720,
    matchThreshold: 10,
  });
}

// ── AC 1: Abort with reason → embed posted with reason line ────────────────

const abortWithReasonPostsEmbed: SmokeTest = {
  name: 'Abort lineup with reason posts Aborted embed with reason text (ROK-1062)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Abort Reason ${Date.now()}`;
    const reason = 'Test abort';
    const lineup = await createLineup(ctx.api, title);

    try {
      // Trigger the abort — this is the unit under test.
      await ctx.api.post(`/lineups/${lineup.id}/abort`, { reason });

      // Drain queues so the embed has fully posted before we assert.
      await awaitProcessing(ctx.api);
      await flushEmbedQueue(ctx.api);

      await pollForEmbed(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some((e) => {
            const titleHit = /aborted/i.test(e.title ?? '');
            const desc = e.description ?? '';
            const byHit = /aborted by/i.test(desc);
            const reasonHit = desc.includes(reason);
            const lineupHit = [
              e.title ?? '',
              e.description ?? '',
              e.footer ?? '',
              ...e.fields.map((f) => `${f.name} ${f.value}`),
            ]
              .join(' ')
              .includes(title);
            return titleHit && byHit && reasonHit && lineupHit;
          }),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

// ── AC 2: Abort without reason → embed posted, no reason line ──────────────

const abortWithoutReasonOmitsReasonLine: SmokeTest = {
  name: 'Abort lineup without reason posts Aborted embed without reason text (ROK-1062)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Abort NoReason ${Date.now()}`;
    const lineup = await createLineup(ctx.api, title);

    try {
      // Empty body — no reason supplied.
      await ctx.api.post(`/lineups/${lineup.id}/abort`, {});

      await awaitProcessing(ctx.api);
      await flushEmbedQueue(ctx.api);

      const msg = await pollForEmbed(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some((e) => {
            const titleHit = /aborted/i.test(e.title ?? '');
            const desc = e.description ?? '';
            const byHit = /aborted by/i.test(desc);
            const lineupHit = [
              e.title ?? '',
              e.description ?? '',
              e.footer ?? '',
              ...e.fields.map((f) => `${f.name} ${f.value}`),
            ]
              .join(' ')
              .includes(title);
            return titleHit && byHit && lineupHit;
          }),
        ctx.config.timeoutMs,
      );

      // Pull the matching embed and assert it does NOT contain "Reason:" or
      // any of the common reason-line phrasing — only the "aborted by" line
      // should be present.
      const abortedEmbed = msg.embeds.find((e) =>
        /aborted/i.test(e.title ?? ''),
      );
      const desc = abortedEmbed?.description ?? '';
      const fieldsText = (abortedEmbed?.fields ?? [])
        .map((f) => `${f.name} ${f.value}`)
        .join(' ');
      const haystack = `${desc} ${fieldsText}`;
      // No reason label/section must appear when reason is absent.
      if (/reason\s*:/i.test(haystack)) {
        throw new Error(
          `Aborted embed unexpectedly contained a "Reason:" line when no reason was supplied. Description: ${desc}`,
        );
      }
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const lineupAbortTests: SmokeTest[] = [
  abortWithReasonPostsEmbed,
  abortWithoutReasonOmitsReasonLine,
];
