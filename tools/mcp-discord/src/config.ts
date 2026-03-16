import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

export const CDP_PORT = parseInt(process.env.DISCORD_CDP_PORT ?? '9222', 10);
export const CDP_URL = `http://localhost:${CDP_PORT}`;
export const DISCORD_MODE = (process.env.DISCORD_MODE ?? 'electron') as
  | 'electron'
  | 'browser';
