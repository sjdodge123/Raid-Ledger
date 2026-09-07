/**
 * Smoke test setup — connects the bot, discovers channels/games,
 * and builds the TestContext used by all smoke tests.
 */
import { connect, getClient, getGuild } from '../client.js';
import { readLastMessages } from '../helpers/messages.js';
import { resolveApiBotUserId, setApiBotUserId } from '../helpers/bot-author.js';
import { channelSetPrefix, selectChannelSet } from './channel-set.js';
import { buildChannelPools, requireTextChannel } from './channel-filter.js';
import { ApiClient } from './api.js';
import { SMOKE } from './config.js';
import { linkDiscord, cleanupScheduledEvents, pauseReconciliation, disableScheduledEvents, resetToSeed } from './fixtures.js';
import { setupChannelPool } from './channel-pool.js';
import type { TestContext, DiscordChannel } from './types.js';

/** Connect the companion bot and return its Discord user ID. */
async function connectBot(): Promise<{ botDiscordId: string }> {
  console.log('  Connecting companion bot...');
  await connect();
  getClient().setMaxListeners(30);
  const botDiscordId = getClient().user!.id;
  console.log(`  Bot connected (Discord ID: ${botDiscordId})`);
  return { botDiscordId };
}

/** Link the test bot's Discord ID to a demo user for DM testing. */
async function setupDmRecipient(
  api: ApiClient,
  testUserId: number,
  botDiscordId: string,
  allUsers: { id: number; username: string }[],
): Promise<number> {
  const dmRecipient = allUsers.find((u) => u.id !== testUserId);
  const dmRecipientUserId = dmRecipient?.id ?? testUserId;

  console.log(`  Linking test bot Discord ID to demo user ${dmRecipientUserId} (${dmRecipient?.username ?? 'admin'})...`);
  await linkDiscord(api, dmRecipientUserId, botDiscordId, 'SmokeTestBot');

  console.log('  Enabling Discord DM notifications for DM recipient...');
  await api.post('/admin/test/enable-discord-notifications', {
    userId: dmRecipientUserId,
  }).catch(() => {
    console.log('  (Demo notification endpoint not available — using admin prefs)');
  });

  return dmRecipientUserId;
}

/** Find the text channel that received the "Online" card posted after `postedAfter`. */
async function findOnlineCardChannel(
  textChannels: DiscordChannel[],
  postedAfter: number,
): Promise<DiscordChannel | undefined> {
  for (const ch of textChannels) {
    try {
      // allAuthors: this is a channel-reachability probe, not an assertion —
      // the "Online" card may predate the current bot identity (ROK-1469).
      // Only the card THIS setup just posted counts: the shared test guild
      // also holds older "Online" cards from the fleet's per-slot bots, and
      // on 2026-09-05 the flow step latched onto one of those and polled the
      // wrong channel for forty minutes while the API posted to this one.
      const msgs = await readLastMessages(ch.id, 1, { allAuthors: true });
      if (msgs.some((m) => m.timestamp.getTime() >= postedAfter
        && m.embeds.some((e) => e.title === 'Online'
        || e.title?.includes('Online')))) {
        return ch;
      }
    } catch { /* skip */ }
  }
  return undefined;
}

/**
 * Ensure a default notification channel is configured, then discover it.
 * ROK-1507: the seed AND the chosen channel are asserted to be GuildText —
 * an orphaned ephemeral voice channel once became the default here.
 */
async function discoverDefaultChannel(
  api: ApiClient,
  textChannels: DiscordChannel[],
): Promise<string> {
  console.log('  Discovering default notification channel...');
  const seed = requireTextChannel(textChannels[0], 'default notification channel');
  await api.put(
    '/admin/settings/discord-bot/channel',
    { channelId: seed.id },
  ).catch(() => {});
  const postedAfter = Date.now() - 5_000;
  await api.post('/admin/settings/discord-bot/test-message').catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  const chosen = requireTextChannel(
    (await findOnlineCardChannel(textChannels, postedAfter)) ?? seed,
    'default notification channel',
  );
  console.log(`  Default channel: ${chosen.id} (#${chosen.name}, type=${chosen.type})`);
  return chosen.id;
}

