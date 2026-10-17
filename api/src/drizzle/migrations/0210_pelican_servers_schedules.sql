CREATE TABLE "pelican_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"panel_uuid" text NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"game_id" integer,
	"show_on_calendar" boolean DEFAULT true NOT NULL,
	"timezone" text,
	"current_state" text,
	"is_suspended" boolean DEFAULT false NOT NULL,
	"status_checked_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	CONSTRAINT "pelican_servers_panel_uuid_unique" UNIQUE("panel_uuid")
);
--> statement-breakpoint
CREATE TABLE "pelican_schedules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"panel_schedule_id" integer NOT NULL,
	"name" text NOT NULL,
	"cron_minute" text NOT NULL,
	"cron_hour" text NOT NULL,
	"cron_day_of_month" text NOT NULL,
	"cron_month" text NOT NULL,
	"cron_day_of_week" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"only_when_online" boolean DEFAULT false NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"effect" text NOT NULL,
	"effect_offset_s" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pelican_schedules_server_panel_uq" UNIQUE("server_id","panel_schedule_id"),
	CONSTRAINT "pelican_schedules_effect_chk" CHECK ("pelican_schedules"."effect" IN ('restart','stop','start','kill','backup','command','mixed')),
	CONSTRAINT "pelican_schedules_effect_offset_chk" CHECK ("pelican_schedules"."effect_offset_s" BETWEEN 0 AND 900)
);
--> statement-breakpoint
ALTER TABLE "pelican_servers" ADD CONSTRAINT "pelican_servers_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pelican_schedules" ADD CONSTRAINT "pelican_schedules_server_id_pelican_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pelican_servers_game_id_idx" ON "pelican_servers" USING btree ("game_id");