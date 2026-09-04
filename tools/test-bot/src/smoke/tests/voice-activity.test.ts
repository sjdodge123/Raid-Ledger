/**
 * Voice Activity smoke tests.
 * Each test picks its own voice channel and creates/cleans up bindings.
 */
import { joinVoice, leaveVoice, getVoiceMembers } from '../../helpers/voice.js';
import { getClient } from '../../client.js';
import {
  pollForCondition,
  pollForEmbed,
  waitForEmbedUpdate,
} from '../../helpers/polling.js';
import { readLastMessages, type SimpleEmbed, type SimpleMessage } from '../../helpers/messages.js';
import {
  assertConditionNeverMet,
  createBinding,
  createEvent,
  deleteBinding,
  deleteEvent,
  setLobbyPresence,
  signup,
  signupAs,
  pickChannel,
  futureTime,
  awaitProcessing,
  flushVoiceSessions,
  triggerClassify,
  injectVoiceSession,
  linkDiscord,
  type LobbyPresenceMember,
} from '../fixtures.js';
import {
  assertEmbedColor,
  assertEmbedHasField,
  assertEmbedTitle,
  rosterEntries,
  rosterHasExactly,
} from '../assert.js';
import type { SmokeTest, TestContext } from '../types.js';

/**
 * ROK-1447: the Quick Play chrome palette — `EMBED_COLORS.SIGNUP_CONFIRMATION`
 * for a LIVE session, `EMBED_COLORS.SYSTEM` once it has ENDED.
 */
const LIVE_EMERALD = 0x34d399;

/** `EMBED_COLORS.SYSTEM` — the presence lead embed and every recap bar (D3/D8). */
const SYSTEM_SLATE = 0x64748b;

/** `EMBED_COLORS.REMINDER` — a group that has not cleared `minPlayers` (D2). */
const NEEDS_AMBER = 0xf59e0b;

async function withVoiceBinding(
  ctx: TestContext,
  index: number,
  purpose: string,
  // ROK-1415: a game-voice-monitor binding MUST carry a game — the write-path
  // guard now rejects a null-game monitor (400). Monitor callers pass a real
  // game; general-lobby callers pass undefined (a null-game lobby is valid).
  gameId: number | undefined,
  fn: (voiceChId: string, textChId: string) => Promise<void>,
  // ROK-1446: merged over the defaults so a lobby test can raise `minPlayers`
  // without changing what every existing caller creates.
  configOverride: Record<string, unknown> = {},
) {
  const vCh = pickChannel(ctx.voiceChannels, index);
  const tCh = pickChannel(ctx.textChannels, index);
  let vBindingId: string | undefined;
  let tBindingId: string | undefined;
  try {
    vBindingId = await createBinding(ctx.api, {
      channelId: vCh.id,
      channelType: 'voice',
      purpose,
      gameId,
      config: { minPlayers: 1, notificationChannelId: tCh.id, ...configOverride },
    });
    console.log(`  [voice] Created ${purpose} binding for ${vCh.name}`);
  } catch (err) {
    console.log(`  [voice] Binding create failed for ${vCh.name}: ${(err as Error).message}`);
  }
  try {
    tBindingId = await createBinding(ctx.api, {
      channelId: tCh.id,
      channelType: 'text',
      purpose: 'game-announcements',
    });
  } catch { /* may already exist */ }
  // Ensure binding creation is fully processed before voice join
  await awaitProcessing(ctx.api);
  try {
    await fn(vCh.id, tCh.id);
  } finally {
    if (vBindingId) await deleteBinding(ctx.api, vBindingId);
    if (tBindingId) await deleteBinding(ctx.api, tBindingId);
  }
}

const voiceJoinDetected: SmokeTest = {
  name: 'Voice join triggers attendance session',
  category: 'voice',
  async run(ctx) {
    await withVoiceBinding(ctx, 0, 'game-voice-monitor', ctx.games[0]?.id, async (vChId) => {
      await joinVoice(vChId);
      try {
        await pollForCondition(
          async () => {
            const members = getVoiceMembers(vChId);
            const self = members.find((m) => m.id === ctx.testBotDiscordId);
            return self ?? null;
          },
          ctx.config.timeoutMs,
          { intervalMs: 1000 },
        );
      } finally {
        leaveVoice();
      }
    });
  },
};

const voiceLeaveRecorded: SmokeTest = {
  name: 'Voice leave ends attendance session',
  category: 'voice',
  async run(ctx) {
    await withVoiceBinding(ctx, 1, 'game-voice-monitor', ctx.games[0]?.id, async (vChId) => {
      await joinVoice(vChId);
      // Wait until bot appears in voice, then leave
      await pollForCondition(
        async () => {
          const m = getVoiceMembers(vChId);
          return m.find((x) => x.id === ctx.testBotDiscordId) ?? null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1000 },
      );
      leaveVoice();
      // Poll until bot disappears from voice channel
      await pollForCondition(
        async () => {
          const m = getVoiceMembers(vChId);
          return m.find((x) => x.id === ctx.testBotDiscordId) ? null : true;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1000 },
      );
    });
  },
};

