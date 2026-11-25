/**
 * Lobby presence smoke tests (ROK-1446 / ROK-1447 / ROK-1692): the general-lobby
 * presence card renders, edits in place, and a brief visit's card is deleted.
 * Split out of `voice-activity.test.ts`, which still registers these tests.
 */
import {
  pollForCondition,
} from '../../helpers/polling.js';
import {
  messageExists,
  readLastMessages,
} from '../../helpers/messages.js';
import {
  assertConditionNeverMet,
  createEvent,
  deleteEvent,
  setLobbyPresence,
  pickChannel,
} from '../fixtures.js';
import {
  SmokeAssertionError,
} from '../assert.js';
import type { SmokeTest, TestContext } from '../types.js';
import { must } from './must.js';
import {
  assertAuthor,
  assertEmbedCountIs,
  assertLacks,
  assertLobbyRender,
  assertRecapRender,
  assertRosterSize,
  botMessageIds,
  describeMessage,
  expectMessageState,
  lobbyRoom,
  openLobbyRoom,
  type PresenceTarget,
  twoGames,
  withVoiceBinding,
} from './voice-lobby.helpers.js';

/**
 * ROK-1446 AC1/AC2/AC4/AC10 — one message per bound lobby channel, carrying
 * every human occupant grouped by game.
 *
 * Replaces `adHocSpawn`. That test polled for the per-event Quick Play card
 * which D9 no longer posts for a lobby binding, and could never have reached
 * its assertion anyway (ROK-1445 filters the companion bot out of the room).
 */
export const lobbyPresenceRenders: SmokeTest = {
  name: 'Lobby presence embed renders the room',
  category: 'voice',
  async run(ctx) {
    const [g1, g2] = await twoGames(ctx);
    await withVoiceBinding(
      ctx,
      2,
      'general-lobby',
      undefined,
      async (vChId) => {
        const created = await createEvent(ctx.api, 'lobby-presence', {
          gameId: g1,
        });
        // Claimed BEFORE the first assertion: a `finally` that resolves the id
        // later deletes nothing whenever an assertion throws, and leaks the
        // event on every red run (spec constraint 4).
        const eventId = created.id;
        try {
          const target = await openLobbyRoom(
            ctx,
            vChId,
            lobbyRoom(g1, g2, eventId),
          );
          const msg = await expectMessageState(
            ctx,
            target,
            () => true,
            'The bound lobby channel must own one readable presence message',
            'posted',
          );
          assertLobbyRender(msg, eventId);
        } finally {
          await setLobbyPresence(ctx.api, vChId, null);
          await deleteEvent(ctx.api, eventId);
        }
      },
      { minPlayers: 2 },
    );
  },
};

/**
 * ROK-1446 AC1/AC5/AC7 — the message is EDITED in place as the room changes,
 * and folds into its own recap when the room empties.
 *
 * Replaces `adHocPreservesParticipants`. The ROK-1243 invariant that test
 * carried — a participant who leaves stays on the roster, struck — keeps its
 * pin at unit level (`ad-hoc-notification.service.spec.ts:477-550`, plus the
 * channel-embed case added by this story); what is asserted here is the surface
 * that actually survives D9: one message id, edited, never a second card.
 */
export const lobbyPresenceEditsInPlace: SmokeTest = {
  name: 'Lobby presence embed edits in place as the room changes',
  category: 'voice',
  async run(ctx) {
    const [g1, g2] = await twoGames(ctx);
    await withVoiceBinding(
      ctx,
      2,
      'general-lobby',
      undefined,
      async (vChId) => {
        const created = await createEvent(ctx.api, 'lobby-edits', {
          gameId: g1,
        });
        const eventId = created.id;
        try {
          const target = await openLobbyRoom(
            ctx,
            vChId,
            lobbyRoom(g1, g2, eventId),
          );
          await assertMergesIntoOneGroup(ctx, target, vChId, g1, g2, eventId);
          await assertFoldsIntoRecap(ctx, target, vChId);
        } finally {
          await setLobbyPresence(ctx.api, vChId, null);
          await deleteEvent(ctx.api, eventId);
        }
      },
      { minPlayers: 2 },
    );
  },
};