/** Discover games and test character from the admin's character list. */
async function setupCharacters(api: ApiClient): Promise<{
  mmoGameId: number | undefined;
  testCharId: string | undefined;
  testCharRole: string | undefined;
}> {
  console.log('  Setting up characters...');
  const charsRes = await api.get<{ data: { id: string; gameId: number; role: string }[] }>(
    '/users/me/characters',
  ).catch(() => ({ data: [] }));
  const chars = Array.isArray(charsRes.data) ? charsRes.data : [];
  let mmoGameId: number | undefined;
  let testCharId: string | undefined;
  let testCharRole: string | undefined;
  if (chars.length > 0) {
    testCharId = chars[0].id;
    mmoGameId = chars[0].gameId;
    testCharRole = chars[0].role;
    console.log(`  Using existing character (gameId=${mmoGameId}, role=${testCharRole})`);
  }
  return { mmoGameId, testCharId, testCharRole };
}

/**
 * Fetch the API's channel lists plus the real Discord channel types.
 * ROK-1507: the API "text" list also contains every voice channel (discord.js
 * `isTextBased()` is true for voice) and carries no `type`, so the union is
 * returned raw and routed later by the type read from the harness guild.
 */
async function discoverChannels(api: ApiClient) {
  const [textRes, voiceRes, guildChannels] = await Promise.all([
    api.get<DiscordChannel[]>('/admin/settings/discord-bot/channels'),
    api.get<DiscordChannel[]>('/admin/settings/discord-bot/voice-channels'),
    getGuild().channels.fetch(),
  ]);
  const raw: DiscordChannel[] = [
    ...(Array.isArray(textRes) ? textRes : []),
    ...(Array.isArray(voiceRes) ? voiceRes : []),
  ];
  return {
    raw,
    typeOf: (id: string): number | undefined => guildChannels.get(id)?.type,
  };
}

/** Log in, reset DB to seed baseline, and fetch the user list. */
async function initApi(): Promise<{
  api: ApiClient;
  testUserId: number;
  allUsers: { id: number; username: string }[];
}> {
  console.log('  Logging in to API...');
  const api = await ApiClient.login(
    SMOKE.apiUrl, SMOKE.adminEmail, SMOKE.adminPassword,
  );
  const testUserId = api.userId;
  console.log(`  Admin user ID: ${testUserId}`);

  // ROK-1469: pin channel reads to the Discord app THIS env runs as. Fleet
  // envs each own a per-slot application, so an unfiltered read can match a
  // sibling env's identical embed. Unresolved id → filtering stays off.
  const botUserId = await resolveApiBotUserId(api);
  setApiBotUserId(botUserId);
  console.log(
    botUserId
      ? `  API bot identity: ${botUserId} (channel reads filtered)`
      : '  API bot identity unresolved — channel reads NOT filtered',
  );

  // ROK-1186: hard reset wipes any leftover test fixtures (orphan events,
  // signups, lineups, characters, voice sessions) and re-runs the demo
  // installer. Replaces the standalone /admin/settings/demo/install call.
  console.log('  Resetting DB to demo seed baseline (ROK-1186)...');
  await resetToSeed(api);

  console.log('  Fetching demo users...');
  const usersRes = await api.get<{ data: { id: number; username: string }[] }>(
    '/users?limit=10&page=1',
  ).catch(() => ({ data: [] }));
  const allUsers = Array.isArray(usersRes.data) ? usersRes.data : [];

  return { api, testUserId, allUsers };
}

