import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const BOT_TOKEN = required('TEST_BOT_TOKEN');
export const GUILD_ID = required('TEST_GUILD_ID');
export const TEXT_CHANNEL_ID = process.env.TEST_TEXT_CHANNEL_ID ?? '';
export const VOICE_CHANNEL_ID = process.env.TEST_VOICE_CHANNEL_ID ?? '';
