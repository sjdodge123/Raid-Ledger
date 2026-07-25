CREATE TABLE "channel_bindings_dedup_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"schema_version" varchar(16) NOT NULL,
	"reason" varchar(32) NOT NULL,
	"guild_id" varchar(255) NOT NULL,
	"channel_id" varchar(255) NOT NULL,
	"binding_purpose" varchar(50) NOT NULL,
	"game_id" integer,
	"survivor_id" uuid NOT NULL,
	"loser_binding_id" uuid NOT NULL,
	"loser_row" jsonb NOT NULL,
	"moved_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"events_repointed" integer DEFAULT 0 NOT NULL,
	"events_nulled" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_bindings_dedup_audit_loser_reason_unique" ON "channel_bindings_dedup_audit" USING btree ("loser_binding_id","reason");