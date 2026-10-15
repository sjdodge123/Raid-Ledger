/**
 * ROK-1766 — Quick Play Announcements for a General Lobby spawn.
 *
 * A text channel T carries BOTH an Announcements(G) and a Quick Play
 * Announcements(G) binding; a voice channel V is a General Lobby. A Quick Play
 * session of G spawned in the lobby must post ONE per-event Quick Play card in
 * T, leave the lobby's room card where it was, and post nothing else to T
 * (the Announcements(G) row is for scheduled events only).
 *
 * The spawn goes through the DEMO_MODE `quick-play/voice-join` seam with an
 * explicit `gameId`. A real lobby spawn takes its game from the members'
 * presence groups, and the listener filters bots out of those groups, so the
 * companion bot can never form one — that is why the seam carries the game.
 *
 * Deterministic polling only — no fixed-delay waits.
 */
import {
  pollForCondition,
  pollForEmbed,
  snapshotMessageIds,
} from '../../helpers/polling.js';
import { readLastMessages, type SimpleMessage } from '../../helpers/messages.js';
import { withChannelDump } from '../channel-dump.js';
import { SmokeAssertionError } from '../assert.js';
import {
  quickPlayVoiceJoin,
  withAdHocEventsEnabled,
} from '../fixtures-quick-play.js';
import {
  assertConditionNeverMet,
  awaitProcessing,
  createBinding,
  deleteBinding,
  deleteEvent,
  seedFixtureUser,
  setLobbyPresence,
  type LobbyPresenceMember,
  type LobbyPresenceRow,
} from '../fixtures.js';
import {
  QP_PURPOSE,
  nonPoolFixtures,
  sweepQuickPlayBindings,
} from '../quick-play-bindings.js';
import type { DiscordChannel, SmokeTest, TestContext } from '../types.js';
import { must } from './must.js';

interface Channels {
  game: { id: number; name: string };
  qpText: DiscordChannel;
  lobbyText: DiscordChannel;
  voice: DiscordChannel;
}

/**
 * A game with no channel-pool binding, and two text channels that are neither
 * the default channel nor a pool channel, so a card routed by the wrong tier
 * cannot land where an assertion looks.
 */
async function pickChannels(ctx: TestContext): Promise<Channels> {
  const { games, freeGames, texts } = await nonPoolFixtures(ctx);
  const game = freeGames[0] ?? games[0];
  const voice = ctx.voiceChannels[1] ?? ctx.voiceChannels[0];
  const [qpText, lobbyText] = texts;
  if (!game || !qpText || !lobbyText || !voice) {
    throw new SmokeAssertionError(
      `ROK-1766 needs a game, two non-default non-pool text channels and a ` +
        `voice channel; got game=${String(game?.id)} texts=${String(texts.length)} ` +
        `voice=${String(voice?.id)}`,
    );
  }
  return { game, qpText, lobbyText, voice };
}

/** Create a binding, naming the fixture precondition if the API refuses it. */
async function bind(
  ctx: TestContext,
  ids: string[],
  opts: Parameters<typeof createBinding>[1],
): Promise<string> {
  try {
    const id = await createBinding(ctx.api, opts);
    ids.push(id); // claimed before any assertion so teardown always sees it
    return id;
  } catch (err) {
    throw new Error(
      `[qp] fixture precondition failed: ${opts.purpose} on ${opts.channelId}: ` +
        `${(err as Error).message}`,
    );
  }
}

/** Open the lobby's room card; the 60s binding cache can hide a new bind. */
async function openLobbyRoom(
  ctx: TestContext,
  voiceId: string,
  members: LobbyPresenceMember[],
): Promise<LobbyPresenceRow> {
  return pollForCondition(
    async () => {
      const row = await setLobbyPresence(ctx.api, voiceId, members);
      return row.textChannelId && row.messageId ? row : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 3000, backoff: false },
  );
}

const isQuickPlayCard = (gameName: string) => (m: SimpleMessage) =>
  m.embeds.some(
    (e) =>
      /Quick Play/.test(e.author ?? '') && (e.title ?? '').includes(gameName),
  );

/** New messages in T (since `before`) that mention the game at all. */
async function newGameMessages(
  channelId: string,
  gameName: string,
  before: ReadonlySet<string>,
): Promise<SimpleMessage[]> {
  const msgs = await readLastMessages(channelId, 25);
  return msgs.filter(
    (m) =>
      !before.has(m.id) &&
      m.embeds.some((e) =>
        `${e.title ?? ''} ${e.description ?? ''}`.includes(gameName),
      ),
  );
}

async function expectQuickPlayCard(
  ctx: TestContext,
  ch: Channels,
  before: ReadonlySet<string>,
): Promise<void> {
  await withChannelDump(
    () =>
      pollForEmbed(ch.qpText.id, isQuickPlayCard(ch.game.name), ctx.config.timeoutMs, {
        excludeIds: before,
      }),
    `Expected a new Quick Play card for ${ch.game.name} in QP channel ` +
      `#${ch.qpText.name} after a General Lobby spawn (ROK-1766 AC5)`,
    [
      { label: `qp text #${ch.qpText.name}`, channelId: ch.qpText.id },
      { label: `lobby text #${ch.lobbyText.name}`, channelId: ch.lobbyText.id },
    ],
    (id, count) => readLastMessages(id, count, { allAuthors: true }),
  );
  await awaitProcessing(ctx.api);
  // Exactly one: Announcements(G) on the same channel must stay silent for a
  // lobby spawn, and the second join must edit, not post a second card.
  await assertConditionNeverMet(
    async () =>
      (await newGameMessages(ch.qpText.id, ch.game.name, before)).length > 1,
    15_000,
    `Expected exactly ONE new ${ch.game.name} message in #${ch.qpText.name} ` +
      `for the lobby spawn; Announcements(G) or a second QP card also posted`,
  );
}

