CREATE TABLE "games_dedup_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_type" text NOT NULL,
	"match_key" text NOT NULL,
	"canonical_game_id" integer NOT NULL,
	"dup_game_ids" integer[] NOT NULL,
	"group_size" integer NOT NULL,
	"downstream_counts" jsonb NOT NULL,
	"unique_conflicts" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"snapshot_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games_dedup_audit" ADD CONSTRAINT "games_dedup_audit_canonical_game_id_games_id_fk" FOREIGN KEY ("canonical_game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_dedup_audit_snapshot_at_match_type_idx" ON "games_dedup_audit" USING btree ("snapshot_at","match_type");
