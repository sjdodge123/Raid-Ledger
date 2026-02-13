#!/usr/bin/env ts-node
/**
 * Bootstrap Admin Script
 *
 * Creates an initial admin account on first run if no local credentials exist.
 * Password can be set via ADMIN_PASSWORD environment variable, otherwise generated.
 *
 * Reset triggers:
 *   --reset flag           CLI argument to force password reset
 *   RESET_PASSWORD=true    Env var (used by deploy scripts for --reset-password)
 *   ADMIN_PASSWORD=xxx     Env var to set an explicit password
 *
 * Usage:
 *   npx ts-node scripts/bootstrap-admin.ts           # Create admin if none exists
 *   npx ts-node scripts/bootstrap-admin.ts --reset   # Reset existing admin password
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as schema from '../src/drizzle/schema';

const SALT_ROUNDS = 12;
const DEFAULT_EMAIL = 'admin@local';

async function bootstrapAdmin() {
    const databaseUrl = process.env.DATABASE_URL;
    const resetMode = process.argv.includes('--reset') || process.env.RESET_PASSWORD === 'true';

    if (!databaseUrl) {
        console.error('DATABASE_URL environment variable is required');
        process.exit(1);
    }

    const sql = postgres(databaseUrl);
    const db = drizzle(sql, { schema });

    try {
        // Check if any local credentials exist
        const existingCreds = await db
            .select()
            .from(schema.localCredentials)
            .where(eq(schema.localCredentials.email, DEFAULT_EMAIL))
            .limit(1);

        if (existingCreds.length > 0) {
            // Admin exists — check if we need to update the password
            const explicitPassword = process.env.ADMIN_PASSWORD;

            if (resetMode || explicitPassword) {
                // --reset flag, RESET_PASSWORD env var, or ADMIN_PASSWORD env var: update password
                const password = explicitPassword || crypto.randomBytes(16).toString('base64');
                const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

                await db
                    .update(schema.localCredentials)
                    .set({ passwordHash })
                    .where(eq(schema.localCredentials.email, DEFAULT_EMAIL));

                console.log('');
                console.log('========================================================');
                console.log('  ADMIN PASSWORD RESET');
                console.log('========================================================');
                console.log(`  Email:    ${DEFAULT_EMAIL}`);
                console.log(`  Password: ${password}`);
                console.log('--------------------------------------------------------');
                console.log('  Save this password! It will not be shown again.');
                console.log('========================================================');
                console.log('');
            } else {
                console.log('Local credentials already exist, skipping bootstrap');
            }

            await sql.end();
            return;
        }

        // No admin exists — create one
        const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('base64');
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Create user record first
        const [user] = await db
            .insert(schema.users)
            .values({
                discordId: `local:${DEFAULT_EMAIL}`,
                username: 'Admin',
                role: 'admin',
            })
            .returning();

        // Create local credential linked to user
        await db
            .insert(schema.localCredentials)
            .values({
                email: DEFAULT_EMAIL,
                passwordHash,
                userId: user.id,
            });

        console.log('');
        console.log('========================================================');
        console.log('  INITIAL ADMIN CREDENTIALS');
        console.log('========================================================');
        console.log(`  Email:    ${DEFAULT_EMAIL}`);
        console.log(`  Password: ${password}`);
        console.log('--------------------------------------------------------');
        console.log('  Save this password! It will not be shown again.');
        console.log('  You can link your Discord account in the profile page.');
        console.log('========================================================');
        console.log('');

        await sql.end();
    } catch (error) {
        console.error('❌ Bootstrap failed:', error);
        await sql.end();
        process.exit(1);
    }
}

bootstrapAdmin();
