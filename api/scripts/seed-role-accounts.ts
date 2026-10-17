#!/usr/bin/env ts-node
/**
 * Seed Role Accounts (ROK-212)
 *
 * Ensures demo seed users exist for impersonation-based ACL testing:
 * - ShadowMage → raid leader role (creates events, non-admin)
 * - CasualCarl → player role (regular user, non-admin)
 *
 * These accounts have NO local_credentials entries — they cannot
 * log in independently. An admin must impersonate them via the
 * admin menu to test ACLs.
 *
 * Also updates creatorId on the first 2 demo events to ShadowMage
 * so the raidleader role can manage them.
 *
 * Idempotent: only assigns events if ShadowMage user exists.
 *
 * Usage: npx ts-node scripts/seed-role-accounts.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../src/drizzle/schema';

interface RoleAccount {
    username: string; // maps to existing seed user
    displayName: string; // for console output
    description: string;
}

const ROLE_ACCOUNTS: RoleAccount[] = [
    {
        username: 'ShadowMage',
        displayName: 'Raid Leader',
        description: 'Can create/manage events, non-admin',
    },
    {
        username: 'CasualCarl',
        displayName: 'Player',
        description: 'Regular player, signs up for events',
    },
];

async function seedRoleAccounts() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
        console.error('❌ DATABASE_URL environment variable is required');
        process.exit(1);
    }

    const sql = postgres(databaseUrl);
    const db = drizzle(sql, { schema });

    try {
        console.log('🎭 Verifying role accounts for impersonation testing...\n');

        const verifiedAccounts: { username: string; role: string; id: number }[] = [];

        for (const account of ROLE_ACCOUNTS) {
            // Verify the seed user exists
            const [user] = await db
                .select()
                .from(schema.users)
                .where(eq(schema.users.username, account.username))
                .limit(1);

            if (!user) {
                console.log(`  ⚠️  Not found: "${account.username}" — run seed-testing.ts first`);
                continue;
            }

            console.log(`  ✅ Found: ${account.username} (id: ${user.id}) → ${account.displayName}`);
            verifiedAccounts.push({
                username: account.username,
                role: account.displayName,
                id: user.id,
            });
        }

        // Update creatorId on first 2 events for the raidleader user
        const raidleader = verifiedAccounts.find((a) => a.role === 'Raid Leader');

        if (raidleader) {
            const events = await db
                .select()
                .from(schema.events)
                .limit(2);

            for (const event of events) {
                await db
                    .update(schema.events)
                    .set({ creatorId: raidleader.id })
                    .where(eq(schema.events.id, event.id));
            }

            if (events.length > 0) {
                console.log(`\n  🏰 Assigned ${events.length} events to ${raidleader.username} (Raid Leader)`);
            }
        }

        // Print info box
        if (verifiedAccounts.length > 0) {
            console.log('');
            console.log('╔════════════════════════════════════════════════════════════╗');
            console.log('║          🎭 IMPERSONATION TARGETS                          ║');
            console.log('╠════════════════════════════════════════════════════════════╣');
            for (const acct of verifiedAccounts) {
                const desc = ROLE_ACCOUNTS.find((r) => r.username === acct.username)?.description ?? '';
                console.log(`║  ${acct.role.padEnd(12)} ${acct.username.padEnd(16)} ${desc.padEnd(27)} ║`);
            }
            console.log('╠════════════════════════════════════════════════════════════╣');
            console.log('║  These users have NO login credentials.                   ║');
            console.log('║  Use admin Impersonate menu to test as these roles.       ║');
            console.log('╚════════════════════════════════════════════════════════════╝');
            console.log('');
        }

        await sql.end();
    } catch (error) {
        console.error('❌ Seed role accounts failed:', error);
        await sql.end();
        process.exit(1);
    }
}

seedRoleAccounts();
