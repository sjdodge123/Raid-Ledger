import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/drizzle/schema';
import * as dotenv from 'dotenv';
dotenv.config();

async function verify() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not defined');
    }

    console.log('Connecting to:', connectionString);
    const client = postgres(connectionString);
    const db = drizzle(client, { schema });

    try {
        console.log('Inserting test user...');
        const result = await db.insert(schema.users).values({
            discordId: 'verify-bot-123',
            username: 'VerifyBot',
            isAdmin: true,
        }).returning();

        console.log('User created:', result[0]);

        console.log('Querying sessions...');
        const sessions = await db.select().from(schema.sessions);
        console.log('Sessions count:', sessions.length);

        console.log('✅ Database verification successful!');
    } catch (err) {
        console.error('❌ Verification failed:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

verify();
