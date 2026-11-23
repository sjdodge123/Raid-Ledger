CREATE TABLE "discord_signin_reminders" (
	"discord_id" text PRIMARY KEY NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
