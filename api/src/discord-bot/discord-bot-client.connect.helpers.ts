import type { Logger } from '@nestjs/common';
import type { Client } from 'discord.js';
import {
  friendlyConnectErrorMessage,
  friendlyDiscordErrorMessage,
} from './discord-bot.constants';
import { warnIfMultipleGuilds } from './discord-bot-client.helpers';
import {
  DiscordConnectError,
  abandonStaleReadyClient,
  describeRawLoginError,
  destroyClientSafely,
  discardStaleClient,
  isDefinitiveConnectError,
} from './discord-bot-client.login.helpers';

const SUPERSEDED_MESSAGE = 'Discord client was replaced before it became ready';
const SUPERSEDED_CONNECT_MESSAGE =
  'Discord connect was superseded by a newer connect or disconnect';

/** A connect call that lost ownership before it built its client (ROK-2198). */
export function supersededConnectError(): DiscordConnectError {
  return new DiscordConnectError(SUPERSEDED_CONNECT_MESSAGE, false);
}

/** What the connect handlers need from DiscordBotClientService. */
export interface ConnectHooks {
  readonly logger: Logger;
  /** True while `client` is still the service's live client. */
  isLive(client: Client): boolean;
  /** Clear the connect timer and the connecting flag. */
  settle(): void;
  /** Forget `client` as the live client (only if it still is). */
  dropClient(client: Client): void;
  emitConnected(): Promise<void>;
  emitError(error: Error): void;
}

export interface ConnectSettlers {
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Wire ready / error / login for one connect attempt (ROK-2198). Every
 * handler checks the client is still live first: a stale client is
 * destroyed and never logged as connected or announced to listeners.
 */
export function wireConnectHandlers(
  client: Client,
  token: string,
  hooks: ConnectHooks,
  settlers: ConnectSettlers,
): void {
  let loginFailed = false;
  client.once('clientReady', () => onReady(client, hooks, settlers));
  client.once('error', (error: Error) =>
    onError(client, error, hooks, settlers.reject, loginFailed),
  );
  client.login(token).catch((err: unknown) => {
    loginFailed = true;
    void onLoginFailure(client, token, err, hooks, settlers.reject);
  });
}

function onReady(
  client: Client,
  hooks: ConnectHooks,
  { resolve, reject }: ConnectSettlers,
): void {
  if (!hooks.isLive(client)) {
    void abandonStaleReadyClient(client, hooks.logger);
    reject(new DiscordConnectError(SUPERSEDED_MESSAGE, false));
    return;
  }
  hooks.settle();
  hooks.logger.log(`Discord bot connected as ${client.user?.tag}`);
  warnIfMultipleGuilds(hooks.logger, client.guilds.cache.size);
  hooks.emitConnected().then(resolve, resolve);
}

function onError(
  client: Client,
  error: Error,
  hooks: ConnectHooks,
  reject: (err: Error) => void,
  afterLoginFailure: boolean,
): void {
  const message = friendlyDiscordErrorMessage(error);
  const definitive = isDefinitiveConnectError(error);
  if (!hooks.isLive(client)) {
    void discardStaleClient(client, hooks.logger, 'error', afterLoginFailure);
    reject(new DiscordConnectError(message, definitive));
    return;
  }
  hooks.settle();
  hooks.logger.error('Discord bot connection error:', message);
  hooks.emitError(error);
  reject(new DiscordConnectError(message, definitive));
}

/** A failed login destroys its client so discord.js cannot revive it. */
async function onLoginFailure(
  client: Client,
  token: string,
  err: unknown,
  hooks: ConnectHooks,
  reject: (err: Error) => void,
): Promise<void> {
  hooks.dropClient(client);
  hooks.logger.error(
    `Discord bot login error (raw): ${describeRawLoginError(err, token)}`,
  );
  await destroyClientSafely(client, hooks.logger);
  // ROK-1703: a 4014 names the intents that are actually off.
  // The .catch keeps connect() from hanging if the lookup ever throws.
  const message = await friendlyConnectErrorMessage(err, token).catch(() =>
    friendlyDiscordErrorMessage(err),
  );
  hooks.logger.error('Discord bot login failed:', message);
  reject(new DiscordConnectError(message, isDefinitiveConnectError(err)));
}
