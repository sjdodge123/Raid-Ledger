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
 *   3. ROK-1068 Phase F (AC F3): the two embed descriptions differ
 *      correctly — same "aborted by" line; reason variant has a
 *      blank-line separator + reason text appended; no-reason variant
 *      stops at the "aborted by" sentence with no trailing block.
 *      Builder: `api/src/lineups/lineup-notification-aborted-embed.helpers.ts:37-46`
 *      `const reasonBlock = trimmedReason ? '\n\n${trimmedReason}' : '';`
 *
 * TDD gate: the `POST /lineups/:id/abort` route and the
 * `buildAbortedEmbed` builder do not yet exist, so these tests must
 * fail until the dev agent ships the feature.
 *
 * Strategy mirrors `lineup-title.test.ts`:
 *   - Create a fresh public lineup via the API.
 *   - POST the new abort endpoint.
 *   - Drain BullMQ queues with `awaitProcessing` + `flushEmbedQueue`.
 *   - Use `pollForEmbed` (never a fixed delay) to look for the channel
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

// ── AC F3: explicit reason vs no-reason variance walk-through ──────────────
//
// ROK-1068 Phase F adds an explicit comparison test that aborts two
// lineups back-to-back — one with a reason, one without — and asserts
// the descriptions follow the documented variance contract:
//
//   reasonBlock = trimmedReason ? `\n\n${trimmedReason}` : '';
//   description = `This lineup was aborted by **${actor}**.` + reasonBlock;
//
// Both descriptions must contain the "aborted by" sentence. Only the
// reason variant has the blank-line separator + reason text. The
// no-reason variant must NOT contain `\n\n`.

const abortReasonVarianceWalkthrough: SmokeTest = {
  name: 'Abort embed: reason vs no-reason descriptions follow documented variance (ROK-1068 F3)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    // ── Lineup A: aborted WITH reason ──────────────────────────────
    const reasonTitle = `Variance With ${Date.now()}`;
    const reasonText = 'Scope creep — restarting next week';
    const reasonLineup = await createLineup(ctx.api, reasonTitle);
    let withReasonDesc = '';

    try {
      await ctx.api.post(`/lineups/${reasonLineup.id}/abort`, {
        reason: reasonText,
      });
      await awaitProcessing(ctx.api);
      await flushEmbedQueue(ctx.api);

      const msg = await pollForEmbed(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some(
            (e) =>
              /aborted/i.test(e.title ?? '') &&
              [
                e.title ?? '',
                e.description ?? '',
                e.footer ?? '',
                ...e.fields.map((f) => `${f.name} ${f.value}`),
              ]
                .join(' ')
                .includes(reasonTitle),
          ),
        ctx.config.timeoutMs,
      );
      const withReasonEmbed = msg.embeds.find((e) =>
        /aborted/i.test(e.title ?? ''),
      );
      withReasonDesc = withReasonEmbed?.description ?? '';
    } finally {
      await deleteLineup(ctx.api, reasonLineup.id);
    }

    // ── Lineup B: aborted WITHOUT reason ───────────────────────────
    const noReasonTitle = `Variance Without ${Date.now()}`;
    const noReasonLineup = await createLineup(ctx.api, noReasonTitle);
    let withoutReasonDesc = '';

    try {
      await ctx.api.post(`/lineups/${noReasonLineup.id}/abort`, {});
      await awaitProcessing(ctx.api);
      await flushEmbedQueue(ctx.api);

      const msg = await pollForEmbed(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some(
            (e) =>
              /aborted/i.test(e.title ?? '') &&
              [
                e.title ?? '',
                e.description ?? '',
                e.footer ?? '',
                ...e.fields.map((f) => `${f.name} ${f.value}`),
              ]
                .join(' ')
                .includes(noReasonTitle),
          ),
        ctx.config.timeoutMs,
      );
      const withoutReasonEmbed = msg.embeds.find((e) =>
        /aborted/i.test(e.title ?? ''),
      );
      withoutReasonDesc = withoutReasonEmbed?.description ?? '';
    } finally {
      await deleteLineup(ctx.api, noReasonLineup.id);
    }

    // ── Variance assertions ────────────────────────────────────────
    // Both descriptions must contain the actor-line.
    if (!/aborted by/i.test(withReasonDesc)) {
      throw new Error(
        `With-reason description missing "aborted by": ${withReasonDesc}`,
      );
    }
    if (!/aborted by/i.test(withoutReasonDesc)) {
      throw new Error(
        `No-reason description missing "aborted by": ${withoutReasonDesc}`,
      );
    }

    // Reason variant must contain a blank-line separator + the reason
    // text (per `reasonBlock = '\n\n${trimmedReason}'`).
    if (!withReasonDesc.includes('\n\n')) {
      throw new Error(
        `With-reason description missing blank-line separator before reason: ${JSON.stringify(withReasonDesc)}`,
      );
    }
    if (!withReasonDesc.includes(reasonText)) {
      throw new Error(
        `With-reason description missing reason text "${reasonText}": ${withReasonDesc}`,
      );
    }

    // No-reason variant must NOT contain the blank-line separator (the
    // sentence terminates with the period after the actor name).
    if (withoutReasonDesc.includes('\n\n')) {
      throw new Error(
        `No-reason description unexpectedly contained blank-line separator (suggests an empty reason block leaked): ${JSON.stringify(withoutReasonDesc)}`,
      );
    }

    // The two descriptions must differ — same prefix, divergent suffix.
    if (withReasonDesc === withoutReasonDesc) {
      throw new Error(
        'With-reason and no-reason embed descriptions are identical — variance contract violated',
      );
    }
    if (withReasonDesc.length <= withoutReasonDesc.length) {
      throw new Error(
        `With-reason description should be longer than no-reason variant. with=${withReasonDesc.length} (${JSON.stringify(withReasonDesc)}) without=${withoutReasonDesc.length} (${JSON.stringify(withoutReasonDesc)})`,
      );
    }
  },
};

export const lineupAbortTests: SmokeTest[] = [
  abortWithReasonPostsEmbed,
  abortWithoutReasonOmitsReasonLine,
  abortReasonVarianceWalkthrough,
];
