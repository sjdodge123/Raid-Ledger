#!/usr/bin/env npx tsx
/**
 * Discord smoke test runner.
 *
 * Usage: npx tsx src/smoke/run.ts
 *
 * Connects the companion bot, auto-discovers channels/games from the API,
 * sets up fixtures, runs all smoke tests in parallel, then cleans up.
 */
import { connect, disconnect, getClient } from '../client.js';
import { ApiClient } from './api.js';
import { SMOKE } from './config.js';
import { linkDiscord, deleteBinding } from './fixtures.js';
import type { SmokeTest, TestContext, TestResult, DiscordChannel } from './types.js';
import { channelEmbedTests } from './tests/channel-embeds.test.js';
import { dmNotificationTests } from './tests/dm-notifications.test.js';
import { voiceActivityTests } from './tests/voice-activity.test.js';
import { interactionFlowTests } from './tests/interaction-flows.test.js';
import { rosterCalculationTests } from './tests/roster-calculation.test.js';

async function discoverChannels(api: ApiClient) {
  const [textRes, voiceRes] = await Promise.all([
    api.get<DiscordChannel[]>('/admin/settings/discord-bot/channels'),
    api.get<DiscordChannel[]>('/admin/settings/discord-bot/voice-channels'),
  ]);
  return {
    textChannels: Array.isArray(textRes) ? textRes : [],
    voiceChannels: Array.isArray(voiceRes) ? voiceRes : [],
  };
}

async function setup(): Promise<{
  ctx: TestContext;
  cleanupBindingIds: string[];
}> {
  console.log('=== Setup ===');

  console.log('  Connecting companion bot...');
  await connect();
  // Many tests listen for messages in parallel — raise the limit
  getClient().setMaxListeners(30);
  const botDiscordId = getClient().user!.id;
  console.log(`  Bot connected (Discord ID: ${botDiscordId})`);

  console.log('  Logging in to API...');
  const api = await ApiClient.login(
    SMOKE.apiUrl,
    SMOKE.adminEmail,
    SMOKE.adminPassword,
  );

  const testUserId = api.userId;
  console.log(`  Admin user ID: ${testUserId}`);

  console.log('  Installing demo data...');
  await api.post('/admin/settings/demo/install').catch(() => {
    console.log('  (demo data already exists)');
  });

  console.log('  Linking test bot Discord ID to admin user...');
  await linkDiscord(api, testUserId, botDiscordId, 'SmokeTestBot');

  // RL bot user ID not exposed by API — companion bot can discover it
  // by looking at who sent messages in guild channels. Use 'unknown' as fallback.
  const rlBotDiscordId = 'unknown';
  console.log(`  RL bot Discord ID: ${rlBotDiscordId} (discovered at runtime)`);

  console.log('  Discovering channels...');
  const { textChannels, voiceChannels } = await discoverChannels(api);
  console.log(
    `  Found ${textChannels.length} text, ${voiceChannels.length} voice channels`,
  );

  if (textChannels.length === 0) throw new Error('No text channels found');
  if (voiceChannels.length === 0) throw new Error('No voice channels found');

  // Discover default notification channel by sending a test message
  console.log('  Discovering default notification channel...');
  const { readLastMessages } = await import('../helpers/messages.js');
  await api.post('/admin/settings/discord-bot/test-message');
  await new Promise((r) => setTimeout(r, 3000));
  let defaultChannelId = textChannels[0].id;
  for (const ch of textChannels) {
    try {
      const msgs = await readLastMessages(ch.id, 1);
      if (msgs.some((m) => m.embeds.some((e) => e.title === 'Online'
        || e.title?.includes('Online')))) {
        defaultChannelId = ch.id;
        break;
      }
    } catch { /* skip */ }
  }
  console.log(`  Default channel: ${defaultChannelId}`);

  // Discover games and ensure test character exists
  console.log('  Setting up characters...');
  const charsRes = await api.get<{ data: { id: string; gameId: number; role: string }[] }>(
    '/users/me/characters',
  ).catch(() => ({ data: [] }));
  const chars = Array.isArray(charsRes.data) ? charsRes.data : [];
  // Use existing character or create one for MMO testing
  let mmoGameId: number | undefined;
  let testCharId: string | undefined;
  let testCharRole: string | undefined;
  if (chars.length > 0) {
    testCharId = chars[0].id;
    mmoGameId = chars[0].gameId;
    testCharRole = chars[0].role;
    console.log(`  Using existing character (gameId=${mmoGameId}, role=${testCharRole})`);
  }
  // Discover all game IDs from library
  const gamesSet = new Set(chars.map((c) => c.gameId));
  const games = [...gamesSet].map((id) => ({ id, name: `Game ${id}` }));

  // Fetch demo user IDs for multi-user roster tests
  console.log('  Fetching demo users...');
  const usersRes = await api.get<{ data: { id: number }[] }>(
    '/users?limit=10&page=1',
  ).catch(() => ({ data: [] }));
  const allUsers = Array.isArray(usersRes.data) ? usersRes.data : [];
  // Exclude the admin user — use only demo users
  const demoUserIds = allUsers
    .map((u) => u.id)
    .filter((id) => id !== testUserId)
    .slice(0, 8);
  console.log(`  Found ${demoUserIds.length} demo users for roster tests`);

  const ctx: TestContext = {
    api,
    config: SMOKE,
    testUserId,
    testBotDiscordId: botDiscordId,
    rlBotDiscordId,
    defaultChannelId,
    textChannels,
    voiceChannels,
    games,
    mmoGameId,
    testCharId,
    testCharRole,
    demoUserIds,
  };

  console.log('  Setup complete.\n');
  return { ctx, cleanupBindingIds: [] };
}

async function runTest(
  test: SmokeTest,
  ctx: TestContext,
): Promise<TestResult> {
  const start = Date.now();
  try {
    await test.run(ctx);
    return {
      name: test.name,
      category: test.category,
      status: 'PASS',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: test.name,
      category: test.category,
      status: 'FAIL',
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function report(results: TestResult[]) {
  console.log('\n=== Results ===\n');
  const groups = new Map<string, TestResult[]>();
  for (const r of results) {
    const arr = groups.get(r.category) ?? [];
    arr.push(r);
    groups.set(r.category, arr);
  }

  for (const [cat, tests] of groups) {
    console.log(`[${cat}]`);
    for (const t of tests) {
      const icon = t.status === 'PASS' ? 'PASS' : 'FAIL';
      const dur = `${(t.durationMs / 1000).toFixed(1)}s`;
      console.log(`  ${icon}  ${t.name} (${dur})`);
      if (t.error) console.log(`        ${t.error}`);
    }
    console.log();
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`Total: ${pass} passed, ${fail} failed, ${results.length} total`);
  return fail;
}

async function main() {
  const { ctx, cleanupBindingIds } = await setup();

  // Filter by category if SMOKE_CATEGORY env var is set (e.g. "embed", "dm", "voice", "flow")
  const filterCat = process.env.SMOKE_CATEGORY;
  const allTests: SmokeTest[] = [
    ...channelEmbedTests,
    ...rosterCalculationTests,
    ...dmNotificationTests,
    ...voiceActivityTests,
    ...interactionFlowTests,
  ].filter((t) => !filterCat || t.category === filterCat);

  console.log(`=== Running ${allTests.length} tests in parallel ===\n`);

  const results = await Promise.all(
    allTests.map((t) => runTest(t, ctx)),
  );

  const failCount = report(results);

  console.log('\n=== Teardown ===');
  for (const id of cleanupBindingIds) {
    await deleteBinding(ctx.api, id);
  }
  await disconnect();
  console.log('  Done.');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
