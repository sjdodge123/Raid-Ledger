CREATE TABLE "guild_member_level_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"guild_member_id" integer NOT NULL,
	"from_level" integer NOT NULL,
	"to_level" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_member_level_events" ADD CONSTRAINT "guild_member_level_events_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_member_level_events" ADD CONSTRAINT "guild_member_level_events_guild_member_id_guild_members_id_fk" FOREIGN KEY ("guild_member_id") REFERENCES "public"."guild_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guild_member_level_events_member_to_level" ON "guild_member_level_events" USING btree ("guild_member_id","to_level");--> statement-breakpoint
CREATE INDEX "idx_guild_member_level_events_guild_occurred" ON "guild_member_level_events" USING btree ("guild_id","occurred_at" DESC NULLS LAST);