// ─── ROK-1446 D13: the channel-level lobby presence message ─────────────────
//
// These two tests REPLACE `adHocSpawn` and `adHocPreservesParticipants`, which
// asserted the per-event Quick Play card that D9 now SUPPRESSES for
// `general-lobby` bindings. Both had also been unreachable for this bot since
// ROK-1445: `humanMembers` filters bots out of a room before any group can
// form, and the companion bot IS a bot — so no voice join it performs could
// ever spawn the event those tests waited on.
//
// The D12 seam (`setLobbyPresence`) stands in for the Discord read + presence
// detection step of `resolveRoom` and NOTHING else. The threshold partition,
// the linked-event lookup, the roster union, the render, the post/edit, the
// persistence row and the close ladder all still run for real against the real
// Discord API — which is what keeps this an end-to-end exercise of the message
// rather than a render unit test wearing a costume.

/** The tracked presence message: the ids the seam reported for the room. */
interface PresenceTarget {
  textChannelId: string;
  messageId: string;
}

/** Assert an embed's author line, naming the pattern and what it actually read. */
function assertAuthor(embed: SimpleEmbed, pattern: RegExp, label: string): void {
  const author = embed.author ?? '';
  if (!pattern.test(author)) {
    throw new Error(
      `${label}: expected author matching ${String(pattern)}, got "${author}"`,
    );
  }
}

/** Assert an exact embed count, listing what the message actually carries. */
function assertEmbedCountIs(
  msg: SimpleMessage,
  expected: number,
  label: string,
): void {
  if (msg.embeds.length !== expected) {
    const seen = msg.embeds
      .map((e) => `{title=${e.title ?? '-'} author=${e.author ?? '-'}}`)
      .join(' ');
    throw new Error(
      `${label}: expected exactly ${String(expected)} embeds, got ` +
        `${String(msg.embeds.length)}: ${seen}`,
    );
  }
}

/** Assert a roster block lists exactly `count` bold names and no `+N more`. */
function assertRosterSize(
  description: string,
  count: number,
  label: string,
): void {
  if (!rosterHasExactly(description, count)) {
    throw new Error(
      `${label}: expected exactly ${String(count)} roster entries, got ` +
        `[${rosterEntries(description).join(', ')}] in "${description}"`,
    );
  }
}

/** Assert a rendered string contains a substring, quoting what it read. */
function assertContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: expected to find "${needle}" in "${haystack}"`);
  }
}

/** Assert a rendered string does NOT contain a substring, quoting what it read. */
function assertLacks(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) {
    throw new Error(
      `${label}: expected NOT to find "${needle}", but read "${haystack}"`,
    );
  }
}

/** The value of the lead embed's "in channel · no game detected" field. */
function undetectedFieldValue(lead: SimpleEmbed): string {
  return lead.fields.find((f) => UNDETECTED_FIELD.test(f.name))?.value ?? '';
}

const UNDETECTED_FIELD = /In channel · no game detected/;

/**
 * The five occupants AC9 renders: two on game 1 carrying the event hint, one
 * alone on game 2 (below `minPlayers: 2`), and two whose presence resolved to
 * no game at all.
 */
function lobbyRoom(
  g1: number,
  g2: number,
  eventId: number,
): LobbyPresenceMember[] {
  return [
    { discordUserId: 'rok1446-a', displayName: 'Ana', gameId: g1, eventId },
    { discordUserId: 'rok1446-b', displayName: 'Bo', gameId: g1, eventId },
    { discordUserId: 'rok1446-c', displayName: 'Cass', gameId: g2 },
    { discordUserId: 'rok1446-d', displayName: 'Dee', gameId: null },
    { discordUserId: 'rok1446-e', displayName: 'Eli', gameId: null },
  ];
}

/** The two demo games the room needs, or a failure that says which is missing. */
function twoGames(ctx: TestContext): [number, number] {
  const [g1, g2] = ctx.games;
  if (!g1 || !g2) {
    throw new Error(
      `Lobby presence needs two demo games to form two groups, ctx.games has ` +
        `${String(ctx.games.length)}`,
    );
  }
  return [g1.id, g2.id];
}

/**
 * Install a snapshot and wait until the room owns an OPEN presence row.
 *
 * The presence service caches a channel's bindings for 60 s, so a binding
 * created moments ago can still be invisible to the first flush — the room then
 * has no message and the seam correctly answers `{null, null}`. Re-posting the
 * same snapshot is idempotent (an unchanged payload hash issues no edit at
 * all), so this polls the seam itself rather than waiting on a timer.
 */
async function openLobbyRoom(
  ctx: TestContext,
  voiceChannelId: string,
  members: LobbyPresenceMember[],
): Promise<PresenceTarget> {
  try {
    return await pollForCondition(
      async () => {
        const row = await setLobbyPresence(ctx.api, voiceChannelId, members);
        return row.textChannelId && row.messageId
          ? { textChannelId: row.textChannelId, messageId: row.messageId }
          : null;
      },
      ctx.config.timeoutMs,
      { intervalMs: 3000, backoff: false },
    );
  } catch {
    throw new Error(
      `No open presence row for voice channel ${voiceChannelId} after ` +
        `${String(ctx.config.timeoutMs)}ms: the seam kept answering ` +
        `{textChannelId: null, messageId: null}, which means no general-lobby ` +
        `binding was visible to the flush (binding create failed, or the ` +
        `service's 60s binding cache is still holding a stale miss).`,
    );
  }
}

