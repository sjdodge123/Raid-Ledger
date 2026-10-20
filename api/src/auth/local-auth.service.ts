import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { eq, ne } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { localCredentials, users } from '../drizzle/schema';
import * as schema from '../drizzle/schema';
import type { UserRole } from '@raid-ledger/contract';
import {
  assertNotBanned,
  assertKickCooldownOrClear,
} from './auth-status.helpers';
import { defined } from '../common/defined.helpers';
import { ImpersonationSessionService } from './impersonation/impersonation-session.service';
import { TokenBlocklistService } from './token-blocklist.service';
import { signAccessToken } from './access-token-mint.helpers';
import { markerExpiry } from './impersonation/impersonation-session.helpers';

/** The caller of `impersonate` (req.user). */
export interface ImpersonatingCaller {
  id: number;
  username: string;
  impersonatedBy?: number | null;
  /** ROK-1823 D6: the version that authenticated the request → `itv`. */
  tokenVersion: number;
}

/** ROK-1754: `POST /auth/impersonate/:userId` response (no original_token). */
export interface ImpersonationStartResult {
  access_token: string;
  user: { id: number; username: string; avatar: string | null; role: UserRole };
}

const SALT_ROUNDS = 12;

type Tx = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

/** Insert a local-only admin's user row (placeholder discordId). */
async function insertLocalAdminUser(tx: Tx, email: string, username?: string) {
  const [row] = await tx
    .insert(users)
    .values({
      discordId: `local:${email}`, // Unique placeholder for local-only users
      username: username || defined(email.split('@')[0], 'email local part'),
      role: 'admin',
    })
    .returning();
  return defined(row, 'inserted local admin user row');
}

/** Insert the hashed local credential linked to `userId`. */
async function insertLocalCredential(
  tx: Tx,
  email: string,
  passwordHash: string,
  userId: number,
) {
  const [row] = await tx
    .insert(localCredentials)
    .values({ email: email.toLowerCase(), passwordHash, userId })
    .returning();
  return defined(row, 'inserted local credential row');
}

@Injectable()
export class LocalAuthService {
  private readonly logger = new Logger(LocalAuthService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    @Inject(JwtService) private jwtService: JwtService,
    private sessions: ImpersonationSessionService,
    private readonly blocklist: TokenBlocklistService,
  ) {}

  /**
   * Hash a password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Validate email/password credentials
   * Returns the user if valid, throws UnauthorizedException if not
   */
  async validateCredentials(
    email: string,
    password: string,
  ): Promise<typeof users.$inferSelect> {
    // Find local credential by email
    const [localAdmin] = await this.db
      .select()
      .from(localCredentials)
      .where(eq(localCredentials.email, email.toLowerCase()))
      .limit(1);

    if (!localAdmin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, localAdmin.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Get linked user record
    if (!localAdmin.userId) {
      throw new UnauthorizedException('Credential not linked to user');
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, localAdmin.userId))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // ROK-313: block banned users; enforce (or auto-clear) the kick cooldown.
    assertNotBanned(user);
    await assertKickCooldownOrClear(this.db, user);

    return user;
  }

  /**
   * Create a local credential with hashed password
   * Uses a transaction to ensure atomicity
   */
  async createLocalAdmin(
    email: string,
    password: string,
    username?: string,
  ): Promise<{
    localAdmin: typeof localCredentials.$inferSelect;
    user: typeof users.$inferSelect;
  }> {
    const passwordHash = await this.hashPassword(password);

    // Use transaction to ensure atomicity
    return await this.db.transaction(async (tx) => {
      // Create the user record first, then the credential linked to it
      const user = await insertLocalAdminUser(tx, email, username);
      const localAdmin = await insertLocalCredential(
        tx,
        email,
        passwordHash,
        user.id,
      );
      return { localAdmin, user };
    });
  }

  /**
   * Check if any local credentials exist
   */
  async hasLocalAdmins(): Promise<boolean> {
    const [result] = await this.db
      .select({ count: localCredentials.id })
      .from(localCredentials)
      .limit(1);
    return !!result;
  }

