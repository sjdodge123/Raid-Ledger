/**
 * Shared voice-binding and lobby-presence helpers for the voice smoke suites
 * (`voice-activity.test.ts`, `lobby-presence.test.ts`, `lobby-server-presence.test.ts`).
 * Split out of `voice-activity.test.ts` (TECH-DEBT-BACKLOG 2026-09-07 fix/rok-1516).
 */
import {
  pollForCondition,
  pollForEmbed,
  waitForEmbedUpdate,
} from '../../helpers/polling.js';
import {
  readLastMessages,
  type SimpleEmbed,
  type SimpleMessage,
} from '../../helpers/messages.js';
import {
  createBinding,
  deleteBinding,
  setLobbyPresence,
  pickChannel,
  awaitProcessing,
  type LobbyPresenceMember,
  type LobbyServerOnlyPlayer,
} from '../fixtures.js';
import {
  assertEmbedColor,
  assertEmbedDescription,
  assertEmbedHasField,
  assertEmbedTitle,
  rosterEntries,
  rosterHasExactly,
} from '../assert.js';
import type { TestContext } from '../types.js';
import { assertAtLeast, must } from './must.js';

/**
 * ROK-1447: the Quick Play chrome palette — `EMBED_COLORS.SIGNUP_CONFIRMATION`
 * for a LIVE session, `EMBED_COLORS.SYSTEM` once it has ENDED.
 */
export const LIVE_EMERALD = 0x34d399;

/** `EMBED_COLORS.SYSTEM` — the presence lead embed and every recap bar (D3/D8). */
export const SYSTEM_SLATE = 0x64748b;

/** `EMBED_COLORS.REMINDER` — a group that has not cleared `minPlayers` (D2). */
export const NEEDS_AMBER = 0xf59e0b;

