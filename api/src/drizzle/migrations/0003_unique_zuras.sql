CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"slug" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"default_player_cap" integer,
	"default_duration_minutes" integer,
	"requires_composition" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_types_game_slug_unique" UNIQUE("game_id","slug")
);
--> statement-breakpoint
CREATE TABLE "game_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"icon_url" text,
	"color_hex" varchar(7),
	"has_roles" boolean DEFAULT false NOT NULL,
	"has_specs" boolean DEFAULT false NOT NULL,
	"max_characters_per_user" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_registry_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "registry_game_id" uuid;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_game_id_game_registry_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_registry_game_id_game_registry_id_fk" FOREIGN KEY ("registry_game_id") REFERENCES "public"."game_registry"("id") ON DELETE no action ON UPDATE no action;