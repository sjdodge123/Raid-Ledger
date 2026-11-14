import type { Logger } from '@nestjs/common';
import { isDefinitiveConnectError } from './discord-bot-client.login.helpers';

/** ROK-2198: startup auto-connect tries this many times in total. */
export const AUTO_CONNECT_MAX_ATTEMPTS = 3;
/** First retry waits this long; each later retry doubles it (2 s, 4 s). */
export const AUTO_CONNECT_BASE_DELAY_MS = 2_000;

export type DelayFn = (ms: number) => Promise<void>;

export const realDelay: DelayFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface AutoConnectOptions {
  connect: () => Promise<void>;
  /** False once something else (an admin reconnect) owns the connection. */
  shouldRetry: () => boolean;
  logger: Logger;
  delay?: DelayFn;
  maxAttempts?: number;
  baseDelayMs?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Connect, retrying a transient failure with exponential backoff. A
 * definitive failure (invalid token, disallowed intents) and the last
 * attempt's failure are rethrown; a retry is skipped when `shouldRetry`
 * says another connect already took over.
 */
export async function connectWithRetry(
  opts: AutoConnectOptions,
): Promise<void> {
  const max = opts.maxAttempts ?? AUTO_CONNECT_MAX_ATTEMPTS;
  const base = opts.baseDelayMs ?? AUTO_CONNECT_BASE_DELAY_MS;
  const delay = opts.delay ?? realDelay;
  for (let attempt = 1; ; attempt++) {
    try {
      await opts.connect();
      return;
    } catch (error) {
      if (isDefinitiveConnectError(error) || attempt >= max) throw error;
      const waitMs = base * 2 ** (attempt - 1);
      opts.logger.warn(
        `Discord bot auto-connect attempt ${attempt}/${max} failed (${messageOf(error)}); retrying in ${waitMs}ms`,
      );
      await delay(waitMs);
      if (!opts.shouldRetry()) return;
    }
  }
}
