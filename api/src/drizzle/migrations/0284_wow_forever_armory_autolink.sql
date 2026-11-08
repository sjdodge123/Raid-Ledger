CREATE TABLE "wow_forever_armory_autolink" (
	"character_id" uuid PRIMARY KEY NOT NULL,
	"failures" smallint DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone NOT NULL,
	"last_error" varchar(32) NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wow_forever_armory_autolink" ADD CONSTRAINT "wow_forever_armory_autolink_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wow_forever_armory_autolink_retry_at" ON "wow_forever_armory_autolink" USING btree ("retry_at");