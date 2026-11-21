/**
 * ROK-2283: pure helpers for the Discord `/login` sign-in links.
 *
 * Two link kinds come out of the command: an existing member gets an ordinary
 * magic link carrying `src:'cmd'`, a first-time member gets a `discord-signin`
 * purpose token that creates the account when it is redeemed. Both redeem as a
 * Discord sign-in (AUTH_EVENTS.DISCORD_LOGIN).
 */

/** The `src` claim a link minted by the `/login` command carries. */
export const COMMAND_LINK_SRC = 'cmd' as const;
export type CommandLinkSrc = typeof COMMAND_LINK_SRC;

/** Path of the web's tap-to-continue landing page. */
export const SIGNIN_LINK_PATH = '/signin-link';

/** Link lifetime (Q5: 15 minutes, same as every magic link). */
export const SIGNIN_LINK_TTL = '15m' as const;

/** Discord user ids are snowflakes: 17-20 decimal digits today. */
const SNOWFLAKE = /^\d{15,25}$/;

/** True for a real Discord id — not null, `unlinked:<id>` or a local stand-in. */
export function isDiscordSnowflake(
  id: string | null | undefined,
): id is string {
  return typeof id === 'string' && SNOWFLAKE.test(id);
}

/** The claims a first-time member's sign-in token carries. */
export interface DiscordSigninClaims {
  discordId: string;
  username: string;
  avatar: string | null;
}

/** Read the claims off a verified `discord-signin` payload, or null. */
export function parseDiscordSigninClaims(
  payload: Record<string, unknown>,
): DiscordSigninClaims | null {
  const { discordId, username, avatar, signin, src, iat } = payload;
  if (signin !== true || src !== COMMAND_LINK_SRC) return null;
  if (typeof iat !== 'number' || !isDiscordSnowflake(discordId as string)) {
    return null;
  }
  if (typeof username !== 'string' || username.length === 0) return null;
  if (avatar !== null && typeof avatar !== 'string') return null;
  return { discordId: discordId as string, username, avatar };
}

/** `<clientUrl><path>#token=<token>` — the fragment never reaches a server. */
export function buildFragmentLink(
  clientUrl: string,
  path: string,
  token: string,
): string {
  const url = new URL(path, clientUrl);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}
