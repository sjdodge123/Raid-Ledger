CREATE TABLE "lfg_group_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" integer NOT NULL,
	"guild_id" varchar(255) NOT NULL,
	"channel_id" varchar(255) NOT NULL,
	"message_id" varchar(255) NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"last_member_count" integer DEFAULT 0 NOT NULL,
	"posted_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	CONSTRAINT "lfg_group_messages_state_check" CHECK ("lfg_group_messages"."state" IN ('open', 'converted', 'expired', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "lfg_group_messages" ADD CONSTRAINT "lfg_group_messages_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lfg_group_messages_game_open" ON "lfg_group_messages" USING btree ("game_id") WHERE "lfg_group_messages"."state" = 'open';--> statement-breakpoint
CREATE INDEX "idx_lfg_group_messages_message" ON "lfg_group_messages" USING btree ("guild_id","channel_id","message_id");