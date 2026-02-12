import {
  Injectable,
  Inject,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { eq, ne } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.provider';
import { localCredentials, users } from '../drizzle/schema';
import * as schema from '../drizzle/schema';
import type { UserRole } from '@raid-ledger/contract';

const SALT_ROUNDS = 12;

@Injectable()
export class LocalAuthService {
  private readonly logger = new Logger(LocalAuthService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    @Inject(JwtService) private jwtService: JwtService,
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
      // Create user record first (with a placeholder discordId for local-only users)
      const [user] = await tx
        .insert(users)
        .values({
          discordId: `local:${email}`, // Unique placeholder for local-only users
          username: username || email.split('@')[0],
          role: 'admin',
        })
        .returning();

      // Create local credential linked to user
      const [localAdmin] = await tx
        .insert(localCredentials)
        .values({
          email: email.toLowerCase(),
          passwordHash,
          userId: user.id,
        })
        .returning();

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
    const payload = {
      username: user.username,
      sub: user.id,
      role: user.role,
    };
    return {
      access_token: this.jwtService.sign(payload),
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
   * Impersonate a target user (admin-only).
   * Returns a JWT for the target user with an impersonatedBy claim,
   * plus a token to restore the admin session.
   */
  async impersonate(
    adminUser: { id: number; username: string; role: UserRole },
    targetUserId: number,
  ): Promise<{
    access_token: string;
    original_token: string;
    user: {
      id: number;
      username: string;
      avatar: string | null;
      role: UserRole;
    };
  }> {
    // Look up target user
    const [target] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!target) {
      throw new UnauthorizedException('Target user not found');
    }

    if (target.role === 'admin') {
      throw new UnauthorizedException('Cannot impersonate admin users');
    }

    this.logger.log(
      `IMPERSONATION: Admin "${adminUser.username}" (id:${adminUser.id}) -> "${target.username}" (id:${target.id})`,
    );

    // Issue JWT for target user with impersonatedBy claim (1hr expiry)
    const impersonatedPayload = {
      username: target.username,
      sub: target.id,
      role: target.role,
      impersonatedBy: adminUser.id,
    };

    const originalPayload = {
      username: adminUser.username,
      sub: adminUser.id,
      role: adminUser.role,
    };

    return {
      access_token: this.jwtService.sign(impersonatedPayload, {
        expiresIn: '1h',
      }),
      original_token: this.jwtService.sign(originalPayload),
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