/** A one-line summary of what the tracked message currently renders. */
async function describeMessage(target: PresenceTarget): Promise<string> {
  const msgs = await readLastMessages(target.textChannelId, 50).catch(() => []);
  const msg = msgs.find((m) => m.id === target.messageId);
  if (!msg) return 'message not among the last 50 bot messages in the channel';
  return (
    `${String(msg.embeds.length)} embed(s): ` +
    msg.embeds
      .map(
        (e) =>
          `{title=${e.title ?? '-'} author=${e.author ?? '-'} ` +
          `color=${e.color === null ? '-' : `#${e.color.toString(16)}`}}`,
      )
      .join(' ')
  );
}

/**
 * Wait for the tracked message to reach a state, and DIAGNOSE it if it never
 * does.
 *
 * A bare poll timeout proves nothing — it cannot tell "the edit never happened"
 * from "the edit happened and rendered the wrong thing". On exhaustion this
 * re-reads the message and reports what it actually holds, so the failure names
 * the expectation against the observed render.
 */
async function expectMessageState(
  ctx: TestContext,
  target: PresenceTarget,
  predicate: (m: SimpleMessage) => boolean,
  expectation: string,
  mode: 'posted' | 'edited',
): Promise<SimpleMessage> {
  const match = (m: SimpleMessage) => m.id === target.messageId && predicate(m);
  try {
    return mode === 'edited'
      ? await waitForEmbedUpdate(
          target.textChannelId,
          match,
          ctx.config.timeoutMs,
        )
      : await pollForEmbed(target.textChannelId, match, ctx.config.timeoutMs);
  } catch (err) {
    throw new Error(
      `${expectation} — never observed on message ${target.messageId}. ` +
        `It currently renders ${await describeMessage(target)}. ` +
        `(underlying: ${(err as Error).message})`,
    );
  }
}

/** Ids of the recent bot messages in a channel — the "no second card" baseline. */
async function botMessageIds(channelId: string): Promise<string[]> {
  return (await readLastMessages(channelId, 50)).map((m) => m.id);
}

/**
 * AC9's live render: lead + LIVE group + short group, and no button row.
 *
 * Design traps pinned here rather than described (spec §Design reference
 * reconciliation): rosters are bold plain names and NEVER `<@id>` mentions
 * (trap 1); there is no components row at all (trap 2); the lead embed is
 * present even though only one group is evented (traps 3/4); and the SHORT
 * group carries no `Open event` link, because a sub-threshold group has no
 * event to link to (trap 5) — the mixed-room mock draws one and is wrong.
 */
function assertLobbyRender(msg: SimpleMessage, eventId: number): void {
  assertEmbedCountIs(msg, 3, 'Lobby presence message');
  if (msg.components.length !== 0) {
    throw new Error(
      `Lobby presence message: expected no button row (D2 — the two links are ` +
        `the title URL and the masked event link), got ` +
        `${String(msg.components.length)} component row(s)`,
    );
  }
  const [lead, live, short] = msg.embeds;

  assertEmbedTitle(lead, /\u{1F50A} .+ · 5 in voice/u);
  assertEmbedColor(lead, SYSTEM_SLATE);
  assertEmbedHasField(lead, UNDETECTED_FIELD);
  const undetected = undetectedFieldValue(lead);
  assertContains(undetected, '**Dee**', 'lead undetected field');
  assertContains(undetected, '**Eli**', 'lead undetected field');

  assertAuthor(live, /LIVE · .*Quick Play · 2 playing/, 'evented group');
  assertEmbedColor(live, LIVE_EMERALD);
  const liveDesc = live.description ?? '';
  assertContains(liveDesc, '[Open event ↗](', 'evented group description');
  assertContains(liveDesc, `/events/${String(eventId)})`, 'evented group link');
  assertRosterSize(liveDesc, 2, 'evented group roster');
  assertLacks(liveDesc, '<@', 'evented group roster');

  assertAuthor(short, /^◌ NEEDS 1 MORE$/, 'short group');
  assertEmbedColor(short, NEEDS_AMBER);
  const shortDesc = short.description ?? '';
  assertRosterSize(shortDesc, 1, 'short group roster');
  assertLacks(shortDesc, 'Open event', 'short group description');
  assertLacks(shortDesc, 'signed up', 'short group description');
}

