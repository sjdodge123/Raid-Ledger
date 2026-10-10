CREATE TABLE "wow_item_meta" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"status" varchar(16) NOT NULL,
	"env" smallint,
	"name" varchar(255),
	"quality" smallint,
	"icon" varchar(100),
	"fetched_at" timestamp with time zone NOT NULL,
	"next_retry_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_wow_item_meta_next_retry" ON "wow_item_meta" USING btree ("next_retry_at");