/** The binding's grace for the brief-visit test, in minutes (the minimum). */
const BRIEF_GRACE_MINUTES = 1;

/**
 * The API's presence drain cadence (`PRESENCE_FLUSH_INTERVAL_MS`). The empty
 * room is first flushed within one tick, and re-flushed within one tick of its
 * grace running out (ROK-1692) — never by waiting for the 5-min reaper cron.
 */
const PRESENCE_DRAIN_TICK_MS = 5_000;

/**
 * The brief-visit test's OWN channel (ROK-1692). `lobbyPresenceRenders` and
 * `lobbyPresenceEditsInPlace` share index 2, and the latter ends with its row
 * still OPEN — its binding's 5-min grace outlives the test and deleting a
 * binding leaves the row. On index 2 this test's first flush re-lives that
 * card, whose stays carry games, so it recaps instead of being deleted.
 */
const BRIEF_VISIT_CHANNEL_INDEX = 3;

/** The voice/text index the other general-lobby tests bind. */
const SHARED_LOBBY_CHANNEL_INDEX = 2;

/** Fail fast (never retried) when the pool folds both indexes onto one channel. */
function assertOwnLobbyChannel(ctx: TestContext): void {
  const own = must(pickChannel(ctx.voiceChannels, BRIEF_VISIT_CHANNEL_INDEX), 'the brief-visit voice channel');
  const shared = must(pickChannel(ctx.voiceChannels, SHARED_LOBBY_CHANNEL_INDEX), 'the shared-lobby voice channel');
  if (own.id === shared.id) {
    throw new SmokeAssertionError(
      `Brief-visit test needs a voice channel no other general-lobby test ` +
        `binds, but the pool has ${String(ctx.voiceChannels.length)} voice ` +
        `channel(s), so index ${String(BRIEF_VISIT_CHANNEL_INDEX)} and index ` +
        `${String(SHARED_LOBBY_CHANNEL_INDEX)} are both ${own.name} (${own.id}).`,
    );
  }
}

/**
 * The card `openLobbyRoom` handed back must be one THIS test posted.
 *
 * An inherited open row (an earlier test's card re-lived by the first flush)
 * carries that test's history and is recapped rather than deleted; without
 * this check the failure surfaces as a poll timeout that the runner retries,
 * hiding it. A `SmokeAssertionError` is never retried and names the row.
 */
function assertFreshCard(
  target: PresenceTarget,
  textChannelId: string,
  before: string[],
): void {
  if (target.textChannelId !== textChannelId) {
    throw new SmokeAssertionError(
      `Brief-visit room's open presence row posts to ${target.textChannelId}, ` +
        `not this binding's notification channel ${textChannelId}: message ` +
        `${target.messageId} is an inherited row, not a card this test posted.`,
    );
  }
  if (before.includes(target.messageId)) {
    throw new SmokeAssertionError(
      `Brief-visit room re-lived message ${target.messageId}, which was ` +
        `already in ${textChannelId} before this test opened its room: an ` +
        `earlier test left the voice channel's presence row OPEN. A brief ` +
        `visit must start from a card it owns.`,
    );
  }
}

/**
 * ROK-1692 — a drive-by visit leaves no card behind.
 *
 * Its own test, because the room must be one where NOTHING happened: every
 * member reads `gameId: null` and no event is linked. Any detected game recaps
 * instead (see `assertBriefVisitDeleted`). The binding's grace is set to the
 * one-minute minimum so the deletion lands inside a smoke run.
 */
export const lobbyBriefVisitDeleted: SmokeTest = {
  name: 'Lobby presence card of a brief visit is deleted',
  category: 'voice',
  async run(ctx) {
    assertOwnLobbyChannel(ctx);
    await withVoiceBinding(
      ctx,
      BRIEF_VISIT_CHANNEL_INDEX,
      'general-lobby',
      undefined,
      async (vChId, tChId) => {
        try {
          const before = await botMessageIds(tChId);
          const target = await openLobbyRoom(ctx, vChId, [
            { discordUserId: 'rok1692-a', displayName: 'Ana', gameId: null },
            { discordUserId: 'rok1692-b', displayName: 'Bo', gameId: null },
          ]);
          assertFreshCard(target, tChId, before);
          await assertBriefVisitDeleted(
            ctx,
            target,
            vChId,
            BRIEF_GRACE_MINUTES * 60_000,
          );
        } finally {
          await setLobbyPresence(ctx.api, vChId, null);
        }
      },
      { minPlayers: 2, gracePeriod: BRIEF_GRACE_MINUTES },
    );
  },
};

