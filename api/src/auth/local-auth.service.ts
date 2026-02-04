import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.provider';
import { localAdmins, users } from '../drizzle/schema';

const SALT_ROUNDS = 12;

@Injectable()
export class LocalAuthService {
  constructor(
    @Inject(DrizzleAsyncProvider) private db: any,
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
    // Find local admin by email
    const [localAdmin] = await this.db
      .select()
      .from(localAdmins)
      .where(eq(localAdmins.email, email.toLowerCase()))
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
      throw new UnauthorizedException('Admin account not linked to user');
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
   * Create a local admin account with hashed password
   * Uses a transaction to ensure atomicity
   */
  async createLocalAdmin(
    email: string,
    password: string,
    username?: string,
  ): Promise<{
    localAdmin: typeof localAdmins.$inferSelect;
    user: typeof users.$inferSelect;
  }> {
    const passwordHash = await this.hashPassword(password);

    // Use transaction to ensure atomicity
    return await this.db.transaction(async (tx: any) => {
      // Create user record first (with a placeholder discordId for local-only users)
      const [user] = await tx
        .insert(users)
        .values({
          discordId: `local:${email}`, // Unique placeholder for local-only users
          username: username || email.split('@')[0],
          isAdmin: true,
        })
        .returning();

      // Create local admin linked to user
      const [localAdmin] = await tx
        .insert(localAdmins)
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
   * Check if any local admin accounts exist
   */
  async hasLocalAdmins(): Promise<boolean> {
    const [result] = await this.db
      .select({ count: localAdmins.id })
      .from(localAdmins)
      .limit(1);
    return !!result;
  }

  /**
   * Generate JWT for authenticated user
   */
  async login(user: typeof users.$inferSelect) {
    const payload = {
      username: user.username,
      sub: user.id,
      isAdmin: user.isAdmin,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
      },
    };
  }
}
