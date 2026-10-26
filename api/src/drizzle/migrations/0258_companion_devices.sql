CREATE TABLE "companion_device_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code_hash" text NOT NULL,
	"status" text NOT NULL,
	"device_name" text,
	"device_os" text,
	"device_os_version" text,
	"app_version" text,
	"requested_ip_coarse" text,
	"interval_sec" integer DEFAULT 5 NOT NULL,
	"last_polled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"device_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companion_device_links_device_code_hash_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "companion_device_links_status_chk" CHECK ("companion_device_links"."status" IN ('pending','approved','denied','consumed'))
);
--> statement-breakpoint
CREATE TABLE "companion_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"os" text,
	"os_version" text,
	"app_version" text,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"scope" text DEFAULT 'companion:ingest' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip_coarse" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "companion_devices_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "companion_devices_scope_chk" CHECK ("companion_devices"."scope" = 'companion:ingest')
);
--> statement-breakpoint
ALTER TABLE "companion_device_links" ADD CONSTRAINT "companion_device_links_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_device_links" ADD CONSTRAINT "companion_device_links_device_id_companion_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."companion_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_devices" ADD CONSTRAINT "companion_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companion_device_links_user_code_pending_uq" ON "companion_device_links" USING btree ("user_code_hash") WHERE "companion_device_links"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "companion_device_links_decided_by_idx" ON "companion_device_links" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "companion_device_links_device_id_idx" ON "companion_device_links" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "companion_device_links_expires_at_idx" ON "companion_device_links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "companion_devices_user_id_idx" ON "companion_devices" USING btree ("user_id");