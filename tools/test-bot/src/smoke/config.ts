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

/** Parse an env var as an integer with a NaN-safe fallback. */
function intOrDefault(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw ?? String(fallback), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const SMOKE = {
  apiUrl: process.env.API_URL ?? 'http://localhost:3000',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@local',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'password',
  guildId: required('TEST_GUILD_ID'),
  timeoutMs: intOrDefault(process.env.SMOKE_TIMEOUT_MS, 60_000),
  concurrency: intOrDefault(process.env.SMOKE_CONCURRENCY, 5),
  retryCount: intOrDefault(process.env.SMOKE_RETRY_COUNT, 0),
};
