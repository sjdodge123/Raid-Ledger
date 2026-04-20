/**
 * ROK-1065 — private / targeted lineup Discord smoke test.
 *
 * Behavior being verified (feature does not exist yet; these tests MUST fail):
 *
 *   1. Creating a lineup with `{ visibility: 'private', inviteeUserIds: [<botUserId>] }`
 *      fires a DM to each invitee and does NOT post a lineup-created embed to
 *      the bound notification channel.
 *   2. Transitioning a private lineup from `building` -> `voting` fires DMs
 *      to invitees and does NOT post a voting-open embed to the channel.
 *
 * The test bot's Discord ID is linked to `ctx.dmRecipientUserId` during
 * smoke setup — we use that user as the invitee so the companion bot can
 * observe the DM.
 *
 * Current (pre-implementation) behavior strips unknown schema keys in
 * CreateLineupSchema, so `visibility` is ignored and the lineup is created
 * as public: channel embed posts, no DM fires. Both assertions fail until
 * the spec is implemented.
 */
import { waitForDM } from '../../helpers/polling.js';
import { readLastMessages } from '../../helpers/messages.js';
import {
  awaitProcessing,
  assertConditionNeverMet,
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';
import type { SimpleMessage } from '../../helpers/messages.js';

interface LineupPayload {
  id: number;
  title?: string;
  visibility?: string;
  invitees?: unknown[];
  [k: string]: unknown;
}

/** Best-effort archival of any currently active lineup(s) so create succeeds. */
async function archiveAllLineups(api: ApiClient): Promise<void> {
  try {
    // Spec renames this to an array; pre-impl still returns a single object.
    const res = await api.get<
      { id: number }[] | { id: number } | null
    >('/lineups/active');
    const list = Array.isArray(res) ? res : res ? [res] : [];
    for (const row of list) {
      if (!row?.id) continue;
      await api
        .patch(`/lineups/${row.id}/status`, { status: 'archived' })
        .catch(() => null);
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

/** Returns true if any recent channel message is a lineup-lifecycle embed. */
function hasLineupEmbed(msgs: SimpleMessage[], titlePattern: RegExp): boolean {
  return msgs.some((m) =>
    m.embeds.some((e) => !!e.title && titlePattern.test(e.title)),
  );
}

/** Create a private lineup pinned to a single invitee (the test bot's user). */
async function createPrivateLineup(
  ctx: TestContext,
  title: string,
): Promise<LineupPayload> {
  return ctx.api.post<LineupPayload>('/lineups', {
    title,
    description: 'Invite-only smoke lineup',
    visibility: 'private',
    inviteeUserIds: [ctx.dmRecipientUserId],
  });
}

// ── AC 1: Create private lineup → DM invitee, no channel embed ──

const privateLineupDmsInviteeNoChannelEmbed: SmokeTest = {
  name: 'Private lineup creation DMs invitee and suppresses channel embed (ROK-1065)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Private Smoke ${Date.now()}`;
    const lineup = await createPrivateLineup(ctx, title);
    try {
      // Assert the server acknowledged visibility in the response (spec AC).
      if (lineup.visibility !== 'private') {
        throw new Error(
          `Expected response.visibility === 'private', got ${JSON.stringify(
            lineup.visibility,
          )}`,
        );
      }

      await awaitProcessing(ctx.api);

      // Invitee must receive a DM referencing the lineup title.
      const dm = await waitForDM(
        ctx.testBotDiscordId,
        (m) =>
          m.content.includes(title) ||
          m.embeds.some((e) => {
            const hay = [e.title ?? '', e.description ?? ''].join(' ');
            return hay.includes(title);
          }),
        ctx.config.timeoutMs,
      );
      if (!dm) {
        throw new Error('Invitee did not receive a DM for the private lineup');
      }

      // No lineup-created embed should appear in the bound channel.
      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return hasLineupEmbed(
            msgs,
            /Nominations Open|Community Lineup/i,
          ) && msgs.some((m) =>
            m.embeds.some((e) => {
              const hay = [e.title ?? '', e.description ?? ''].join(' ');
              return hay.includes(title);
            }),
          );
        },
        8_000,
        `Channel received a lineup-created embed for private lineup "${title}" — expected none`,
        { intervalMs: 2000 },
      );
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

// ── AC 2: Phase transition on private lineup → DMs invitee, no channel embed ──

const privateLineupPhaseTransitionSuppressesChannel: SmokeTest = {
  name: 'Private lineup building→voting DMs invitee and suppresses channel embed (ROK-1065)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Private Phase ${Date.now()}`;
    const lineup = await createPrivateLineup(ctx, title);
    try {
      await awaitProcessing(ctx.api);

      // Transition to voting — this is the second notification hook.
      await ctx.api.patch(`/lineups/${lineup.id}/status`, {
        status: 'voting',
      });
      await awaitProcessing(ctx.api);

      // Invitee must receive a voting-open DM.
      const dm = await waitForDM(
        ctx.testBotDiscordId,
        (m) =>
          m.embeds.some((e) => {
            const hay = [e.title ?? '', e.description ?? ''].join(' ');
            return /vote|voting/i.test(hay);
          }),
        ctx.config.timeoutMs,
      );
      if (!dm) {
        throw new Error(
          'Invitee did not receive a voting-open DM for the private lineup',
        );
      }

      // No voting-open embed should be posted to the channel.
      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return msgs.some((m) =>
            m.embeds.some((e) => {
              const hay = [e.title ?? '', e.description ?? ''].join(' ');
              return /vote|voting/i.test(hay) && hay.includes(title);
            }),
          );
        },
        8_000,
        `Channel received a voting-open embed for private lineup "${title}" — expected none`,
        { intervalMs: 2000 },
      );
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

// ── AC 3: Response includes invitees array with the expected invitee ──

const privateLineupResponseIncludesInvitees: SmokeTest = {
  name: 'Private lineup create response includes invitees array (ROK-1065)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Private Invitees ${Date.now()}`;
    const lineup = await createPrivateLineup(ctx, title);
    try {
      const invitees = Array.isArray(lineup.invitees) ? lineup.invitees : null;
      if (!invitees) {
        throw new Error(
          `Expected lineup.invitees to be an array, got ${JSON.stringify(
            lineup.invitees,
          )}`,
        );
      }
      const ids = invitees
        .map((row) => (row as { id?: number } | null)?.id)
        .filter((v): v is number => typeof v === 'number');
      if (!ids.includes(ctx.dmRecipientUserId)) {
        throw new Error(
          `Expected invitees to contain user ${ctx.dmRecipientUserId}, got ${JSON.stringify(
            ids,
          )}`,
        );
      }
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

// ── AC 4: Multiple concurrent lineups allowed (the 409 check must be gone) ──

const multipleConcurrentLineupsAllowed: SmokeTest = {
  name: 'Multiple concurrent active lineups permitted — no 409 (ROK-1065)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const firstTitle = `Concurrent A ${Date.now()}`;
    const secondTitle = `Concurrent B ${Date.now()}`;
    const first = await ctx.api.post<LineupPayload>('/lineups', {
      title: firstTitle,
      description: 'first concurrent',
    });
    let second: LineupPayload | null = null;
    try {
      // Second create must succeed. Under pre-ROK-1065 code it returns 409.
      second = await ctx.api.post<LineupPayload>('/lineups', {
        title: secondTitle,
        description: 'second concurrent',
      });
      if (!second?.id) {
        throw new Error(
          `Second lineup create did not return an id: ${JSON.stringify(second)}`,
        );
      }

      // Confirm both show up as active.
      await awaitProcessing(ctx.api);
      const activeRes = await ctx.api.get<
        { id: number }[] | { id: number }
      >('/lineups/active');
      const list = Array.isArray(activeRes)
        ? activeRes
        : activeRes
          ? [activeRes]
          : [];
      const ids = list.map((l) => l.id);
      if (!ids.includes(first.id) || !ids.includes(second.id)) {
        throw new Error(
          `Expected GET /lineups/active to include both ${first.id} and ${second.id}, got ${JSON.stringify(
            ids,
          )}`,
        );
      }
    } finally {
      await deleteLineup(ctx.api, first.id);
      if (second?.id) await deleteLineup(ctx.api, second.id);
    }
  },
};

export const privateLineupTests: SmokeTest[] = [
  privateLineupDmsInviteeNoChannelEmbed,
  privateLineupPhaseTransitionSuppressesChannel,
  privateLineupResponseIncludesInvitees,
  multipleConcurrentLineupsAllowed,
];
