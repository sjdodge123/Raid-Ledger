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
import { readLastMessages } from '../helpers/messages.js';
import { ApiClient } from './api.js';
import { SMOKE } from './config.js';
import { linkDiscord } from './fixtures.js';
import type { SmokeTest, TestContext, TestResult, DiscordChannel } from './types.js';
import { channelEmbedTests } from './tests/channel-embeds.test.js';
import { dmNotificationTests } from './tests/dm-notifications.test.js';
import { voiceActivityTests } from './tests/voice-activity.test.js';
import { interactionFlowTests } from './tests/interaction-flows.test.js';
import { rosterCalculationTests } from './tests/roster-calculation.test.js';
import { pushContentTests } from './tests/push-content.test.js';
import { slashCommandTests } from './tests/slash-commands.test.js';
import { cdpSlashCommandTests } from './tests/cdp-slash-commands.test.js';

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

/** Ensure a default notification channel is configured, then discover it. */
async function discoverDefaultChannel(
  api: ApiClient,
  textChannels: DiscordChannel[],
): Promise<string> {
  console.log('  Discovering default notification channel...');
  // Ensure a default channel is set (CI starts with fresh DB)
  await api.put(
    '/admin/settings/discord-bot/channel',
    { channelId: textChannels[0].id },
  ).catch(() => {});
  // Send a test message to confirm it works
  await api.post('/admin/settings/discord-bot/test-message').catch(() => {});
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
  return defaultChannelId;
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

/** Orchestrate all setup steps and build the TestContext. */
async function setup(): Promise<TestContext> {
  console.log('=== Setup ===');

  const { botDiscordId } = await connectBot();

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

  console.log('  Fetching demo users...');
  const usersRes = await api.get<{ data: { id: number; username: string }[] }>(
    '/users?limit=10&page=1',
  ).catch(() => ({ data: [] }));
  const allUsers = Array.isArray(usersRes.data) ? usersRes.data : [];

  const dmRecipientUserId = await setupDmRecipient(
    api, testUserId, botDiscordId, allUsers,
  );

  console.log('  Discovering channels...');
  const { textChannels, voiceChannels } = await discoverChannels(api);
  console.log(
    `  Found ${textChannels.length} text, ${voiceChannels.length} voice channels`,
  );
  if (textChannels.length === 0) throw new Error('No text channels found');
  if (voiceChannels.length === 0) throw new Error('No voice channels found');

  const defaultChannelId = await discoverDefaultChannel(api, textChannels);
  const { mmoGameId, testCharId, testCharRole } = await setupCharacters(api);

  const gamesSet = new Set(
    allUsers.length > 0 ? [mmoGameId].filter((id): id is number => id !== undefined) : [],
  );
  const games = [...gamesSet].map((id) => ({ id, name: `Game ${id}` }));

  const demoUserIds = allUsers
    .map((u) => u.id)
    .filter((id) => id !== testUserId && id !== dmRecipientUserId)
    .slice(0, 8);
  console.log(`  ${demoUserIds.length} demo users available for roster tests`);

  console.log('  Setup complete.\n');
  return {
    api,
    config: SMOKE,
    testUserId,
    testBotDiscordId: botDiscordId,
    defaultChannelId,
    textChannels,
    voiceChannels,
    games,
    mmoGameId,
    testCharId,
    testCharRole,
    demoUserIds,
    dmRecipientUserId,
  };
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

function report(results: TestResult[]): number {
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

/** Run tasks with a concurrency limit (simple semaphore). */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const ctx = await setup();

  const filterCat = process.env.SMOKE_CATEGORY;
  const allTests: SmokeTest[] = [
    ...channelEmbedTests,
    ...pushContentTests,
    ...rosterCalculationTests,
    ...dmNotificationTests,
    ...voiceActivityTests,
    ...interactionFlowTests,
    ...slashCommandTests,
    ...cdpSlashCommandTests,
  ].filter((t) => !filterCat || t.category === filterCat);

  const voiceTests = allTests.filter((t) => t.category === 'voice');
  const parallelTests = allTests.filter((t) => t.category !== 'voice');

  const concurrency = SMOKE.concurrency;
  console.log(
    `=== Running ${parallelTests.length} tests (concurrency=${concurrency})` +
      `${voiceTests.length ? `, ${voiceTests.length} voice tests sequentially` : ''} ===\n`,
  );

  const parallelResults = await runWithConcurrency(
    parallelTests,
    (t) => runTest(t, ctx),
    concurrency,
  );

  const voiceResults: TestResult[] = [];
  for (const t of voiceTests) {
    voiceResults.push(await runTest(t, ctx));
  }

  const results = [...parallelResults, ...voiceResults];
  const failCount = report(results);

  console.log('\n=== Teardown ===');
  await disconnect();
  console.log('  Done.');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
