CREATE TABLE "character_addon_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"section" varchar(10) NOT NULL,
	"schema" smallint NOT NULL,
	"data" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload_sha256" char(64) NOT NULL,
	CONSTRAINT "uq_character_addon_snapshots_character_section" UNIQUE("character_id","section")
);
--> statement-breakpoint
CREATE TABLE "addon_encounter_pulls" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"region" varchar(10) NOT NULL,
	"encounter_id" integer NOT NULL,
	"encounter_name" varchar(128) NOT NULL,
	"difficulty_id" integer NOT NULL,
	"group_size" integer NOT NULL,
	"instance_id" integer,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"success" boolean NOT NULL,
	"roster" jsonb NOT NULL,
	"guild_key" varchar(64) DEFAULT '' NOT NULL,
	"reported_by_user_id" integer,
	"reported_by_character_id" uuid,
	"payload_sha256" char(64) NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_addon_encounter_pulls_dedupe" UNIQUE("game_id","region","encounter_id","start_at","guild_key")
);
--> statement-breakpoint
CREATE TABLE "addon_import_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"character_id" uuid,
	"section" varchar(10),
	"payload_sha256" char(64),
	"size_bytes" integer NOT NULL,
	"dry_run" boolean NOT NULL,
	"result" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "addon_guid" varchar(32);--> statement-breakpoint
ALTER TABLE "character_addon_snapshots" ADD CONSTRAINT "character_addon_snapshots_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_encounter_pulls" ADD CONSTRAINT "addon_encounter_pulls_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_encounter_pulls" ADD CONSTRAINT "addon_encounter_pulls_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_encounter_pulls" ADD CONSTRAINT "addon_encounter_pulls_reported_by_character_id_characters_id_fk" FOREIGN KEY ("reported_by_character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_import_audit" ADD CONSTRAINT "addon_import_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_import_audit" ADD CONSTRAINT "addon_import_audit_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_addon_encounter_pulls_reported_by_user_id" ON "addon_encounter_pulls" USING btree ("reported_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_addon_encounter_pulls_reported_by_character_id" ON "addon_encounter_pulls" USING btree ("reported_by_character_id");--> statement-breakpoint
CREATE INDEX "idx_addon_import_audit_user_created_at" ON "addon_import_audit" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_addon_import_audit_character_id" ON "addon_import_audit" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_characters_addon_guid" ON "characters" USING btree ("game_id","region","addon_guid") WHERE "characters"."addon_guid" IS NOT NULL;