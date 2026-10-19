CREATE TABLE "valheim_item_catalogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"game_version" text NOT NULL,
	"locale" text NOT NULL,
	"atlas_sha256" text,
	"atlas_width" integer,
	"atlas_height" integer,
	"items" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_snapshot_id" bigint,
	CONSTRAINT "valheim_item_catalogs_version_uq" UNIQUE("pelican_server_id","game_version")
);
--> statement-breakpoint
CREATE TABLE "valheim_maps" (
	"id" serial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"steam_id" text NOT NULL,
	"player_id" text NOT NULL,
	"world_uid" text NOT NULL,
	"profile_id" integer,
	"texture_size" integer NOT NULL,
	"pixel_size_metres" double precision NOT NULL,
	"explored" jsonb NOT NULL,
	"shared_explored" jsonb,
	"pins" jsonb NOT NULL,
	"base_map_sha256" text,
	"base_map_width" integer,
	"base_map_height" integer,
	"game_version" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_snapshot_id" bigint,
	CONSTRAINT "valheim_maps_identity_uq" UNIQUE("pelican_server_id","steam_id","player_id","world_uid")
);
--> statement-breakpoint
CREATE TABLE "valheim_profile_claim_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"action" text NOT NULL,
	"from_user_id" integer,
	"to_user_id" integer,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valheim_profile_claim_events_action_chk" CHECK ("valheim_profile_claim_events"."action" IN ('auto_attach','claim','admin_assign','admin_unassign','auto_detach'))
);
--> statement-breakpoint
CREATE TABLE "valheim_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"steam_id" text NOT NULL,
	"player_id" text NOT NULL,
	"world_uid" text NOT NULL,
	"world_name" text NOT NULL,
	"name" text NOT NULL,
	"claimed_by" integer,
	"claim_source" text,
	"claimed_at" timestamp with time zone,
	"game_version" text NOT NULL,
	"mod_version" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"equipment" jsonb NOT NULL,
	"inventory" jsonb NOT NULL,
	"skills" jsonb NOT NULL,
	"trophies" jsonb NOT NULL,
	"known_items" jsonb NOT NULL,
	"known_recipes" jsonb NOT NULL,
	"source_snapshot_id" bigint,
	CONSTRAINT "valheim_profiles_identity_uq" UNIQUE("pelican_server_id","steam_id","player_id"),
	CONSTRAINT "valheim_profiles_claim_source_chk" CHECK ("valheim_profiles"."claim_source" IN ('auto','manual','admin')),
	CONSTRAINT "valheim_profiles_claim_pair_chk" CHECK (("valheim_profiles"."claimed_by" IS NULL) = ("valheim_profiles"."claim_source" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "valheim_link_snapshots" DROP CONSTRAINT "valheim_link_snapshots_status_chk";--> statement-breakpoint
ALTER TABLE "valheim_item_catalogs" ADD CONSTRAINT "valheim_item_catalogs_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_item_catalogs" ADD CONSTRAINT "valheim_item_catalogs_source_snapshot_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."valheim_link_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_maps" ADD CONSTRAINT "valheim_maps_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_maps" ADD CONSTRAINT "valheim_maps_profile_id_valheim_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."valheim_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_maps" ADD CONSTRAINT "valheim_maps_source_snapshot_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."valheim_link_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_profile_claim_events" ADD CONSTRAINT "valheim_profile_claim_events_profile_id_valheim_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."valheim_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_profile_claim_events" ADD CONSTRAINT "valheim_profile_claim_events_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_profile_claim_events" ADD CONSTRAINT "valheim_profile_claim_events_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_profile_claim_events" ADD CONSTRAINT "valheim_profile_claim_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_profiles" ADD CONSTRAINT "valheim_profiles_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_profiles" ADD CONSTRAINT "valheim_profiles_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_profiles" ADD CONSTRAINT "valheim_profiles_source_snapshot_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."valheim_link_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valheim_item_catalogs_source_snapshot_idx" ON "valheim_item_catalogs" USING btree ("source_snapshot_id");--> statement-breakpoint
CREATE INDEX "valheim_maps_profile_idx" ON "valheim_maps" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "valheim_maps_source_snapshot_idx" ON "valheim_maps" USING btree ("source_snapshot_id");--> statement-breakpoint
CREATE INDEX "valheim_profile_claim_events_profile_created_idx" ON "valheim_profile_claim_events" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "valheim_profile_claim_events_from_idx" ON "valheim_profile_claim_events" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "valheim_profile_claim_events_to_idx" ON "valheim_profile_claim_events" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "valheim_profile_claim_events_actor_idx" ON "valheim_profile_claim_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "valheim_profiles_claimed_by_idx" ON "valheim_profiles" USING btree ("claimed_by");--> statement-breakpoint
CREATE INDEX "valheim_profiles_steam_id_idx" ON "valheim_profiles" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "valheim_profiles_source_snapshot_idx" ON "valheim_profiles" USING btree ("source_snapshot_id");--> statement-breakpoint
ALTER TABLE "valheim_link_snapshots" ADD CONSTRAINT "valheim_link_snapshots_status_chk" CHECK ("valheim_link_snapshots"."status" IN ('pending','imported','failed','skipped_stale','waiting_blob'));