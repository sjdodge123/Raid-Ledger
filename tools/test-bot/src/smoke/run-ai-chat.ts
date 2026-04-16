#!/usr/bin/env npx tsx
/**
 * Minimal runner for AI Chat smoke tests only.
 * Used during TDD to confirm all tests fail before implementation.
 */
import { connect, disconnect, getClient } from '../client.js';
import { ApiClient } from './api.js';
import { SMOKE } from './config.js';
import { linkDiscord } from './fixtures.js';
import { aiChatTests } from './tests/ai-chat.test.js';
import type { TestContext } from './types.js';

async function main(): Promise<void> {
  console.log('Connecting bot...');
  await connect();
  const botDiscordId = getClient().user!.id;

  console.log('Logging in...');
  const api = await ApiClient.login(
    SMOKE.apiUrl, SMOKE.adminEmail, SMOKE.adminPassword,
  );

  console.log('Fetching users...');
  const usersRes = await api.get<{
    data: { id: number; username: string }[];
  }>('/users?limit=10&page=1').catch(() => ({ data: [] as { id: number; username: string }[] }));
  const allUsers = Array.isArray(usersRes.data)
    ? usersRes.data : [];
  const testUserId = api.userId;
  const dmRecipient = allUsers.find(
    (u) => u.id !== testUserId,
  );
  const dmRecipientUserId = dmRecipient?.id ?? testUserId;

  await linkDiscord(
    api, dmRecipientUserId, botDiscordId, 'SmokeTestBot',
  );

  const ctx: TestContext = {
    api,
    config: SMOKE,
    testUserId,
    testBotDiscordId: botDiscordId,
    defaultChannelId: '',
    textChannels: [],
    voiceChannels: [],
    games: [],
    demoUserIds: [],
    dmRecipientUserId,
  };

  console.log(`\n=== Running ${aiChatTests.length} AI Chat Tests ===\n`);
  let pass = 0;
  let fail = 0;

  for (const test of aiChatTests) {
    const start = Date.now();
    try {
      await test.run(ctx);
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  PASS  ${test.name} (${dur}s)`);
      pass++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  FAIL  ${test.name} (${dur}s)`);
      console.log(`        ${msg.substring(0, 200)}`);
      fail++;
    }
  }

  console.log(
    `\nTotal: ${pass} passed, ${fail} failed, ${pass + fail} total`,
  );

  await disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
