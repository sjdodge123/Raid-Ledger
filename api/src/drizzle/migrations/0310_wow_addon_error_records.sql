CREATE TABLE "wow_addon_error_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" integer,
	"account_key" char(64) NOT NULL,
	"character_name" text,
	"character_realm" text,
	"source" varchar(16) NOT NULL,
	"source_version" text NOT NULL,
	"addon" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"record_hash" char(64) NOT NULL,
	"count" integer NOT NULL,
	"session" integer,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"scrubbed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wow_addon_error_records" ADD CONSTRAINT "wow_addon_error_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wow_addon_error_records" ADD CONSTRAINT "wow_addon_error_records_device_id_companion_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."companion_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wow_addon_error_records_user_hash_uq" ON "wow_addon_error_records" USING btree ("user_id","record_hash");--> statement-breakpoint
CREATE INDEX "wow_addon_error_records_device_id_idx" ON "wow_addon_error_records" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "wow_addon_error_records_addon_last_seen_idx" ON "wow_addon_error_records" USING btree ("addon","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wow_addon_error_records_last_seen_idx" ON "wow_addon_error_records" USING btree ("last_seen_at");