export async function withVoiceBinding(
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
  const vCh = must(pickChannel(ctx.voiceChannels, index), `voice channel #${String(index)}`);
  const tCh = must(pickChannel(ctx.textChannels, index), `text channel #${String(index)}`);
  let vBindingId: string | undefined;
  let tBindingId: string | undefined;
  try {
    vBindingId = await createBinding(ctx.api, {
      channelId: vCh.id,
      channelType: 'voice',
      purpose,
      ...(gameId !== undefined ? { gameId } : {}),
      config: { minPlayers: 1, notificationChannelId: tCh.id, ...configOverride },
    });
    console.log(`  [voice] Created ${purpose} binding for ${vCh.name}`);
  } catch (err) {
    // ROK-1494 round-2 gate: this used to log and carry on, so a rejected
    // binding (e.g. ROK-1415's 400 BINDING_MONITOR_REQUIRES_GAME) surfaced 60s
    // later as "No open presence row" — a fixture failure wearing a product
    // failure's clothes. NEVER poll on a failed precondition: the ApiClient
    // error already carries `POST <path> → <status>: <body>`, so rethrowing it
    // names the real cause at the moment it happens.
    throw new Error(
      `[voice] fixture precondition failed: could not create the ${purpose} binding ` +
        `for voice channel ${vCh.name} (${vCh.id}, gameId=${String(gameId)}): ` +
        `${(err as Error).message}`,
    );
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


/** The tracked presence message: the ids the seam reported for the room. */
export interface PresenceTarget {
  textChannelId: string;
  messageId: string;
}

/** Assert an embed's author line, naming the pattern and what it actually read. */
export function assertAuthor(embed: SimpleEmbed, pattern: RegExp, label: string): void {
  const author = embed.author ?? '';
  if (!pattern.test(author)) {
    throw new Error(
      `${label}: expected author matching ${String(pattern)}, got "${author}"`,
    );
  }
}

/** Assert an exact embed count, listing what the message actually carries. */
export function assertEmbedCountIs(
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
export function assertRosterSize(
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
export function assertContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: expected to find "${needle}" in "${haystack}"`);
  }
}

/** Assert a rendered string does NOT contain a substring, quoting what it read. */
export function assertLacks(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) {
    throw new Error(
      `${label}: expected NOT to find "${needle}", but read "${haystack}"`,
    );
  }
}

/** The value of the lead embed's "in channel · no game detected" field. */
export function undetectedFieldValue(lead: SimpleEmbed): string {
  return lead.fields.find((f) => UNDETECTED_FIELD.test(f.name))?.value ?? '';
}

export const UNDETECTED_FIELD = /In channel · no game detected/;

/**
 * The five occupants AC9 renders: two on game 1 carrying the event hint, one
 * alone on game 2 (below `minPlayers: 2`), and two whose presence resolved to
 * no game at all.
 */
export function lobbyRoom(
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

/**
 * Two real game ids, read from the API rather than from `ctx.games`.
 *
 * `ctx.games` is derived SOLELY from the smoke admin's own characters
 * (`setup.ts::setupCharacters` → `buildDemoData`), and the demo installer never
 * creates characters for the bootstrap admin — so on a fleet env it holds at
 * most one entry and usually none. That precondition is unsatisfiable, not
 * merely absent (TECH-DEBT-BACKLOG, 2026-09-03). `/admin/settings/games` is the
 * source the rest of this file already uses (`multiGameVoiceDetected`,
 * `siblingBindingSuppression`) and is the only one that can actually be met.
 */
export async function twoGames(ctx: TestContext): Promise<[number, number]> {
  const res = await ctx.api.get<{ data: { id: number }[] }>(
    '/admin/settings/games?limit=2',
  );
  const ids = res.data.map((g) => g.id);
  assertAtLeast(
    ids,
    2,
    `Lobby presence needs two games in the DB to form two groups; ` +
      `/admin/settings/games?limit=2 returned ${String(ids.length)}`,
  );
  return [ids[0], ids[1]];
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
export async function openLobbyRoom(
  ctx: TestContext,
  voiceChannelId: string,
  members: LobbyPresenceMember[],
  serverOnly?: LobbyServerOnlyPlayer[],
): Promise<PresenceTarget> {
  try {
    return await pollForCondition(
      async () => {
        const row = await setLobbyPresence(
          ctx.api,
          voiceChannelId,
          members,
          serverOnly,
        );
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
export async function describeMessage(target: PresenceTarget): Promise<string> {
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
export async function expectMessageState(
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
export async function botMessageIds(channelId: string): Promise<string[]> {
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
export function assertLobbyRender(msg: SimpleMessage, eventId: number): void {
  assertEmbedCountIs(msg, 3, 'Lobby presence message');
  if (msg.components.length !== 0) {
    throw new Error(
      `Lobby presence message: expected no button row (D2 — the two links are ` +
        `the title URL and the masked event link), got ` +
        `${String(msg.components.length)} component row(s)`,
    );
  }
  const lead = must(msg.embeds[0], 'the lobby lead embed');
  const live = must(msg.embeds[1], 'the lobby LIVE-group embed');
  const short = must(msg.embeds[2], 'the lobby short-group embed');

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
 * ROK-1608 — the recap must NAME who was in the room.
 *
 * Prod, 2026-09-17: "5 in voice" and not one of the five was named. The
 * participant line sits directly under the room line and carries bold display
 * names, never mentions — a recap that re-renders must not ping the channel.
 */
export function assertRecapParticipants(description: string): void {
  const participants = description.split('\n')[1] ?? '';
  if (rosterEntries(participants).length === 0) {
    throw new Error(
      'recap participant line: expected bold display names on the line under ' +
        `the "N in voice" line, read "${description}"`,
    );
  }
  assertLacks(participants, '<@', 'recap participant line');
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
export function assertRecapRender(msg: SimpleMessage): void {
  const recapLead = must(msg.embeds[0], 'the recap lead embed');
  assertEmbedTitle(recapLead, /\u{1F50A} .+ · session ended/u);
  // ROK-1499: the room this recap covers HAD members — the D12 seam put them
  // there — so the occupancy ledger must have outlived them leaving. A lead
  // description with no "N in voice" line is the prod bug this closed: the
  // service keeps nothing between flushes, so a recap rendered from the room
  // it can no longer see says "No session started." for an evening three
  // people sat through.
  assertEmbedDescription(recapLead, /\d+ in voice/);
  assertRecapParticipants(msg.embeds[0]?.description ?? '');
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