/**
 * AC9's recap: the SAME message becomes the session-ended card (D8).
 *
 * The two load-bearing clauses are the negative ones — the amber group and the
 * LIVE group must both be GONE from a message that previously carried them.
 * The per-session `ENDED` loop below is correct but currently iterates an empty
 * list: `recapEvents` only hydrates rows with `is_ad_hoc AND
 * channel_binding_id = <binding>`, and the seam cannot create one (see the
 * test's own note), so the recap renders lead-only today.
 */
function assertRecapRender(msg: SimpleMessage): void {
  assertEmbedTitle(msg.embeds[0], /\u{1F50A} .+ · session ended/u);
  for (const embed of msg.embeds) {
    assertEmbedColor(embed, SYSTEM_SLATE);
  }
  for (const embed of msg.embeds.slice(1)) {
    assertAuthor(embed, /■ ENDED · Quick Play/, 'recap session embed');
  }
  const authors = msg.embeds.map((e) => e.author ?? '').join(' | ');
  assertLacks(authors, 'NEEDS', 'recap author lines');
  assertLacks(authors, 'LIVE', 'recap author lines');
}

/**
 * ROK-1446 AC1/AC2/AC4/AC10 — one message per bound lobby channel, carrying
 * every human occupant grouped by game.
 *
 * Replaces `adHocSpawn`. That test polled for the per-event Quick Play card
 * which D9 no longer posts for a lobby binding, and could never have reached
 * its assertion anyway (ROK-1445 filters the companion bot out of the room).
 */
