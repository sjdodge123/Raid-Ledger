import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/drizzle/schema';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function check() {
    console.log('--- Tables ---');
    const tables = await client`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    tables.forEach(t => console.log(t.table_name));

    console.log('\n--- Migrations ---');
    try {
        const migrations = await client`SELECT * FROM "__drizzle_migrations"`;
        migrations.forEach(m => console.log(JSON.stringify(m)));
    } catch (e) {
        console.log('Migration table error (likely missing):', e.message);
    }

    process.exit(0);
}

check();
