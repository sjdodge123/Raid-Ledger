CREATE TABLE "character_installed_addons" (
	"character_id" uuid PRIMARY KEY NOT NULL,
	"addons" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload_sha256" char(64) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_recommended_addons" ADD COLUMN "folder_name" varchar(64);--> statement-breakpoint
ALTER TABLE "character_installed_addons" ADD CONSTRAINT "character_installed_addons_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;