async function spawnTwice(
  ctx: TestContext,
  ch: Channels,
  bindingId: string,
  userIds: [number, number],
): Promise<number> {
  const target = { bindingId, channelId: ch.voice.id, gameId: ch.game.id };
  const a = await quickPlayVoiceJoin(ctx.api, { ...target, userId: userIds[0] });
  if (!a.spawned || a.eventId === null) {
    throw new Error(
      `lobby voice-join did not spawn (reason=${a.reason ?? 'none'}, eventId=${String(a.eventId)})`,
    );
  }
  const b = await quickPlayVoiceJoin(ctx.api, { ...target, userId: userIds[1] });
  if (b.eventId !== a.eventId) {
    throw new SmokeAssertionError(
      `Second lobby join must join event ${String(a.eventId)}, got ${String(b.eventId)}`,
    );
  }
  return a.eventId;
}

const lobbySpawnPostsQuickPlayCard: SmokeTest = {
  name: 'ROK-1766: General Lobby Quick Play spawn posts to the Quick Play Announcements channel',
  category: 'voice',
  async run(ctx) {
    const ch = await pickChannels(ctx);
    await sweepQuickPlayBindings(ctx.api, ch.game.id);
    // Slots 6/7: voice tests run after the parallel pool that also uses them,
    // and seeding re-links the slot (same reasoning as series-dual-binding).
    const users = [await seedFixtureUser(ctx.api, 3, 6), await seedFixtureUser(ctx.api, 3, 7)];
    const room: LobbyPresenceMember[] = users.map((u, i) => ({
      discordUserId: u.discordId,
      displayName: `QP-${String(i)}`,
      gameId: ch.game.id,
    }));
    const bindingIds: string[] = [];
    let eventId: number | null = null;
    try {
      const textBind = { channelId: ch.qpText.id, channelType: 'text' as const, gameId: ch.game.id };
      await bind(ctx, bindingIds, { ...textBind, purpose: 'game-announcements' });
      await bind(ctx, bindingIds, { ...textBind, purpose: QP_PURPOSE });
      const lobbyId = await bind(ctx, bindingIds, {
        channelId: ch.voice.id,
        channelType: 'voice',
        purpose: 'general-lobby',
        config: { minPlayers: 1, notificationChannelId: ch.lobbyText.id },
      });
      const card = await openLobbyRoom(ctx, ch.voice.id, room);
      await withAdHocEventsEnabled(ctx.api, async () => {
        const before = await snapshotMessageIds(ch.qpText.id);
        eventId = await spawnTwice(ctx, ch, lobbyId, [must(users[0], 'fixture user 0').userId, must(users[1], 'fixture user 1').userId]);
        await expectQuickPlayCard(ctx, ch, before);
      });
      await expectLobbyCardUnchanged(ctx, ch, room, card, eventId);
    } finally {
      await setLobbyPresence(ctx.api, ch.voice.id, null).catch(() => {});
      if (eventId !== null) await deleteEvent(ctx.api, eventId).catch(() => {});
      for (const id of bindingIds) {
        await deleteBinding(ctx.api, id).catch(() => {});
      }
    }
  },
};

/** The lobby's room card keeps its channel and message id (edited in place). */
async function expectLobbyCardUnchanged(
  ctx: TestContext,
  ch: Channels,
  room: LobbyPresenceMember[],
  card: LobbyPresenceRow,
  eventId: number | null,
): Promise<void> {
  if (card.textChannelId !== ch.lobbyText.id) {
    throw new SmokeAssertionError(
      `Lobby room card opened in ${String(card.textChannelId)}, expected the ` +
        `lobby's notification channel #${ch.lobbyText.name} (${ch.lobbyText.id})`,
    );
  }
  const linked = room.map((m) => (eventId !== null ? { ...m, eventId } : { ...m }));
  const now = await setLobbyPresence(ctx.api, ch.voice.id, linked);
  if (now.textChannelId !== card.textChannelId || now.messageId !== card.messageId) {
    throw new SmokeAssertionError(
      `Lobby room card moved: expected ${String(card.textChannelId)}/${String(card.messageId)}, ` +
        `got ${String(now.textChannelId)}/${String(now.messageId)}`,
    );
  }
  const msgs = await readLastMessages(ch.lobbyText.id, 50);
  if (!msgs.some((m) => m.id === card.messageId)) {
    throw new SmokeAssertionError(
      `Lobby room card ${String(card.messageId)} is gone from #${ch.lobbyText.name}`,
    );
  }
}

// The voice-join seam needs no UDP voice connection, so CI runs this too.
export const quickPlayAnnouncementsTests: SmokeTest[] = [
  lobbySpawnPostsQuickPlayCard,
];
