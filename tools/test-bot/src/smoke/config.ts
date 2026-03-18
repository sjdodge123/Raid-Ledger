import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../..', '.env') });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const SMOKE = {
  apiUrl: process.env.API_URL ?? 'http://localhost:3000',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@local',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'password',
  guildId: required('TEST_GUILD_ID'),
  // 60s: polling with backoff exhausts unique intervals in ~14s, so 60s
  // gives 5+ full cycles at the 8s cap — enough for slow embed edits
  timeoutMs: parseInt(process.env.SMOKE_TIMEOUT_MS ?? '60000', 10),
  // 5 concurrent: keeps embed sync queue pressure manageable on Discord
  concurrency: parseInt(process.env.SMOKE_CONCURRENCY ?? '5', 10),
};