/** Derive game list and demo user IDs from setup results. */
function buildDemoData(
  allUsers: { id: number; username: string }[],
  testUserId: number,
  dmRecipientUserId: number,
  mmoGameId: number | undefined,
) {
  const gamesSet = new Set(
    allUsers.length > 0
      ? [mmoGameId].filter((id): id is number => id !== undefined)
      : [],
  );
  const games = [...gamesSet].map((id) => ({ id, name: `Game ${id}` }));
  const demoUserIds = allUsers
    .map((u) => u.id)
    .filter((id) => id !== testUserId && id !== dmRecipientUserId)
    .slice(0, 8);
  console.log(`  ${demoUserIds.length} demo users available for roster tests`);
  return { games, demoUserIds };
}

/** Discover and validate guild channels (throws if none found). */
async function fetchChannels(api: ApiClient) {
  console.log('  Discovering channels...');
  const discovered = await discoverChannels(api);
  // ROK-1507: route by Discord channel TYPE (never name/position) and drop
  // ephemeral ⏰ / smoke-*-ephemeral channels. Skips are logged first so a
  // fleet log shows the orphans being dropped (or an unknown type, if the
  // guild fetch failed — then the pools come out empty and we fail loud).
  const pools = buildChannelPools(discovered.raw, discovered.typeOf);
  for (const s of pools.skipped) {
    console.log(`  Skipping channel ${s.id} "${s.name}" (${s.reason})`);
  }
  // ROK-1469 D5: when SMOKE_CHANNEL_SET names a slot, narrow discovery to
  // that slot's `slot-N-*` channels so two fleet envs in one guild never bind
  // the same channel. selectChannelSet throws on an empty match rather than
  // falling back to the shared list.
  const set = channelSetPrefix();
  const textChannels = selectChannelSet(pools.textChannels, set);
  const voiceChannels = selectChannelSet(pools.voiceChannels, set);
  console.log(
    `  Found ${textChannels.length} text, ${voiceChannels.length} voice channels` +
      (set ? ` (channel set "${set}")` : ''),
  );
  if (textChannels.length === 0) throw new Error('No text channels found');
  if (voiceChannels.length === 0) throw new Error('No voice channels found');
  return { textChannels, voiceChannels };
}

/** Orchestrate all setup steps and build the TestContext. */
export async function setup(): Promise<TestContext> {
  console.log('=== Setup ===');

  const { botDiscordId } = await connectBot();
  const { api, testUserId, allUsers } = await initApi();
  const dmRecipientUserId = await setupDmRecipient(
    api, testUserId, botDiscordId, allUsers,
  );

  const { textChannels, voiceChannels } = await fetchChannels(api);
  const defaultChannelId = await discoverDefaultChannel(api, textChannels);

  // Set default voice channel so Discord Scheduled Events can be created (ROK-944)
  if (voiceChannels.length > 0) {
    console.log(
      `  Setting default voice channel: ${voiceChannels[0].id} (${voiceChannels[0].name})`,
    );
    try {
      await api.put('/admin/settings/discord-bot/voice-channel', {
        channelId: voiceChannels[0].id,
      });
    } catch (err) {
      console.warn(`  (Failed to set default voice channel: ${err})`);
    }
  }

  console.log('  Cleaning up stale Discord scheduled events...');
  await cleanupScheduledEvents(api);

  console.log('  Pausing reconciliation cron...');
  await pauseReconciliation(api);

  console.log('  Disabling scheduled event creation for non-SE tests...');
  await disableScheduledEvents(api);

  const { mmoGameId, testCharId, testCharRole } = await setupCharacters(api);
  const { games, demoUserIds } = buildDemoData(
    allUsers, testUserId, dmRecipientUserId, mmoGameId,
  );

  console.log('  Setting up channel pool...');
  const channelPool = await setupChannelPool(
    api, textChannels, defaultChannelId,
  );

  console.log('  Setup complete.\n');
  return {
    api, config: SMOKE, testUserId,
    testBotDiscordId: botDiscordId,
    defaultChannelId, textChannels, voiceChannels,
    games, mmoGameId, testCharId, testCharRole,
    demoUserIds, dmRecipientUserId, channelPool,
  };
}
