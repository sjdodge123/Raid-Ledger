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
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, isNotNull, notLike } from 'drizzle-orm';
import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as schema from '../src/drizzle/schema';

const SALT_ROUNDS = 12;
const DEFAULT_EMAIL = 'admin@local';
const FLEET_ADMIN_ENV = 'FLEET_ADMIN_DISCORD_ID';
/** Discord snowflakes are digits only. Rejects `local:%` and typo'd values. */
const DISCORD_SNOWFLAKE = /^[0-9]{5,32}$/;

/**
 * A3-B P6 — fleet-only: nominate ONE Discord identity as admin.
 *
 * A freshly spun fleet env has no way to make the operator an admin: he signs
 * in with Discord OAuth, `UsersService.createOrUpdate` inserts a row that keeps
 * the schema default `role: 'member'`, and every admin surface is unreachable
 * until he falls back to admin@local behind a password.
 *
 * This upserts the configured id as an admin row BEFORE he logs in. On his
 * later OAuth, `createOrUpdate` finds the row by discord_id and updates only
 * username/avatar/updatedAt — `role` is preserved — so nothing under
 * `api/src/auth/**` changes.
 *
 * This is deliberately NOT a "first login wins" rule. Both gates must hold:
 *   1. `FLEET_ADMIN_DISCORD_ID` is set — only env-spin's `docker exec -e` sets
 *      it. The production allinone entrypoint runs bootstrap-admin with no
 *      such variable.
 *   2. `DEMO_MODE === 'true'` — the codebase's production discriminator (see
 *      the `demo-test-*` controllers). It appears nowhere in
 *      `Dockerfile.allinone`, `docker-compose.yml`, `docker-entrypoint.sh` or
 *      `.env.docker.example`; env-spin sets it explicitly per env.
 * Either gate missing → no write at all, and the id gate is an exact
 * discord_id match so no other account can be touched.
 */
async function promoteFleetOperator(
    db: PostgresJsDatabase<typeof schema>,
): Promise<void> {
    const configuredId = (process.env[FLEET_ADMIN_ENV] ?? '').trim();
    if (!configuredId) return;
    if (process.env.DEMO_MODE !== 'true') {
        console.warn(
            `bootstrap-admin: ${FLEET_ADMIN_ENV} is set but DEMO_MODE !== 'true' — refusing to promote a Discord identity outside a fleet env`,
        );
        return;
    }
    if (!DISCORD_SNOWFLAKE.test(configuredId)) {
        console.warn(
            `bootstrap-admin: ${FLEET_ADMIN_ENV}="${configuredId}" is not a Discord snowflake — skipping fleet operator promotion`,
        );
        return;
    }
    // Upsert, not insert: on a re-spin (or after the operator has already
    // logged in) the row exists and only `role` may change. Username/avatar are
    // left alone so his real Discord profile survives the promotion.
    await db
        .insert(schema.users)
        .values({
            discordId: configuredId,
            username: 'Fleet Operator',
            role: 'admin',
        })
        .onConflictDoUpdate({
            target: schema.users.discordId,
            set: { role: 'admin', updatedAt: new Date() },
        });
    console.log(
        `bootstrap-admin: fleet operator mode → promoted discord_id ${configuredId} to admin (DEMO_MODE env only)`,
    );
}

export async function bootstrapAdmin() {
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
        // A3-B P6: runs BEFORE the linked-user resolve, deliberately. Once the
        // operator's row is admin + Discord-linked it satisfies the linkedUser
        // predicate below anyway — on the NEXT bootstrap run. Promoting first
        // makes spin 1 and spin N behave identically (admin@local and Discord
        // OAuth resolve to the same users.id) instead of flipping identity
        // between spins. No-ops entirely outside a fleet env.
        await promoteFleetOperator(db);

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

            // ROK-1356: when re-binding an EXISTING credential (rebind from the
            // local: placeholder, or a re-anchor of an already-bound cred)
            // WITHOUT an explicit reset and WITHOUT a fixed ADMIN_PASSWORD,
            // carry the EXISTING password_hash forward — update userId only.
            // Otherwise the first restart_for_settings rebind rotates a fresh
            // random password that nobody holds (env_spin already returned the
            // seeded password to the caller), and login breaks. A fixed
            // ADMIN_PASSWORD (env-spin's idempotent re-seed uses RESET_PASSWORD
            // + ADMIN_PASSWORD) and an explicit reset both still apply the new
            // hash. First creation (no existingCred) always generates one.
            const carryHashForward =
                !!existingCred && !resetMode && !fixedPassword;
            const effectiveHash = carryHashForward
                ? existingCred.passwordHash
                : passwordHash;

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
                    carryHashForward
                        ? `bootstrap-admin: linked-user mode → rebinding local_credentials.user_id = ${linkedUser.id}, password unchanged`
                        : `bootstrap-admin: linked-user mode → binding local_credentials.user_id = ${linkedUser.id}`,
                );
                // Idempotent bind: INSERT the credential, or UPDATE it in place
                // when a row already exists (first creation, a rebind from the
                // local: placeholder, or an explicit reset). Done before the
                // orphan purge so /auth/local login works even if that purge
                // can't run. Replaces the old delete-cred → delete-user →
                // insert-cred cycle, which aborted the whole bootstrap when the
                // placeholder owned FK-referencing rows (community_lineups.created_by).
                // ROK-1356: `effectiveHash` carries the existing hash forward on
                // a no-reset / no-fixed-password rebind so the seeded password
                // survives restart_for_settings.
                await db
                    .insert(schema.localCredentials)
                    .values({
                        email: DEFAULT_EMAIL,
                        passwordHash: effectiveHash,
                        userId: linkedUser.id,
                    })
                    .onConflictDoUpdate({
                        target: schema.localCredentials.email,
                        set: { passwordHash: effectiveHash, userId: linkedUser.id },
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
            } else if (carryHashForward) {
                // ROK-1356: rebound to the linked user but the password hash was
                // carried forward — do NOT print a banner claiming a new
                // password (env_spin already handed the seeded one to the
                // caller). Keep it greppable for operators tailing stdout.
                console.log(
                    'bootstrap-admin: linked admin credential rebound, password unchanged',
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

// Only auto-run when invoked as a script (`node dist/scripts/bootstrap-admin.js`
// in the allinone entrypoint, or via ts-node in dev). Importing this module
// from a unit test (ROK-1356 regression spec) must NOT trigger a DB connection.
if (require.main === module) {
    bootstrapAdmin();
}
