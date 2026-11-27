/**
 * ROK-2371 D1(a), Discord side (spec §4 (a)). While Google sign-in is live:
 * - a Discord sign-in that matches no account (no row, no `unlinked:` row)
 *   is parked for the `/auth/first-time` choice instead of creating a user;
 * - a Discord sign-in started from that page (`action:'pending-link'`)
 *   proves the account a parked GOOGLE identity belongs to, and links it.
 * Toggle off → every hook returns null and today's Discord path runs as-is.
 *
 * Logs only a user id and a reason — never the code, state, tokens,
 * snowflake, Google `sub` or email.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Request, Response } from 'express';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { UsersService } from '../../users/users.service';
import { isInviteCodeFormat } from '../invite-code-format';
import {
  refusalRedirect,
  signinRefusalFor,
} from './google-signin-claims.helpers';
import { GoogleSigninService, type UserRow } from './google-signin.service';
import {
  PendingIdentityStore,
  type PendingIdentity,
} from './pending-identity.store';
import {
  firstTimeUrl,
  isPendingDiscordMarker,
  userIdOf,
  type PendingDiscordMarker,
} from './discord-pending-identity.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const { userAuthIdentities: identities, users } = schema;

export interface DiscordProfileLite {
  id: string;
  username: string;
  avatar: string | null;
}

@Injectable()
export class DiscordPendingIdentityService {
  private readonly logger = new Logger('DiscordPendingIdentity');

  constructor(
    private readonly svc: GoogleSigninService,
    private readonly pending: PendingIdentityStore,
    private readonly usersService: UsersService,
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
  ) {}

  /** Strategy hook: a marker for an unknown snowflake, else null. */
  async markerFor(p: DiscordProfileLite): Promise<PendingDiscordMarker | null> {
    if (!(await this.svc.isEnabled())) return null;
    if (await this.usersService.findByDiscordIdIncludingUnlinked(p.id)) {
      return null;
    }
    return {
      pendingDiscord: {
        provider: 'discord',
        subject: p.id,
        displayName: p.username,
        email: null,
        avatar: p.avatar,
      },
    };
  }

  /** Whether this browser holds a parked Google identity (and it is live). */
  async hasPendingGoogle(req: Request): Promise<boolean> {
    if (!(await this.svc.isEnabled())) return false;
    return (await this.pending.peek(req))?.provider === 'google';
  }

  /**
   * Login-callback hook: the absolute URL to redirect to, or null to run
   * today's sign-in. `state` is the login state passport already verified.
   */
  async route(
    req: Request,
    res: Response,
    base: string,
    state: Record<string, unknown> | null,
  ): Promise<string | null> {
    const action = state?.action;
    if (isPendingDiscordMarker(req.user)) {
      if (action === 'pending-link') {
        this.logger.log('discord pending-link refused reason=not_found');
        return `${base}/auth/first-time?error=not_found`;
      }
      const invite = state?.inviteCode;
      const parked = isInviteCodeFormat(invite)
        ? { ...req.user.pendingDiscord, inviteCode: invite }
        : req.user.pendingDiscord;
      await this.pending.create(req, res, parked);
      this.logger.log('discord pending identity parked');
      return firstTimeUrl(base, invite);
    }
    const userId = userIdOf(req.user);
    if (action !== 'pending-link' || userId === null) return null;
    if (!(await this.svc.isEnabled())) return null;
    return this.completePendingLink(req, res, base, userId);
  }

  /** "I already have an account": attach the parked Google identity. */
  private async completePendingLink(
    req: Request,
    res: Response,
    base: string,
    userId: number,
  ): Promise<string> {
    const expired = `${base}/auth/first-time?error=expired`;
    const user = await this.findUser(userId);
    if (!user) return expired;
    const refusal = await signinRefusalFor(this.db, user);
    if (refusal) {
      this.logger.log(`discord pending-link refused reason=${refusal.reason}`);
      return refusalRedirect(base, refusal);
    }
    const parked = await this.pending.peek(req);
    if (parked?.provider !== 'google') return expired;
    const blocker = await this.linkBlocker(user.id, parked.subject);
    if (blocker) return `${base}/auth/first-time?error=${blocker}`;
    const spent = await this.pending.consume(req, res);
    if (spent?.provider !== 'google' || spent.subject !== parked.subject) {
      return expired;
    }
    if (!(await this.attach(user.id, spent))) {
      return `${base}/auth/first-time?error=taken`;
    }
    this.logger.log(`discord pending-link ok user=${user.id}`);
    return `${base}${await this.svc.issueSession(req, res, user, 'discord')}`;
  }

  /** `taken` (sub on another user) / `already_linked` (user has a Google). */
  private async linkBlocker(
    userId: number,
    sub: string,
  ): Promise<'taken' | 'already_linked' | null> {
    const owner = await this.svc.findUserBySub(sub);
    if (owner) return owner.id === userId ? null : 'taken';
    return (await this.hasGoogleIdentity(userId)) ? 'already_linked' : null;
  }

  /** Whether the user has Google sign-in (AC7 copy on the Discord link). */
  async hasGoogleIdentity(userId: number): Promise<boolean> {
    const [own] = await this.db
      .select({ id: identities.id })
      .from(identities)
      .where(
        and(eq(identities.userId, userId), eq(identities.provider, 'google')),
      )
      .limit(1);
    return own !== undefined;
  }

  /** Insert the identity; false when a concurrent link took the `sub`. */
  private async attach(userId: number, p: PendingIdentity): Promise<boolean> {
    const owner = await this.svc.findUserBySub(p.subject);
    if (owner) return owner.id === userId;
    const rows = await this.db
      .insert(identities)
      .values({
        userId,
        provider: 'google',
        subject: p.subject,
        email: p.email,
        lastUsedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: identities.id });
    return rows.length > 0;
  }

  private async findUser(id: number): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }
}
