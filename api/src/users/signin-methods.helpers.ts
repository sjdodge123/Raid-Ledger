/**
 * ROK-2371 §3 "Last-method guard" (ruling 3): every way a user can sign in,
 * and the rule that refuses an unlink which would leave none.
 *
 * Methods = a real Discord id (`isLinkedDiscordId` — `local:` / `unlinked:`
 * placeholders do not count) + a Google identity row + a `local_credentials`
 * row. Kept out of users.service.ts (at its line cap).
 */
import { ConflictException, HttpStatus } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SigninMethodsDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { isLinkedDiscordId } from '../guilds/community/discord-guild-member.helpers';

/** The db or a transaction handle — only `select` is needed. */
export type SigninMethodsDb = Pick<PostgresJsDatabase<typeof schema>, 'select'>;

/** A method an unlink endpoint can remove. */
export type UnlinkableSigninMethod = 'discord' | 'google';

export const LAST_SIGNIN_METHOD_CODE = 'LAST_SIGNIN_METHOD';
export const LAST_SIGNIN_METHOD_MESSAGE = 'Add another way to sign in first';

/**
 * Spec header ruling 10 (supersedes the §3 "exception kept" draft): unlinking
 * Discord when it is the user's last sign-in method is refused too, so a
 * Discord-only user gets the same 409 as any other last method.
 */
export const DISCORD_ONLY_MAY_UNLINK = false;

function findGoogleIdentity(db: SigninMethodsDb, userId: number) {
  return db
    .select({
      email: schema.userAuthIdentities.email,
      createdAt: schema.userAuthIdentities.createdAt,
    })
    .from(schema.userAuthIdentities)
    .where(
      and(
        eq(schema.userAuthIdentities.userId, userId),
        eq(schema.userAuthIdentities.provider, 'google'),
      ),
    )
    .limit(1);
}

function findLocalCredential(db: SigninMethodsDb, userId: number) {
  return db
    .select({ id: schema.localCredentials.id })
    .from(schema.localCredentials)
    .where(eq(schema.localCredentials.userId, userId))
    .limit(1);
}

/** Read the owner's sign-in methods (`GET /auth/me` `signinMethods`). */
export async function getSigninMethods(
  db: SigninMethodsDb,
  user: { id: number; discordId: string | null },
): Promise<SigninMethodsDto> {
  const [google, password] = await Promise.all([
    findGoogleIdentity(db, user.id),
    findLocalCredential(db, user.id),
  ]);
  const row = google[0];
  return {
    discord: isLinkedDiscordId(user.discordId),
    google: row
      ? { email: row.email, linkedAt: row.createdAt.toISOString() }
      : null,
    password: password.length > 0,
  };
}

/** How many ways the user can sign in. */
export function countSigninMethods(m: SigninMethodsDto): number {
  return [m.discord, m.google !== null, m.password].filter(Boolean).length;
}

function hasMethod(m: SigninMethodsDto, method: UnlinkableSigninMethod) {
  return method === 'discord' ? m.discord : m.google !== null;
}

/**
 * True when removing `method` would leave no way to sign in. Removing a
 * method the user does not have never trips it (the unlink is a no-op).
 */
export function wouldLeaveNoSigninMethod(
  m: SigninMethodsDto,
  method: UnlinkableSigninMethod,
): boolean {
  if (!hasMethod(m, method)) return false;
  if (countSigninMethods(m) > 1) return false;
  return !(method === 'discord' && DISCORD_ONLY_MAY_UNLINK);
}

/** Throw 409 `{code:'LAST_SIGNIN_METHOD'}` when the unlink would lock out. */
export function assertCanUnlink(
  m: SigninMethodsDto,
  method: UnlinkableSigninMethod,
): void {
  if (!wouldLeaveNoSigninMethod(m, method)) return;
  throw new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    code: LAST_SIGNIN_METHOD_CODE,
    message: LAST_SIGNIN_METHOD_MESSAGE,
  });
}
