import 'dotenv/config';
import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL!);

async function migrate() {
    console.log('Applying 0009_supreme_medusa.sql manually...');

    try {
        await client`
      CREATE TABLE IF NOT EXISTS "availability" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" integer NOT NULL,
        "time_range" "tsrange" NOT NULL,
        "status" text DEFAULT 'available' NOT NULL,
        "game_id" uuid,
        "source_event_id" integer,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
    `;
        console.log('Created availability table.');

        // Add constraints if they don't exist is hard in bare SQL without check, usually simple ALTER will fail if exists.
        // I'll try them one by one.

        try {
            await client`ALTER TABLE "availability" ADD CONSTRAINT "availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;`;
            console.log('Added user FK.');
        } catch (e) {
            console.log('User FK likely exists or error:', e.message);
        }

        try {
            await client`ALTER TABLE "availability" ADD CONSTRAINT "availability_game_id_game_registry_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_registry"("id") ON DELETE no action ON UPDATE no action;`;
            console.log('Added game FK.');
        } catch (e) {
            console.log('Game FK likely exists or error:', e.message);
        }

        try {
            await client`ALTER TABLE "availability" ADD CONSTRAINT "availability_source_event_id_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;`;
            console.log('Added event FK.');
        } catch (e) {
            console.log('Event FK likely exists or error:', e.message);
        }

    } catch (e) {
        console.error('Migration failed:', e);
        process.exit(1);
    }

    process.exit(0);
}

migrate();
