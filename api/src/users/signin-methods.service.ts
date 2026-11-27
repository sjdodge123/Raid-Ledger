/**
 * ROK-2371: sign-in methods read + the two guarded unlinks (spec §3).
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SigninMethodsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { UsersService } from './users.service';
import { assertCanUnlink, getSigninMethods } from './signin-methods.helpers';

@Injectable()
export class SigninMethodsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly usersService: UsersService,
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
      const [user] = await tx
        .select({ id: schema.users.id, discordId: schema.users.discordId })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .for('update');
      if (!user) throw new UnauthorizedException('User no longer exists');
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
   * `DELETE /users/me/discord`: the guard, then today's unlink
   * (`unlinked:<id>`). A Discord-only user is refused like any last method
   * (`DISCORD_ONLY_MAY_UNLINK`, ruling 10).
   */
  async unlinkDiscord(userId: number): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User no longer exists');
    assertCanUnlink(await getSigninMethods(this.db, user), 'discord');
    await this.usersService.unlinkDiscord(userId);
  }
}
