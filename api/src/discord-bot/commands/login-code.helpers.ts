/**
 * ROK-2370: `/login code:<code>` — the member approves a sign-in code shown
 * on the web login page. The command replies privately with a confirm card;
 * the "Yes, sign me in" button mints the same token `/login` mints and parks
 * it on the code, which the waiting browser tab then collects by polling.
 * The command class only wires services into {@link SigninCodeDeps}.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type {
  PendingSigninCode,
  SigninCodeApproval,
} from '../../auth/signin-code.store';
import { normaliseSigninCode } from '../../auth/signin-code.helpers';
import type { DiscordSigninMintInput } from '../../auth/discord-signin-link.service';
import { COMMAND_LINK_SRC } from '../../auth/discord-signin-link.helpers';
import {
  LOGIN_FAILED_COPY,
  checkFixedWindowLimit,
  rateLimitedCopy,
  refusalCopy,
  type LoginDecision,
  type LoginRateLimitRedis,
  type LoginRateLimitResult,
} from './login.helpers';

/** Spec: 5 code attempts per member per 10 minutes (refusals + bad codes count). */
export const SIGNIN_CODE_ATTEMPT_MAX = 5;
export const SIGNIN_CODE_ATTEMPT_WINDOW_SECONDS = 10 * 60;

export const SIGNIN_CODE_APPROVE_PREFIX = 'signin-code:approve:';
export const SIGNIN_CODE_APPROVE_LABEL = 'Yes, sign me in';

/** One copy for unknown AND expired codes (no oracle). */
export const SIGNIN_CODE_INVALID_COPY =
  "That code isn't valid or has expired. Start again on the sign-in page.";

/** Redis key of a member's code-attempt counter. */
export function signinCodeAttemptKey(discordId: string): string {
  return `signin-code:rl:${discordId}`;
}

/** The confirm button's custom id for `code` (canonical `XXXX-XXXX`). */
export function signinCodeApproveId(code: string): string {
  return `${SIGNIN_CODE_APPROVE_PREFIX}${code}`;
}

/** The canonical code in a confirm button's custom id, or null. */
export function parseSigninCodeApproveId(customId: string): string | null {
  if (!customId.startsWith(SIGNIN_CODE_APPROVE_PREFIX)) return null;
  return normaliseSigninCode(customId.slice(SIGNIN_CODE_APPROVE_PREFIX.length));
}

/** The confirm card, with the phishing warning (RFC 8628 §5.4 class). */
export function signinCodeConfirmCopy(code: string, name: string): string {
  return (
    `Sign in the browser showing code **${code}** as **${name}**? ` +
    'Only continue if you started this yourself, just now.'
  );
}

/** The card once approved — generic "browser" wording, no link. */
export function signinCodeDoneCopy(name: string): string {
  return `Done — go back to your browser. You're signed in as ${name}.`;
}

/** The single "Yes, sign me in" button row. */
export function buildSigninCodeConfirmRow(
  code: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Primary)
      .setLabel(SIGNIN_CODE_APPROVE_LABEL)
      .setCustomId(signinCodeApproveId(code)),
  );
}

/** Count one `/login code:` attempt; the 6th inside 10 minutes is refused. */
export function checkSigninCodeAttempts(
  redis: LoginRateLimitRedis,
  discordId: string,
): Promise<LoginRateLimitResult> {
  return checkFixedWindowLimit(
    redis,
    signinCodeAttemptKey(discordId),
    SIGNIN_CODE_ATTEMPT_MAX,
    SIGNIN_CODE_ATTEMPT_WINDOW_SECONDS,
  );
}

/** The Discord user behind the interaction (Discord-signed identity). */
export interface SigninCodeUser {
  id: string;
  username: string;
  avatar?: string | null;
}

/** A granted decision — the only ones that mint. */
export type LoginGrant = Extract<
  LoginDecision,
  { kind: 'existing' | 'first-time' }
>;

