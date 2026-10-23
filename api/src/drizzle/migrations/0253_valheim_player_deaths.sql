CREATE TABLE "valheim_player_deaths" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"character_name" text NOT NULL,
	"steam_id" text,
	"source" text DEFAULT 'log' NOT NULL,
	"logged_at" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"x" double precision,
	"z" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valheim_player_deaths_source_check" CHECK ("valheim_player_deaths"."source" IN ('log', 'mod')),
	CONSTRAINT "valheim_player_deaths_log_ts_check" CHECK ("valheim_player_deaths"."source" <> 'log' OR "valheim_player_deaths"."logged_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "valheim_player_deaths" ADD CONSTRAINT "valheim_player_deaths_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valheim_player_deaths_log_uq" ON "valheim_player_deaths" USING btree ("pelican_server_id","character_name","logged_at") WHERE "valheim_player_deaths"."source" = 'log';--> statement-breakpoint
CREATE INDEX "valheim_player_deaths_server_steam_idx" ON "valheim_player_deaths" USING btree ("pelican_server_id","steam_id");