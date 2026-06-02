#!/usr/bin/env ts-node
/**
 * Bootstrap Admin Script
 *
 * Creates an initial admin account on first run if no local credentials exist.
 * Password is always randomly generated on first creation.
 *
 * Password reset:
 *   - Set RESET_PASSWORD=true environment variable to generate a new random
 *     password and log it to stdout on startup.
 *   - The --reset flag also triggers a password reset.
 *
 * Usage:
 *   npx ts-node scripts/bootstrap-admin.ts           # Create admin if none exists
 *   npx ts-node scripts/bootstrap-admin.ts --reset   # Reset existing admin password
 *   RESET_PASSWORD=true npx ts-node scripts/bootstrap-admin.ts  # Reset via env var
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, isNotNull, notLike } from 'drizzle-orm';
import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as schema from '../src/drizzle/schema';

const SALT_ROUNDS = 12;
const DEFAULT_EMAIL = 'admin@local';

async function bootstrapAdmin() {
    const databaseUrl = process.env.DATABASE_URL;
    const resetMode =
        process.argv.includes('--reset') ||
        process.env.RESET_PASSWORD === 'true';
    // If ADMIN_PASSWORD is set in .env, use it instead of random.
    // This avoids password churn when the DB is recreated during dev.
    const fixedPassword = process.env.ADMIN_PASSWORD || '';

    if (!databaseUrl) {
        console.error('DATABASE_URL environment variable is required');
        process.exit(1);
    }

    const sql = postgres(databaseUrl);
    const db = drizzle(sql, { schema });

    try {
        // ROK-1331 M6a: resolve the operator's linked admin row if a
        // settings-mode sync already populated it. `linkedUser` is the
        // user row carrying the operator's real Discord identity (NOT the
        // `local:admin@local` placeholder). When present, bind
        // local_credentials to THIS row so Discord OAuth login + /auth/local
        // both resolve to the same `users.id`. Otherwise fall through to
        // the legacy placeholder-user path.
        const linkedUserRows = await db
            .select()
            .from(schema.users)
            .where(
                and(
                    eq(schema.users.role, 'admin'),
                    isNotNull(schema.users.discordId),
                    notLike(schema.users.discordId, 'local:%'),
                ),
            )
            .limit(1);
        const linkedUser = linkedUserRows[0];

        const password =
            fixedPassword || crypto.randomBytes(16).toString('base64');
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        const existingCreds = await db
            .select()
            .from(schema.localCredentials)
            .where(eq(schema.localCredentials.email, DEFAULT_EMAIL))
            .limit(1);
        const existingCred = existingCreds[0];

        if (linkedUser) {
            const credAlreadyBound =
                !!existingCred && existingCred.userId === linkedUser.id;

            // Idempotency guard: once the credential is already bound to the
            // linked admin and this isn't an explicit reset, leave it untouched.
            // Do NOT re-hash the password on every boot — that would rotate a
            // fresh random password each restart when ADMIN_PASSWORD is unset.
            // Mirrors legacy-mode's "skip if exists". The orphan purge below
            // still runs (it's idempotent).
            if (credAlreadyBound && !resetMode) {
                console.log(
                    'bootstrap-admin: linked-user mode → credential already bound to linked admin, leaving password unchanged',
                );
            } else {
                console.log(
                    `bootstrap-admin: linked-user mode → binding local_credentials.user_id = ${linkedUser.id}`,
                );
                // Idempotent bind: INSERT the credential, or UPDATE it in place
                // when a row already exists (first creation, a rebind from the
                // local: placeholder, or an explicit reset). Done before the
                // orphan purge so /auth/local login works even if that purge
                // can't run. Replaces the old delete-cred → delete-user →
                // insert-cred cycle, which aborted the whole bootstrap when the
                // placeholder owned FK-referencing rows (community_lineups.created_by).
                await db
                    .insert(schema.localCredentials)
                    .values({
                        email: DEFAULT_EMAIL,
                        passwordHash,
                        userId: linkedUser.id,
                    })
                    .onConflictDoUpdate({
                        target: schema.localCredentials.email,
                        set: { passwordHash, userId: linkedUser.id },
                    });
            }

            // Best-effort purge of the orphan `local:admin@local` placeholder
            // user. Literal (not interpolated) so it stays greppable — the
            // linked-user contract test asserts on this exact byte sequence.
            // The placeholder may still own FK-referencing rows from an earlier
            // local-admin-mode run; if the delete trips that FK, leave the
            // orphan in place rather than aborting — the credential above
            // already resolves to the real linked user, so login works.
            try {
                await db
                    .delete(schema.users)
                    .where(eq(schema.users.discordId, 'local:admin@local'));
            } catch (purgeErr) {
                console.warn(
                    `bootstrap-admin: orphan local:admin@local placeholder not purged (likely owns FK-referenced rows); leaving in place — ${(purgeErr as Error).message}`,
                );
            }

            if (credAlreadyBound && !resetMode) {
                console.log(
                    'bootstrap-admin: existing linked admin credential left unchanged',
                );
            } else {
                printAdminBanner(
                    existingCred ? 'ADMIN PASSWORD RESET' : 'INITIAL ADMIN CREDENTIALS',
                    password,
                );
            }
            await sql.end();
            return;
        }

        // legacy "local-admin mode" — no operator identity in the env yet
        // (sync-local-to-env's discord-identity step wasn't run, or the
        // operator's local DB has no Discord-linked admin). Fall through
        // to the placeholder-user path.
        console.log(
            `bootstrap-admin: local-admin mode → using local:${DEFAULT_EMAIL} placeholder`,
        );

        if (existingCred) {
            if (resetMode) {
                await db
                    .update(schema.localCredentials)
                    .set({ passwordHash })
                    .where(eq(schema.localCredentials.email, DEFAULT_EMAIL));
                printAdminBanner('ADMIN PASSWORD RESET', password);
            } else {
                console.log(
                    'Local credentials already exist, skipping bootstrap',
                );
            }
            await sql.end();
            return;
        }

        // ROK-531: Upsert user record to avoid duplicates after backup restore
        const [user] = await db
            .insert(schema.users)
            .values({
                discordId: `local:${DEFAULT_EMAIL}`,
                username: 'Admin',
                role: 'admin',
            })
            .onConflictDoNothing({ target: schema.users.discordId })
            .returning();

        // If user already existed (from backup), look it up
        const adminUser = user ?? (await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.discordId, `local:${DEFAULT_EMAIL}`))
            .limit(1)
            .then(rows => rows[0]));

        if (!adminUser) {
            console.error('Failed to create or find admin user');
            await sql.end();
            process.exit(1);
        }

        // ROK-531: Upsert local credential to avoid duplicates after backup restore
        await db.insert(schema.localCredentials).values({
            email: DEFAULT_EMAIL,
            passwordHash,
            userId: adminUser.id,
        }).onConflictDoNothing({ target: schema.localCredentials.email });

        printAdminBanner('INITIAL ADMIN CREDENTIALS', password);

        await sql.end();
    } catch (error) {
        console.error('Bootstrap failed:', error);
        await sql.end();
        process.exit(1);
    }
}

function printAdminBanner(title: string, password: string): void {
    console.log('');
    console.log('========================================================');
    console.log(`  ${title}`);
    console.log('========================================================');
    console.log(`  Email:    ${DEFAULT_EMAIL}`);
    console.log(`  Password: ${password}`);
    console.log('--------------------------------------------------------');
    console.log('  Save this password! It will not be shown again.');
    console.log('  To reset, set RESET_PASSWORD=true and restart.');
    console.log('========================================================');
    console.log('');
}

bootstrapAdmin();