const lobbyPresenceRenders: SmokeTest = {
  name: 'Lobby presence embed renders the room',
  category: 'voice',
  async run(ctx) {
    const [g1, g2] = twoGames(ctx);
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
const lobbyPresenceEditsInPlace: SmokeTest = {
  name: 'Lobby presence embed edits in place as the room changes',
  category: 'voice',
  async run(ctx) {
    const [g1, g2] = twoGames(ctx);
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
  assertAuthor(
    msg.embeds[1],
    /LIVE · .*Quick Play · 3 playing/,
    'merged group',
  );
  assertRosterSize(msg.embeds[1].description ?? '', 3, 'merged group roster');
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

const voiceMemberList: SmokeTest = {
  name: 'Voice members list includes bot after join',
  category: 'voice',
  async run(ctx) {
    const vCh = pickChannel(ctx.voiceChannels, 0);
    await joinVoice(vCh.id);
    try {
      await pollForCondition(
        async () => {
          const members = getVoiceMembers(vCh.id);
          return members.length > 0 ? members : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1000 },
      );
    } finally {
      leaveVoice();
    }
  },
};

/**
 * ROK-842: Voice attendance must match events via ALL bindings on a channel,
 * not just the first. Regression test for the find() → filter() fix.
 */
const multiGameVoiceDetected: SmokeTest = {
  name: 'Multi-game channel detects second binding game event',
  category: 'voice',
  async run(ctx) {
    const vCh = pickChannel(ctx.voiceChannels, 0);
    // Fetch live game IDs from API to avoid hardcoding seed data IDs
    const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
      '/admin/settings/games?limit=2',
    );
    const gameIds = gamesRes.data.map((g) => g.id);
    if (gameIds.length < 2) {
      throw new Error('Need at least 2 games in DB for multi-binding test');
    }
    const [gameA, gameB] = gameIds;
    let bindA: string | undefined;
    let bindB: string | undefined;
    let eventId: number | undefined;
    try {
      // Create TWO game-voice-monitor bindings on the SAME voice channel
      bindA = await createBinding(ctx.api, {
        channelId: vCh.id,
        channelType: 'voice',
        purpose: 'game-voice-monitor',
        gameId: gameA,
        config: { minPlayers: 99 },
      });
      bindB = await createBinding(ctx.api, {
        channelId: vCh.id,
        channelType: 'voice',
        purpose: 'game-voice-monitor',
        gameId: gameB,
        config: { minPlayers: 99 },
      });
      console.log(`  [voice] Two bindings on ${vCh.name}: gameA=${gameA}, gameB=${gameB}`);

      // Create a LIVE event for gameB (the second binding's game)
      const ev = await createEvent(ctx.api, 'multi-bind', {
        gameId: gameB,
        startTime: futureTime(-5), // started 5 min ago
        endTime: futureTime(55),
      });
      eventId = ev.id;
      await signup(ctx.api, ev.id);

      // Join voice and poll until pipeline detects participants
      await joinVoice(vCh.id);
      await pollForCondition(
        async () => {
          const roster = await ctx.api.get<{ participants: unknown[] }>(
            `/events/${ev.id}/ad-hoc-roster`,
          ).catch(() => ({ participants: [] }));
          return roster.participants?.length > 0 ? roster : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          `No voice participants for gameB event ${ev.id} — multi-binding detection failed`,
        );
      });
    } finally {
      leaveVoice();
      if (bindA) await deleteBinding(ctx.api, bindA);
      if (bindB) await deleteBinding(ctx.api, bindB);
      if (eventId) await deleteEvent(ctx.api, eventId);
    }
  },
};

/**
 * ROK-852: Event metrics roster breakdown must show voice data from the
 * companion bot's voice session.  The bot's Discord ID is linked to
 * dmRecipientUserId during setup; signing that user up for the event lets
 * us verify the full pipeline: voice join → DB flush → metrics endpoint →
 * rosterBreakdown with populated voiceDurationSec.
 *
 * SLOW: waits ~35 s for the 30-second in-memory→DB flush interval.
 */
const metricsVoicePopulated: SmokeTest = {
  name: 'Event metrics roster shows voice data (ROK-852)',
  category: 'voice',
  async run(ctx) {
    await withVoiceBinding(ctx, 2, 'game-voice-monitor', ctx.games[0]?.id, async (vChId) => {
      const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
        '/admin/settings/games?limit=1',
      );
      const gameId = gamesRes.data[0]?.id;
      if (!gameId) throw new Error('No games in DB for voice metrics test');

      const ev = await createEvent(ctx.api, 'metrics-voice', {
        gameId,
        startTime: futureTime(-5), // live event (started 5 min ago)
        endTime: futureTime(55),
      });
      try {
        // Sign up the user whose Discord ID = test bot
        await signupAs(ctx.api, ev.id, ctx.dmRecipientUserId);

        await joinVoice(vChId);
        // Poll flush+metrics until voice data appears. The API's voice
        // tracker needs time to receive the gateway event; flush is idempotent.
        type MetricsResponse = {
          voiceSummary: { totalTracked: number } | null;
          rosterBreakdown: Array<{
            userId: number;
            voiceDurationSec: number | null;
            voiceClassification: string | null;
          }>;
        };
        let metrics: MetricsResponse;
        await pollForCondition(
          async () => {
            await flushVoiceSessions(ctx.api);
            const m = await ctx.api.get<MetricsResponse>(
              `/events/${ev.id}/metrics`,
            );
            if (m.voiceSummary && m.voiceSummary.totalTracked >= 1) {
              metrics = m;
              return true;
            }
            return null;
          },
          30000,
          { intervalMs: 3000 },
        );

        if (!metrics!.voiceSummary) {
          throw new Error('voiceSummary is null — voice session not flushed');
        }
        if (metrics!.voiceSummary.totalTracked < 1) {
          throw new Error(
            `totalTracked=${metrics!.voiceSummary.totalTracked}, expected >= 1`,
          );
        }

        const withVoice = metrics!.rosterBreakdown.filter(
          (r) => r.voiceDurationSec !== null && r.voiceDurationSec > 0,
        );
        if (withVoice.length === 0) {
          throw new Error(
            'No roster entries with voice data — userId fallback join failed',
          );
        }
      } finally {
        leaveVoice();
        await deleteEvent(ctx.api, ev.id);
      }
    });
  },
};

/**
 * ROK-943: Comprehensive voice classification + attendance metrics test.
 *
 * Validates ALL classification statuses (full, partial, late, early_leaver,
 * no_show) and ALL attendance statuses (attended, no_show, unmarked) by
 * injecting synthetic voice sessions with controlled timing, then asserting
 * the metrics endpoint returns correct counts and roster entries.
 *
 * Event: 60 min, ended 5 min ago. 7 signups covering every status combination.
 */
const classifyPopulatesAttendance: SmokeTest = {
  name: 'Voice classification populates attendance and metrics (ROK-943)',
  category: 'voice',
  run: rok943ClassifyAllStatuses,
};

async function rok943ClassifyAllStatuses(ctx: TestContext) {
  const users = ctx.demoUserIds ?? [];
  if (users.length < 6) throw new Error('Need 6+ demo users for ROK-943');

  const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
    '/admin/settings/games?limit=1',
  );
  const gameId = gamesRes.data[0]?.id;
  if (!gameId) throw new Error('No games in DB');

  // 60-min event that ended 5 min ago
  const evStart = futureTime(-65);
  const evEnd = futureTime(-5);
  const ev = await createEvent(ctx.api, 'rok943-all-statuses', {
    gameId,
    startTime: evStart,
    endTime: evEnd,
  });

  const fakeIds = users.map((_, i) => `900000000000000${String(i).padStart(4, '0')}`);
  const start = new Date(evStart);
  const end = new Date(evEnd);

  try {
    await rok943SignupUsers(ctx, ev.id, users, fakeIds);
    await rok943InjectSessions(ctx, ev.id, users, fakeIds, start, end);
    await triggerClassify(ctx.api, ev.id);
    await awaitProcessing(ctx.api);
    await rok943AssertMetrics(ctx, ev.id);
  } finally {
    await deleteEvent(ctx.api, ev.id);
  }
}

