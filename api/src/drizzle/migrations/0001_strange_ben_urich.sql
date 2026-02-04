CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"cover_url" text,
	"cached_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "games_igdb_id_unique" UNIQUE("igdb_id")
);
