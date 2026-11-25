/**
 * ROK-2283: pure helpers for the Discord `/login` command — the decision
 * table, the reply copy per outcome, the per-member Redis rate limit and the
 * link-button row. The command class only wires these to services.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type Redis from 'ioredis';
import {
  isKickExpired,
  kickCooldownMessage,
} from '../../auth/auth-status.helpers';

/** Q5: 3 links per member per 10 minutes. */
export const LOGIN_RATE_LIMIT_MAX = 3;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

/** Redis key of a member's link counter. */
export function loginRateLimitKey(discordId: string): string {
  return `signin-link:rl:${discordId}`;
}

/** The caller as the decision table needs to see them. */
export interface LoginCaller {
  id: number;
  discordId: string | null;
  bannedAt: Date | null;
  kickedAt: Date | null;
  deactivatedAt: Date | null;
  tokenVersion: number;
}

/**
 * The `unlinked:<id>` row a first-time link will relink, pinned at mint time
 * (Codex P2): redeem refuses the link once that row's token version moved.
 */
export interface LoginRebind {
  userId: number;
  tokenVersion: number;
}

export interface LoginDecisionInput {
  clientUrl: string | null;
  caller: LoginCaller | null;
  isGuildMember: boolean;
}

/** What `/login` does for one caller. */
export type LoginDecision =
  | { kind: 'no-client-url' }
  | { kind: 'banned' }
  | { kind: 'kicked'; kickedAt: Date }
  | { kind: 'deactivated' }
  | { kind: 'not-member' }
  | { kind: 'existing'; userId: number; clientUrl: string }
  | { kind: 'first-time'; clientUrl: string; rebind?: LoginRebind };

/** A refusal outcome (every decision that mints no link). */
export type LoginRefusal = Exclude<
  LoginDecision,
  { kind: 'existing' } | { kind: 'first-time' }
>;

/** True when the caller's row is the `unlinked:<id>` placeholder. */
function isUnlinkedRow(caller: LoginCaller): boolean {
  return caller.discordId?.startsWith('unlinked:') ?? false;
}

/**
 * The refusal table, then the branch. Ban and kick are checked on an
 * `unlinked:<id>` row too, so an unlinked banned member is refused up front;
 * an unlinked row otherwise takes the first-time path (redeem relinks it).
 */
export function decideLogin(input: LoginDecisionInput): LoginDecision {
  const { clientUrl, caller } = input;
  if (!clientUrl) return { kind: 'no-client-url' };
  if (caller?.bannedAt) return { kind: 'banned' };
  if (caller?.kickedAt && !isKickExpired(caller.kickedAt)) {
    return { kind: 'kicked', kickedAt: caller.kickedAt };
  }
  if (caller?.deactivatedAt) return { kind: 'deactivated' };
  if (!input.isGuildMember) return { kind: 'not-member' };
  if (!caller) return { kind: 'first-time', clientUrl };
  if (!isUnlinkedRow(caller)) {
    return { kind: 'existing', userId: caller.id, clientUrl };
  }
  const rebind = { userId: caller.id, tokenVersion: caller.tokenVersion };
  return { kind: 'first-time', clientUrl, rebind };
}

/** The community name, or the product name when none is set. */
function community(name: string | null): string {
  return name && name.trim().length > 0 ? name : 'Raid Ledger';
}

/** Private reply copy for a refusal (spec §Security). */
export function refusalCopy(
  refusal: LoginRefusal,
  communityName: string | null,
): string {
  switch (refusal.kind) {
    case 'no-client-url':
      return "Sign-in links aren't available yet — an admin needs to set the site URL first.";
    case 'banned':
      return `You can't sign in to ${community(communityName)}. Contact an admin.`;
    case 'kicked':
      return kickCooldownMessage(refusal.kickedAt);
    case 'deactivated':
      return 'Your account is inactive — rejoin the Discord server, then try again.';
    case 'not-member':
      return `Only members of the ${community(communityName)} Discord server can sign in with /login. Join the server, then try again.`;
  }
}

/** Q4: the success copy, with the "Open in browser" tip. */
export const LINK_REPLY_COPY =
  "Here's your sign-in link. It works once and expires in 15 minutes.\n" +
  'Tip: long-press it and choose **Open in browser** so you stay signed in.';

export const LINK_BUTTON_LABEL = 'Sign in';

/** Copy for the 4th link inside the window. */
export function rateLimitedCopy(retryMinutes: number): string {
  const unit = retryMinutes === 1 ? 'minute' : 'minutes';
  return `You've asked for too many sign-in links. Try again in ${retryMinutes} ${unit}.`;
}

export const LOGIN_FAILED_COPY =
  "Couldn't create a sign-in link. Please try again later.";

/** The single link-button row. */
export function buildLoginLinkRow(
  url: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(LINK_BUTTON_LABEL)
      .setURL(url),
  );
}

export type LoginRateLimitRedis = Pick<Redis, 'incr' | 'expire' | 'ttl'>;

export type LoginRateLimitResult =
  { allowed: true } | { allowed: false; retryMinutes: number };

/**
 * Count one request against a fixed window keyed by `key` (window starts at
 * the first request). Past `max` it is refused with the whole minutes left.
 * A counter that lost its expiry (incr landed, expire did not) is re-armed so
 * it can never lock a member out forever.
 */
export async function checkFixedWindowLimit(
  redis: LoginRateLimitRedis,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<LoginRateLimitResult> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  if (count <= max) return { allowed: true };
  let ttl = await redis.ttl(key);
  if (ttl < 0) {
    await redis.expire(key, windowSeconds);
    ttl = windowSeconds;
  }
  return { allowed: false, retryMinutes: Math.max(1, Math.ceil(ttl / 60)) };
}

/** Count one link request for a member; the 4th inside 10 minutes is refused. */
export async function checkLoginRateLimit(
  redis: LoginRateLimitRedis,
  discordId: string,
): Promise<LoginRateLimitResult> {
  return checkFixedWindowLimit(
    redis,
    loginRateLimitKey(discordId),
    LOGIN_RATE_LIMIT_MAX,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  );
}
