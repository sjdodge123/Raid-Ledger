CREATE TABLE "lineup_ai_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineup_id" integer NOT NULL,
	"voter_set_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lineup_ai_suggestion_voter_set" UNIQUE("lineup_id","voter_set_hash")
);
--> statement-breakpoint
ALTER TABLE "lineup_ai_suggestions" ADD CONSTRAINT "lineup_ai_suggestions_lineup_id_community_lineups_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lineup_ai_suggestions_lineup_generated_at_idx" ON "lineup_ai_suggestions" USING btree ("lineup_id","generated_at");