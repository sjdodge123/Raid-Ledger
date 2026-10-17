ALTER TABLE "discord_thread_messages" ADD COLUMN "reactions" jsonb DEFAULT '[]'::jsonb NOT NULL;
