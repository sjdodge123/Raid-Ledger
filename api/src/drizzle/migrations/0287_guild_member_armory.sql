CREATE TABLE "guild_member_armory" (
	"guild_member_id" integer PRIMARY KEY NOT NULL,
	"blizzard_character_id" bigint,
	"level" integer,
	"roster_level" integer,
	"class" varchar(50),
	"race" varchar(50),
	"spec" varchar(50),
	"role" varchar(20),
	"item_level" integer,
	"avatar_url" text,
	"equipment" jsonb,
	"talents" jsonb,
	"armory_professions" jsonb,
	"last_login_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"failures" smallint DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"last_error" varchar(32),
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "guild_member_armory" ADD CONSTRAINT "guild_member_armory_guild_member_id_guild_members_id_fk" FOREIGN KEY ("guild_member_id") REFERENCES "public"."guild_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guild_member_armory_retry_at" ON "guild_member_armory" USING btree ("retry_at");--> statement-breakpoint
CREATE INDEX "idx_guild_member_armory_blizzard_id" ON "guild_member_armory" USING btree ("blizzard_character_id");