/** Link Discord IDs and sign up 7 users for the event. */
async function rok943SignupUsers(
  ctx: TestContext,
  eventId: number,
  users: number[],
  fakeIds: string[],
) {
  // Link fake Discord IDs to 5 demo users (user[5] stays unlinked → unmarked)
  for (let i = 0; i < 5; i++) {
    await linkDiscord(ctx.api, users[i], fakeIds[i], `smoke-user-${i}`);
  }
  // Sign up all 7: dmRecipient + 6 demo users
  // discordUserId is now auto-populated from users.discordId at signup time (ROK-985)
  await signupAs(ctx.api, eventId, ctx.dmRecipientUserId);
  for (let i = 0; i < 6; i++) {
    await signupAs(ctx.api, eventId, users[i]);
  }
}

/** Inject voice sessions with controlled timing for each classification. */
async function rok943InjectSessions(
  ctx: TestContext,
  eventId: number,
  users: number[],
  fakeIds: string[],
  start: Date,
  end: Date,
) {
  const b = { eventId };
  // FULL — 50/60 min = 83%, on time
  await injectVoiceSession(ctx.api, { ...b, discordUserId: ctx.testBotDiscordId, userId: ctx.dmRecipientUserId, durationSec: 3000, firstJoinAt: start.toISOString(), lastLeaveAt: end.toISOString() });
  // PARTIAL — 25/60 min = 42%, on time, stayed till end
  await injectVoiceSession(ctx.api, { ...b, discordUserId: fakeIds[0], userId: users[0], durationSec: 1500, firstJoinAt: start.toISOString(), lastLeaveAt: end.toISOString() });
  // LATE — joined 10 min late, 25 min voice
  const lateJoin = new Date(start.getTime() + 10 * 60000);
  await injectVoiceSession(ctx.api, { ...b, discordUserId: fakeIds[1], userId: users[1], durationSec: 1500, firstJoinAt: lateJoin.toISOString(), lastLeaveAt: end.toISOString() });
  // EARLY_LEAVER — on time, left 20 min early, 20 min voice
  const earlyLeave = new Date(end.getTime() - 20 * 60000);
  await injectVoiceSession(ctx.api, { ...b, discordUserId: fakeIds[2], userId: users[2], durationSec: 1200, firstJoinAt: start.toISOString(), lastLeaveAt: earlyLeave.toISOString() });
  // NO_SHOW (brief) — 30 sec (< 120s threshold)
  await injectVoiceSession(ctx.api, { ...b, discordUserId: fakeIds[3], userId: users[3], durationSec: 30, firstJoinAt: start.toISOString(), lastLeaveAt: new Date(start.getTime() + 30000).toISOString() });
  // user[4]: discord linked, no voice → classifyNoShows creates no_show
  // user[5]: no discord → stays unmarked
}

type Metrics = {
  attendanceSummary: {
    attended: number;
    noShow: number;
    excused: number;
    unmarked: number;
    total: number;
    attendanceRate: number;
  } | null;
  voiceSummary: {
    totalTracked: number;
    full: number;
    partial: number;
    late: number;
    earlyLeaver: number;
    noShow: number;
  } | null;
  rosterBreakdown: Array<{
    attendanceStatus: string | null;
    voiceClassification: string | null;
  }>;
};

/** Assert every classification and attendance status appears in metrics. */
async function rok943AssertMetrics(ctx: TestContext, eventId: number) {
  const m = await ctx.api.get<Metrics>(`/events/${eventId}/metrics`);

  // --- Attendance donut ---
  // 8 signups: 7 explicit + event creator (admin, auto-signed-up, unmarked)
  const a = m.attendanceSummary;
  if (!a) throw new Error('attendanceSummary null');
  // ROK-985: event creator (admin) now has discordUserId auto-populated, so
  // classifyNoShows correctly marks them as no_show instead of leaving unmarked.
  // Counts: 4 attended, 3 no_show (brief + classifyNoShows + event creator), 1 unmarked (user[5])
  assertEq('attended', a.attended, 4); // full + partial + late + early_leaver
  assertEq('noShow', a.noShow, 3); // brief voice + classifyNoShows user[4] + event creator
  assertEq('unmarked', a.unmarked, 1); // user[5] no discord link
  assertEq('total', a.total, 8);

  // --- Voice summary ---
  const v = m.voiceSummary;
  if (!v) throw new Error('voiceSummary null');
  assertEq('full', v.full, 1);
  assertEq('partial', v.partial, 1);
  assertEq('late', v.late, 1);
  assertEq('earlyLeaver', v.earlyLeaver, 1);
  assertEq('voiceNoShow', v.noShow, 3); // brief + classifyNoShows user[4] + event creator

  // --- Roster has all statuses ---
  const statuses = new Set(m.rosterBreakdown.map((r) => r.attendanceStatus));
  if (!statuses.has('attended')) throw new Error('No "attended" in roster');
  if (!statuses.has('no_show')) throw new Error('No "no_show" in roster');
  if (!statuses.has(null)) throw new Error('No unmarked (null) in roster');

  const voiceStatuses = new Set(
    m.rosterBreakdown.map((r) => r.voiceClassification),
  );
  for (const expected of ['full', 'partial', 'late', 'early_leaver', 'no_show']) {
    if (!voiceStatuses.has(expected)) {
      throw new Error(`Voice classification "${expected}" missing from roster`);
    }
  }
}

