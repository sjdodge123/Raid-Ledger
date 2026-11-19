CREATE TABLE "backup_export_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"token_hash" char(64) NOT NULL,
	"token_hint" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_ip_coarse" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "backup_export_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "backup_export_tokens" ADD CONSTRAINT "backup_export_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_export_tokens_created_by_idx" ON "backup_export_tokens" USING btree ("created_by");