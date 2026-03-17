import type { ApiClient } from './api.js';
import type { SMOKE } from './config.js';

export interface DiscordChannel {
  id: string;
  name: string;
}

export interface TestContext {
  api: ApiClient;
  config: typeof SMOKE;
  /** Admin user's ID in the DB */
  testUserId: number;
  /** Test bot's Discord user ID (linked to testUserId) */
  testBotDiscordId: string;
  /** Default notification channel (where embeds post) */
  defaultChannelId: string;
  /** All text channels in the guild */
  textChannels: DiscordChannel[];
  /** All voice channels in the guild */
  voiceChannels: DiscordChannel[];
  /** Available games from demo data */
  games: { id: number; name: string }[];
  /** Game ID for MMO roster tests (with slot config) */
  mmoGameId?: number;
  /** Character ID to use for signups */
  testCharId?: string;
  /** Character's role (tank/healer/dps) */
  testCharRole?: string;
  /** Demo user IDs for multi-user roster tests */
  demoUserIds?: number[];
  /** Demo user whose discordId = test bot (receives DMs) */
  dmRecipientUserId: number;
}

export interface SmokeTest {
  name: string;
  category: 'embed' | 'dm' | 'voice' | 'flow';
  run: (ctx: TestContext) => Promise<void>;
}

export interface TestResult {
  name: string;
  category: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  error?: string;
}
