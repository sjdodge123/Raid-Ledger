CREATE TABLE "valheim_link_blobs" (
	"pelican_server_id" integer NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_referenced_at" timestamp with time zone,
	CONSTRAINT "valheim_link_blobs_pelican_server_id_sha256_pk" PRIMARY KEY("pelican_server_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "valheim_link_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"kind" text NOT NULL,
	"snapshot_key" text NOT NULL,
	"steam_id" text,
	"player_id" text,
	"world_uid" text,
	"game_version" text NOT NULL,
	"mod_version" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"blob_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_detail" text,
	CONSTRAINT "valheim_link_snapshots_key_uq" UNIQUE("pelican_server_id","kind","snapshot_key"),
	CONSTRAINT "valheim_link_snapshots_kind_chk" CHECK ("valheim_link_snapshots"."kind" IN ('character','map','items')),
	CONSTRAINT "valheim_link_snapshots_status_chk" CHECK ("valheim_link_snapshots"."status" IN ('pending','imported','failed'))
);
--> statement-breakpoint
CREATE TABLE "valheim_link_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "valheim_link_tokens_pelican_server_id_unique" UNIQUE("pelican_server_id"),
	CONSTRAINT "valheim_link_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "valheim_link_blobs" ADD CONSTRAINT "valheim_link_blobs_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_link_snapshots" ADD CONSTRAINT "valheim_link_snapshots_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_link_tokens" ADD CONSTRAINT "valheim_link_tokens_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_link_tokens" ADD CONSTRAINT "valheim_link_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valheim_link_snapshots_status_received_idx" ON "valheim_link_snapshots" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "valheim_link_tokens_created_by_idx" ON "valheim_link_tokens" USING btree ("created_by");