  /**
   * Generate JWT for authenticated user
   */
  login(user: typeof users.$inferSelect) {
    return {
      access_token: signAccessToken(
        { jwt: this.jwtService },
        {
          username: user.username,
          sub: user.id,
          role: user.role,
          tv: user.tokenVersion,
        },
      ),
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
      },
    };
  }

  /**
   * Create a local login for an existing user (non-admin).
   * Links an existing user to a local_credentials entry with password credentials.
   * Does NOT create a new user or modify role.
   */
  async createLocalUser(
    email: string,
    password: string,
    userId: number,
  ): Promise<void> {
    const passwordHash = await this.hashPassword(password);

    await this.db.insert(localCredentials).values({
      email: email.toLowerCase(),
      passwordHash,
      userId,
    });
  }

  /**
   * Impersonate a target user (Operator+). ROK-1754: no `original_token` —
   * the admin credential stays the httpOnly refresh cookie. With a refresh
   * `familyId` (browser) the start writes a server-side marker so
   * `/auth/refresh` keeps minting the target until exit / the 1h cap; without
   * one (API caller, no cookie jar) the token is today's non-renewable 1h.
   */
  async impersonate(
    adminUser: ImpersonatingCaller,
    targetUserId: number,
    familyId: string | null = null,
  ): Promise<ImpersonationStartResult> {
    if (adminUser.impersonatedBy)
      throw new ForbiddenException('Cannot impersonate while impersonating');
    if (adminUser.id === targetUserId)
      throw new ForbiddenException('Cannot impersonate yourself');
    const target = await this.findImpersonationTarget(targetUserId);
    this.logger.log(
      `IMPERSONATION: Admin "${adminUser.username}" (id:${adminUser.id}) -> "${target.username}" (id:${target.id})`,
    );
    const notAfter = await this.recordStart(adminUser.id, target.id, familyId);
    return this.buildImpersonationToken(adminUser, target, notAfter);
  }

  /** Marker (+audit) or cookie-less audit; returns the token's deadline. */
  private async recordStart(
    adminId: number,
    targetId: number,
    familyId: string | null,
  ): Promise<Date> {
    if (!familyId) {
      await this.sessions.auditStart(adminId, targetId, null);
      return markerExpiry(new Date());
    }
    const marker = await this.sessions.start(familyId, adminId, targetId);
    return marker.expiresAt;
  }

  private async findImpersonationTarget(targetUserId: number) {
    const [target] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) throw new UnauthorizedException('Target user not found');
    if (target.role === 'admin')
      throw new UnauthorizedException('Cannot impersonate admin users');
    // ROK-313 §9.8: an admin must not impersonate INTO a banned account and
    // dodge the lockout (NotDeactivatedGuard bypasses impersonation; ban must not).
    if (target.bannedAt)
      throw new UnauthorizedException('Cannot impersonate a suspended account');
    return target;
  }

  private buildImpersonationToken(
    adminUser: Pick<ImpersonatingCaller, 'id' | 'tokenVersion'>,
    target: typeof users.$inferSelect,
    notAfter: Date,
  ): ImpersonationStartResult {
    return {
      access_token: signAccessToken(
        { jwt: this.jwtService },
        {
          username: target.username,
          sub: target.id,
          role: target.role,
          impersonatedBy: adminUser.id,
          tv: target.tokenVersion,
          itv: adminUser.tokenVersion,
        },
        { notAfter },
      ),
      user: {
        id: target.id,
        username: target.username,
        avatar: target.avatar,
        role: target.role,
      },
    };
  }

  /**
   * List all non-admin users for the impersonation dropdown.
   */
  async listNonAdminUsers(): Promise<
    {
      id: number;
      username: string;
      avatar: string | null;
      discordId: string | null;
      customAvatarUrl: string | null;
    }[]
  > {
    const result = await this.db
      .select({
        id: users.id,
        username: users.username,
        avatar: users.avatar,
        discordId: users.discordId,
        customAvatarUrl: users.customAvatarUrl,
      })
      .from(users)
      .where(ne(users.role, 'admin'));

    return result;
  }
}