/** Cass switches to game 1: the amber group folds into the LIVE one. */
async function assertMergesIntoOneGroup(
  ctx: TestContext,
  target: PresenceTarget,
  vChId: string,
  g1: number,
  g2: number,
  eventId: number,
): Promise<void> {
  const merged = lobbyRoom(g1, g2, eventId).map((m) =>
    m.discordUserId === 'rok1446-c' ? { ...m, gameId: g1 } : m,
  );
  await setLobbyPresence(ctx.api, vChId, merged);
  const msg = await expectMessageState(
    ctx,
    target,
    (m) => m.embeds.length === 2,
    'A room that merged into one game group must edit its EXISTING message ' +
      'down to lead + 1 group (AC5 — batched edit in place, never a new post)',
    'edited',
  );
  if (msg.editedAt === null) {
    throw new Error(
      `Message ${target.messageId} carries no editedAt: the room changed, so ` +
        `the tracked message must have been EDITED, not replaced`,
    );
  }
  assertEmbedCountIs(msg, 2, 'Merged lobby presence message');
  const mergedEmbed = must(msg.embeds[1], 'the merged group embed');
  assertAuthor(
    mergedEmbed,
    /LIVE · .*Quick Play · 3 playing/,
    'merged group',
  );
  assertRosterSize(mergedEmbed.description ?? '', 3, 'merged group roster');
  const authors = msg.embeds.map((e) => e.author ?? '').join(' | ');
  assertLacks(authors, 'NEEDS', 'merged message author lines');
}

/**
 * The room empties: the same message becomes the recap and NOTHING else posts.
 *
 * The negative window is the AC7 clause — completions fold into this message,
 * so a lobby session must never emit a separate completion card.
 */
async function assertFoldsIntoRecap(
  ctx: TestContext,
  target: PresenceTarget,
  vChId: string,
): Promise<void> {
  const seen = await botMessageIds(target.textChannelId);
  // `[]` is an EMPTY ROOM (the recap path). It is NOT `null`, which would clear
  // the override and hand the channel back to real Discord reads.
  await setLobbyPresence(ctx.api, vChId, []);
  const recap = await expectMessageState(
    ctx,
    target,
    (m) => /session ended/.test(m.embeds[0]?.title ?? ''),
    'An emptied room must edit its OWN message into the session recap (D8)',
    'edited',
  );
  assertRecapRender(recap);
  await assertConditionNeverMet(
    async () => {
      const now = await botMessageIds(target.textChannelId);
      return now.some((id) => !seen.includes(id));
    },
    20_000,
    `A new bot message appeared in ${target.textChannelId} after the recap. ` +
      `Completions fold into the existing presence message (AC7/D9) — a lobby ` +
      `session must never post a second card.`,
  );
}

/**
 * The API's title fallback when a voice channel does not resolve
 * (`channel-presence-embed.lead.helpers.ts::UNKNOWN_CHANNEL_NAME`).
 */
const UNRESOLVED_ROOM_NAME = 'Voice channel';

/**
 * The "no second card" watch after a brief visit's card is deleted: four drain
 * ticks, so any re-flush of the empty room has had several chances to post.
 */
const NO_SECOND_CARD_WINDOW_MS = 4 * PRESENCE_DRAIN_TICK_MS;

/** The pool's name for a voice channel — the room name its cards carry. */
function voiceRoomName(ctx: TestContext, vChId: string): string {
  const ch = ctx.voiceChannels.find((c) => c.id === vChId);
  if (!ch) throw new Error(`Voice channel ${vChId} is not in the smoke pool`);
  return ch.name;
}