/** `/login`'s eligibility for one caller, plus the name the card shows. */
export interface SigninCodeEligibility {
  decision: LoginDecision;
  communityName: string | null;
  /** The Raid Ledger username (existing) or the Discord username (first-time). */
  displayName: string;
}

/** The private reply as the flows edit it. */
export interface SigninCodeReply {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** The deferred interaction the flows answer. */
export interface SigninCodeReplyTarget {
  user: SigninCodeUser;
  editReply(reply: SigninCodeReply): Promise<unknown>;
}

/** Services the flows need; wired by `LoginCommand`. */
export interface SigninCodeDeps {
  redis: LoginRateLimitRedis;
  store: {
    findPending(code: string): Promise<PendingSigninCode | null>;
    approve(code: string, approval: SigninCodeApproval): Promise<boolean>;
  };
  decide(user: SigninCodeUser): Promise<SigninCodeEligibility>;
  mint(
    grant: LoginGrant,
    user: SigninCodeUser,
    displayName: string,
  ): Promise<SigninCodeApproval | null>;
}

/** True when the decision lets the caller sign in. */
function isGrant(decision: LoginDecision): decision is LoginGrant {
  return decision.kind === 'existing' || decision.kind === 'first-time';
}

/** The first-time token claims for the caller (same as a `/login` link). */
export function firstTimeMintInput(
  grant: Extract<LoginDecision, { kind: 'first-time' }>,
  user: SigninCodeUser,
): DiscordSigninMintInput {
  return {
    discordId: user.id,
    username: user.username,
    avatar: user.avatar ?? null,
    src: COMMAND_LINK_SRC,
    ...(grant.rebind ? { rebind: grant.rebind } : {}),
  };
}

/**
 * `/login code:<typed>`: attempt limit → `/login`'s refusals → code lookup →
 * the confirm card. Refusals and bad codes count against the limit.
 */
export async function replyToSigninCode(
  interaction: SigninCodeReplyTarget,
  typed: string,
  deps: SigninCodeDeps,
): Promise<void> {
  const reply = (
    content: string,
    components: SigninCodeReply['components'] = [],
  ) => interaction.editReply({ content, components });
  const limit = await checkSigninCodeAttempts(deps.redis, interaction.user.id);
  if (!limit.allowed)
    return void (await reply(rateLimitedCopy(limit.retryMinutes)));
  const { decision, communityName, displayName } = await deps.decide(
    interaction.user,
  );
  if (!isGrant(decision)) {
    return void (await reply(refusalCopy(decision, communityName)));
  }
  const code = normaliseSigninCode(typed);
  const pending = code ? await deps.store.findPending(code) : null;
  if (!pending) return void (await reply(SIGNIN_CODE_INVALID_COPY));
  await reply(signinCodeConfirmCopy(pending.code, displayName), [
    buildSigninCodeConfirmRow(pending.code),
  ]);
}

/**
 * "Yes, sign me in": re-runs `/login`'s refusals for the clicking member,
 * re-checks the code, mints, approves once and replaces the card. Returns the
 * approval when it landed (for the audit log), else null.
 */
export async function approveSigninCode(
  interaction: SigninCodeReplyTarget,
  code: string,
  deps: SigninCodeDeps,
): Promise<SigninCodeApproval | null> {
  const reply = (content: string) =>
    interaction.editReply({ content, components: [] });
  const { decision, communityName, displayName } = await deps.decide(
    interaction.user,
  );
  if (!isGrant(decision)) {
    await reply(refusalCopy(decision, communityName));
    return null;
  }
  if (!(await deps.store.findPending(code))) {
    await reply(SIGNIN_CODE_INVALID_COPY);
    return null;
  }
  const approval = await deps.mint(decision, interaction.user, displayName);
  if (!approval) {
    await reply(LOGIN_FAILED_COPY);
    return null;
  }
  const approved = await deps.store.approve(code, approval);
  await reply(
    approved ? signinCodeDoneCopy(displayName) : SIGNIN_CODE_INVALID_COPY,
  );
  return approved ? approval : null;
}