function assertEq(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

/**
 * ROK-959: When two game-voice-monitor bindings share a voice channel and a
 * scheduled event exists on binding B, ad-hoc creation for binding A must be
 * suppressed. The suppression check calls extendScheduledEventWindow(), so we
 * verify extendedUntil is set on the scheduled event after voice join.
 *
 * ROK-1418: also asserts bounded extension — extended_until stays within event
 * end + 6h and a second in-window join does not rewrite it. This file is gated
 * OFF in CI by SMOKE_SKIP_VOICE_JOIN=1 (discord-smoke.yml:101), so the
 * behavioural regression net lives in the B1-2 integration spec.
 */
const siblingBindingSuppression: SmokeTest = {
  name: 'Sibling binding suppresses ad-hoc via channel-level check (ROK-959)',
  category: 'voice',
  async run(ctx) {
    const vCh = pickChannel(ctx.voiceChannels, 0);
    const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
      '/admin/settings/games?limit=2',
    );
    const gameIds = gamesRes.data.map((g) => g.id);
    if (gameIds.length < 2) {
      throw new Error('Need at least 2 games in DB for ROK-959 test');
    }
    const [gameA, gameB] = gameIds;
    let bindA: string | undefined;
    let bindB: string | undefined;
    let eventId: number | undefined;
    try {
      bindA = await createBinding(ctx.api, {
        channelId: vCh.id,
        channelType: 'voice',
        purpose: 'game-voice-monitor',
        gameId: gameA,
        config: { minPlayers: 1 },
      });
      bindB = await createBinding(ctx.api, {
        channelId: vCh.id,
        channelType: 'voice',
        purpose: 'game-voice-monitor',
        gameId: gameB,
        config: { minPlayers: 1 },
      });
      await awaitProcessing(ctx.api);

      // Live event for gameB — extendedUntil starts null
      const eventEnd = futureTime(55);
      const ev = await createEvent(ctx.api, 'rok959-suppress', {
        gameId: gameB,
        startTime: futureTime(-5),
        endTime: eventEnd,
      });
      eventId = ev.id;
      await signup(ctx.api, ev.id);

      // Voice join triggers suppression check on binding A → finds
      // scheduled event on binding B via channel-level subquery →
      // calls extendScheduledEventWindow()
      await joinVoice(vCh.id);

      type EventDetail = { extendedUntil: string | null };
      const firstDetail = await pollForCondition(
        async () => {
          await awaitProcessing(ctx.api);
          const detail = await ctx.api.get<EventDetail>(
            `/events/${ev.id}`,
          );
          return detail.extendedUntil ? detail : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          `extendedUntil not set on event ${ev.id} — sibling suppression failed`,
        );
      });

      // ROK-1418: the window must never exceed event end + 6h (the ceiling).
      const firstExtended = firstDetail.extendedUntil as string;
      const ceilingMs = new Date(eventEnd).getTime() + 6 * 60 * 60 * 1000;
      if (new Date(firstExtended).getTime() > ceilingMs) {
        throw new Error(
          `extendedUntil ${firstExtended} exceeds event end + 6h ceiling`,
        );
      }

      // ROK-1418: a second join inside the 60m window must NOT rewrite it.
      leaveVoice();
      await awaitProcessing(ctx.api);
      await joinVoice(vCh.id);
      await awaitProcessing(ctx.api);
      const afterDetail = await ctx.api.get<EventDetail>(`/events/${ev.id}`);
      if (afterDetail.extendedUntil !== firstExtended) {
        throw new Error(
          `extended_until moved on a second in-window join: ` +
            `${firstExtended} → ${afterDetail.extendedUntil}`,
        );
      }
    } finally {
      leaveVoice();
      if (bindA) await deleteBinding(ctx.api, bindA);
      if (bindB) await deleteBinding(ctx.api, bindB);
      if (eventId) await deleteEvent(ctx.api, eventId);
    }
  },
};

