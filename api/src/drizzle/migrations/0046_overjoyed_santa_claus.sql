CREATE TABLE "channel_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(255) NOT NULL,
	"channel_id" varchar(255) NOT NULL,
	"channel_type" varchar(50) NOT NULL,
	"binding_purpose" varchar(50) NOT NULL,
	"game_id" uuid,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_game_id_game_registry_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_registry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_bindings_guild_channel_unique" ON "channel_bindings" USING btree ("guild_id","channel_id");--> statement-breakpoint
CREATE INDEX "idx_channel_bindings_guild" ON "channel_bindings" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "idx_channel_bindings_game" ON "channel_bindings" USING btree ("game_id");