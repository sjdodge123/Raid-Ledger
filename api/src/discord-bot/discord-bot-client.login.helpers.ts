import type { Logger } from '@nestjs/common';
import type { Client } from 'discord.js';
import { isDisallowedIntentError } from './discord-bot.constants';

/**
 * ROK-2198: a connect() failure that remembers whether retrying can help.
 * `definitive` is true for an invalid token (gateway close 4004) or disallowed
 * intents (4014) — a retry with the same config will fail the same way.
 */
export class DiscordConnectError extends Error {
  constructor(
    message: string,
    readonly definitive: boolean,
  ) {
    super(message);
    this.name = 'DiscordConnectError';
  }
}

function errorCode(error: Error): unknown {
  return (error as Error & { code?: unknown }).code;
}

function codeText(code: unknown): string {
  return typeof code === 'string' || typeof code === 'number'
    ? String(code)
    : 'none';
}

/** True when retrying the same token/intents cannot succeed. */
export function isDefinitiveConnectError(error: unknown): boolean {
  if (error instanceof DiscordConnectError) return error.definitive;
  if (!(error instanceof Error)) return false;
  if (isDisallowedIntentError(error)) return true;
  const code = errorCode(error);
  if (code === 4004 || code === 'TokenInvalid') return true;
  return /invalid token|TOKEN_INVALID|authentication failed/i.test(
    error.message,
  );
}

/**
 * The raw login error as `name / code / message`, with every occurrence of
 * the token redacted — the friendly message alone hid the real cause on prod.
 */
export function describeRawLoginError(error: unknown, token: string): string {
  const raw =
    error instanceof Error
      ? `name=${error.name} code=${codeText(errorCode(error))} message=${error.message}`
      : `non-Error rejection: ${String(error)}`;
  return token ? raw.split(token).join('[redacted]') : raw;
}

/** Destroy a client; a throw (sync or async) from destroy is logged, never escapes. */
export async function destroyClientSafely(
  client: Client,
  logger: Logger,
): Promise<void> {
  try {
    await client.destroy();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Destroying a discarded Discord client failed: ${message}`);
  }
}

/**
 * ROK-2198: an event arrived from a client that is no longer the live one
 * (its login already failed, or a newer connect replaced it). discord.js keeps
 * retrying internally, so it must be destroyed or it lingers as a zombie.
 */
export async function discardStaleClient(
  client: Client,
  logger: Logger,
  event: string,
): Promise<void> {
  logger.warn(
    `Discarding stale Discord client (${event}) — it is no longer the live client`,
  );
  await destroyClientSafely(client, logger);
}