// `metricsVoicePopulated` is excluded — it depends on the 15-minute
// SPAWN_DELAY_MS timer firing. Run with SMOKE_INCLUDE_SLOW=1 to include.
//
// ROK-1446 D13: the two lobby tests LEFT this gate. They used to sit here
// because they waited on that same spawn timer; the D12 seam installs the room
// directly and flushes synchronously, so no timer is involved any more.
const includeSlow = process.env.SMOKE_INCLUDE_SLOW === '1';

/**
 * ROK-985: End-to-end attendance pipeline via real voice join.
 *
 * The 5th-time fix for the attendance pipeline. Previous fixes patched
 * symptoms (boolean inversion, userId fallback in display layer) but never
 * fixed the root cause: signups never had discordUserId populated for
 * linked users, so classification deleted their voice sessions as "orphans."
 *
 * This test validates the FULL real pipeline — no injected sessions:
 *   1. Linked user signs up (discordUserId auto-populated via ROK-985)
 *   2. Real voice join → voice session recorded
 *   3. Flush + classify → attendance populated
 *   4. Metrics show "attended" (not "unmarked")
 */
const attendancePipelineE2E: SmokeTest = {
  name: 'Attendance pipeline: signup → real voice → classify → attended (ROK-985)',
  category: 'voice',
  async run(ctx) {
    await withVoiceBinding(ctx, 3, 'game-voice-monitor', ctx.games[0]?.id, async (vChId) => {
      const gameId = ctx.games[0]?.id;
      if (!gameId) throw new Error('No games for ROK-985 test');

      // Live event — started 5 min ago, ends in 55 min
      const ev = await createEvent(ctx.api, 'rok985-e2e', {
        gameId,
        startTime: futureTime(-5),
        endTime: futureTime(55),
      });
      try {
        // Sign up the companion bot user — discordUserId should auto-populate
        await signupAs(ctx.api, ev.id, ctx.dmRecipientUserId);

        // Real voice join — creates voice session via Discord gateway
        await joinVoice(vChId);

        // Poll until the voice session is flushed to DB
        await pollForCondition(
          async () => {
            await flushVoiceSessions(ctx.api);
            const m = await ctx.api.get<{
              voiceSummary: { totalTracked: number } | null;
            }>(`/events/${ev.id}/metrics`);
            return m.voiceSummary && m.voiceSummary.totalTracked >= 1;
          },
          30000,
          { intervalMs: 3000 },
        );

        // Leave voice + classify
        leaveVoice();
        await flushVoiceSessions(ctx.api);
        await triggerClassify(ctx.api, ev.id);
        await awaitProcessing(ctx.api);

        // Assert: attendance was POPULATED (not left as null/unmarked).
        // A brief voice join (< 120s) classifies as no_show — that's fine.
        // The bug was that attendance stayed null (unmarked) despite voice data.
        type Rok985Metrics = {
          attendanceSummary: {
            attended: number;
            noShow: number;
            unmarked: number;
            total: number;
          };
          rosterBreakdown: Array<{
            userId: number | null;
            attendanceStatus: string | null;
            voiceClassification: string | null;
            voiceDurationSec: number | null;
          }>;
        };
        const m = await ctx.api.get<Rok985Metrics>(`/events/${ev.id}/metrics`);

        // The signed-up user with voice data must have attendance populated
        const botEntry = m.rosterBreakdown.find(
          (r) => r.voiceDurationSec !== null && r.voiceDurationSec > 0,
        );
        if (!botEntry) {
          throw new Error('No roster entry with voice data after classification');
        }
        if (botEntry.attendanceStatus === null) {
          throw new Error(
            `ROK-985 regression: attendanceStatus is null (unmarked) despite voice data. ` +
            `attended=${m.attendanceSummary.attended}, noShow=${m.attendanceSummary.noShow}, ` +
            `unmarked=${m.attendanceSummary.unmarked}. ` +
            'Classification failed to populate attendance from voice session.',
          );
        }
        if (!botEntry.voiceClassification) {
          throw new Error('Voice session was not classified after triggerClassify');
        }
      } finally {
        leaveVoice();
        await deleteEvent(ctx.api, ev.id);
      }
    });
  },
};

// Voice-join tests require real UDP connectivity to Discord voice servers.
// CI runners can't establish voice connections — skip with SMOKE_SKIP_VOICE_JOIN=1 (ROK-969).
const canJoinVoice = process.env.SMOKE_SKIP_VOICE_JOIN !== '1';

export const voiceActivityTests: SmokeTest[] = [
  ...(canJoinVoice ? [voiceJoinDetected, voiceLeaveRecorded] : []),
  classifyPopulatesAttendance,
  lobbyPresenceRenders,
  lobbyPresenceEditsInPlace,
  ...(includeSlow ? [metricsVoicePopulated] : []),
  ...(canJoinVoice
    ? [voiceMemberList, multiGameVoiceDetected, siblingBindingSuppression, attendancePipelineE2E]
    : []),
];
