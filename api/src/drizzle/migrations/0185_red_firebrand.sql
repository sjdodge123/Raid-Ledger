CREATE TABLE "discord_channel_presence_occupancy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"presence_message_id" uuid NOT NULL,
	"discord_user_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"game_id" integer,
	"activity_name" varchar(255),
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "discord_channel_presence_occupancy" ADD CONSTRAINT "channel_presence_occupancy_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_channel_presence_occupancy" ADD CONSTRAINT "channel_presence_occupancy_message_id_fk" FOREIGN KEY ("presence_message_id") REFERENCES "public"."discord_channel_presence_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_channel_presence_occupancy_msg" ON "discord_channel_presence_occupancy" USING btree ("presence_message_id");--> statement-breakpoint
CREATE INDEX "idx_channel_presence_occupancy_open" ON "discord_channel_presence_occupancy" USING btree ("presence_message_id") WHERE "discord_channel_presence_occupancy"."left_at" is null;