/**
 * Ids of the lobby cards and recaps for ONE room in a text channel.
 *
 * Both lead with `🔊 <room> · ` (`leadTitle` / `recapTitle` in the API's
 * `channel-presence-embed.*.helpers.ts`). The brief-visit room posts into the
 * guild's default notification channel, where the same API bot posts unrelated
 * event embeds, so counting every bot message let a burst of those fail the
 * check. The unresolved-room fallback title counts too, so a card whose room
 * name failed to resolve is still seen rather than filtered out.
 */
async function roomLobbyCardIds(
  channelId: string,
  roomName: string,
): Promise<string[]> {
  const heads = [roomName, UNRESOLVED_ROOM_NAME].map(
    (name) => `\u{1F50A} ${name} · `,
  );
  return (await readLastMessages(channelId, 50))
    .filter((m) => {
      const title = m.embeds[0]?.title ?? '';
      return heads.some((head) => title.startsWith(head));
    })
    .map((m) => m.id);
}

/** Poll until Discord no longer has the brief visit's card (ROK-1692). */
async function awaitCardDeleted(
  ctx: TestContext,
  target: PresenceTarget,
  graceMs: number,
): Promise<void> {
  try {
    await pollForCondition(
      async () =>
        (await messageExists(target.textChannelId, target.messageId))
          ? null
          : true,
      graceMs + 2 * PRESENCE_DRAIN_TICK_MS + ctx.config.timeoutMs,
      { intervalMs: 1000 },
    );
  } catch (err) {
    throw new Error(
      `A brief visit's card must be DELETED once the room has been empty for ` +
        `the grace (ROK-1692), ` +
        `but message ${target.messageId} still exists and renders ` +
        `${await describeMessage(target)}. ` +
        `(underlying: ${(err as Error).message})`,
    );
  }
}

/**
 * The room empties and the grace runs out: a drive-by visit's card is DELETED
 * (ROK-1692).
 *
 * Every member reads `gameId: null` and no event is linked, so nothing
 * happened in the room — the only shape the operator ruled a drive-by. (A seam
 * member WITH a `gameId` lands on the occupancy stay and recaps through the
 * P2-2 fallback; `lobbyPresenceEditsInPlace` pins that recap.) The decision is
 * taken only once the binding's grace has run out, and the API re-flushes the
 * empty room on the first drain tick after that (ROK-1692) — so the delete
 * lands by grace + two ticks. The poll allows that plus the usual timeout of
 * headroom, and does not depend on the 5-min reaper cron. NOTHING posts in the
 * card's place either — the AC7 clause: a lobby session never emits a second
 * card. Only THIS room's lobby cards count (`roomLobbyCardIds`); the watch
 * window opens when the delete is observed, and a card posted while the room
 * sat empty is caught by the snapshot taken at that moment.
 */
async function assertBriefVisitDeleted(
  ctx: TestContext,
  target: PresenceTarget,
  vChId: string,
  graceMs: number,
): Promise<void> {
  const room = voiceRoomName(ctx, vChId);
  const chId = target.textChannelId;
  const before = await roomLobbyCardIds(chId, room);
  // `[]` is an EMPTY ROOM (the recap path). It is NOT `null`, which would clear
  // the override and hand the channel back to real Discord reads.
  await setLobbyPresence(ctx.api, vChId, []);
  await awaitCardDeleted(ctx, target, graceMs);
  const seen = await roomLobbyCardIds(chId, room);
  const replaced = seen.filter((id) => !before.includes(id));
  const never =
    `A lobby session never posts a second card (AC7/D9), and a drive-by ` +
    `visit's card is deleted, never replaced (ROK-1692).`;
  if (replaced.length > 0) {
    throw new Error(
      `Lobby card(s) ${replaced.join(', ')} for ${room} appeared in ${chId} ` +
        `while the brief visit's room sat empty. ${never}`,
    );
  }
  await assertConditionNeverMet(
    async () =>
      (await roomLobbyCardIds(chId, room)).some((id) => !seen.includes(id)),
    NO_SECOND_CARD_WINDOW_MS,
    `A new lobby card for ${room} appeared in ${chId} after the brief ` +
      `visit's card was deleted. ${never}`,
  );
}
