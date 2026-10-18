/**
 * Pure helpers for `POST /admin/test/intent-token` (ROK-1841).
 *
 * Body parsing and join-URL construction live here so the controller stays a
 * thin wire and the rules are unit-testable without Nest.
 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * The intents the Discord bot actually mints. `IntentTokenPayloadSchema`
 * (`packages/contract/src/signups.schema.ts`) pins `action` to the literal
 * `'signup'`, so that is the whole set today — widen BOTH together.
 */
export const SUPPORTED_INTENTS = ['signup'] as const;
export type SupportedIntent = (typeof SUPPORTED_INTENTS)[number];

/** Mirrors `IntentTokenService`'s `INTENT_TOKEN_TTL` (15 minutes). */
export const INTENT_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Discord id stamped into the token when the caller names no user. The redeem
 * path only rejects on a mismatch when the signed-in user HAS a `discordId`,
 * so this value lets a Discord-less fixture user redeem the token.
 */
export const PLACEHOLDER_DISCORD_ID = 'demo-test-intent-token';

export interface IntentTokenRequest {
  eventId: number;
  intent: SupportedIntent;
  userId: number | null;
}

export interface IntentTokenResponse {
  token: string;
  url: string;
  eventId: number;
  intent: SupportedIntent;
  discordId: string;
  expiresInSeconds: number;
}

/**
 * The request body. `userId` may be omitted or `null` (placeholder discord id).
 * Zod narrows the unknown body — no cast (Codex r1 P3).
 */
const IntentTokenBodySchema = z.object({
  eventId: z.number().int().positive(),
  intent: z.enum(SUPPORTED_INTENTS),
  userId: z.number().int().positive().nullish(),
});

/** Validate the body: a real eventId, a known intent, an optional userId. */
export function parseIntentTokenBody(body: unknown): IntentTokenRequest {
  const parsed = IntentTokenBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || 'body';
    const detail =
      field === 'intent'
        ? `intent must be one of: ${SUPPORTED_INTENTS.join(', ')}`
        : `${field} must be a positive integer`;
    throw new BadRequestException(detail);
  }
  const { eventId, intent, userId } = parsed.data;
  return { eventId, intent, userId: userId ?? null };
}

/**
 * The exact URL shape the bot's `buildOnboardingRow` puts behind
 * "Join & Sign Up" (`discord-bot/listeners/signup-status.handlers.ts`).
 */
export function buildJoinUrl(
  clientUrl: string,
  eventId: number,
  intent: SupportedIntent,
  token: string,
): string {
  const base = clientUrl.replace(/\/+$/, '');
  return `${base}/join?intent=${intent}&eventId=${eventId}&token=${encodeURIComponent(token)}`;
}
