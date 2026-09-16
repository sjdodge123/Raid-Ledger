CREATE TABLE "community_lineup_cohort_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_ids" integer[] NOT NULL,
	"participant_hash" text NOT NULL,
	"cohort_size" smallint NOT NULL,
	"game_id" integer NOT NULL,
	"source_lineup_id" integer NOT NULL,
	"resolution" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cl_cohort_memory_row" UNIQUE("participant_hash","game_id","source_lineup_id","resolution")
);
--> statement-breakpoint
ALTER TABLE "community_lineup_cohort_memory" ADD CONSTRAINT "cl_cohort_memory_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_cohort_memory" ADD CONSTRAINT "cl_cohort_memory_source_lineup_id_fk" FOREIGN KEY ("source_lineup_id") REFERENCES "public"."community_lineups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cl_cohort_memory_participants" ON "community_lineup_cohort_memory" USING gin ("participant_ids");--> statement-breakpoint
CREATE INDEX "idx_cl_cohort_memory_hash_size" ON "community_lineup_cohort_memory" USING btree ("participant_hash","cohort_size");