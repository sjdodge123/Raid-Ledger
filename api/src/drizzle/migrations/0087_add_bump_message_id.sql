-- ROK-728: Track recruitment bump message ID for cleanup when event fills up
ALTER TABLE "discord_event_messages" ADD COLUMN "bump_message_id" varchar(255);
