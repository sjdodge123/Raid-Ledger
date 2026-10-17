CREATE TABLE "game_taste_vectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"vector" vector(7) NOT NULL,
	"dimensions" jsonb NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"signal_hash" text NOT NULL,
	CONSTRAINT "game_taste_vectors_game_id_unique" UNIQUE("game_id")
);
--> statement-breakpoint
ALTER TABLE "game_taste_vectors" ADD CONSTRAINT "game_taste_vectors_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_taste_vectors_computed_at_idx" ON "game_taste_vectors" USING btree ("computed_at");