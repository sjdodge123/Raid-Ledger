/**
 * ROK-2371: sign-in methods read + the two guarded unlinks (spec §3).
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SigninMethodsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { invalidateAuthUser } from '../auth/auth-user-cache';
import { isLinkedDiscordId } from '../guilds/community/discord-guild-member.helpers';
import { assertCanUnlink, getSigninMethods } from './signin-methods.helpers';

type Tx = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

/** Lock the user row so concurrent unlinks serialise on the method count. */
async function lockUser(tx: Tx, userId: number) {
  const [user] = await tx
    .select({ id: schema.users.id, discordId: schema.users.discordId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .for('update');
  if (!user) throw new UnauthorizedException('User no longer exists');
  return user;
}

@Injectable()
export class SigninMethodsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** The owner's sign-in methods. */
  forUser(user: {
    id: number;
    discordId: string | null;
  }): Promise<SigninMethodsDto> {
    return getSigninMethods(this.db, user);
  }

  /**
   * `DELETE /users/me/identities/google`. The user row is locked so two
   * concurrent unlinks cannot both pass the count. No identity = no-op.
   */
  async unlinkGoogle(userId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const user = await lockUser(tx, userId);
      assertCanUnlink(await getSigninMethods(tx, user), 'google');
      await tx
        .delete(schema.userAuthIdentities)
        .where(
          and(
            eq(schema.userAuthIdentities.userId, userId),
            eq(schema.userAuthIdentities.provider, 'google'),
          ),
        );
    });
  }

  /**
   * `DELETE /users/me/discord`: today's unlink (`unlinked:<id>`, avatar
   * cleared) behind the guard, in one transaction holding the same row lock
   * as `unlinkGoogle` so the two cannot race to zero methods. A Discord-only
   * user is refused like any last method (ruling 10). No real id = no-op.
   */
  async unlinkDiscord(userId: number): Promise<void> {
    const changed = await this.db.transaction(async (tx) => {
      const user = await lockUser(tx, userId);
      assertCanUnlink(await getSigninMethods(tx, user), 'discord');
      if (!user.discordId || !isLinkedDiscordId(user.discordId)) return false;
      await tx
        .update(schema.users)
        .set({
          discordId: `unlinked:${user.discordId}`,
          avatar: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));
      return true;
    });
    if (changed) invalidateAuthUser(userId);
  }
}
