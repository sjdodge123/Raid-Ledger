CREATE TABLE "valheim_container_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"world_uid" text NOT NULL,
	"game_version" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"omitted_shared" integer NOT NULL,
	"omitted_private" integer NOT NULL,
	"container_count" integer NOT NULL,
	"stack_count" integer NOT NULL,
	"source_snapshot_id" bigint,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valheim_container_scans_world_uq" UNIQUE("pelican_server_id","world_uid")
);
--> statement-breakpoint
CREATE TABLE "valheim_container_stacks" (
	"container_id" integer NOT NULL,
	"prefab" text NOT NULL,
	"quality" smallint NOT NULL,
	"stack" integer NOT NULL,
	CONSTRAINT "valheim_container_stacks_pk" PRIMARY KEY("container_id","prefab","quality")
);
--> statement-breakpoint
CREATE TABLE "valheim_containers" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" integer NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"public_key" text NOT NULL,
	"prefab" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"z" double precision NOT NULL,
	"creator_player_id" text NOT NULL,
	"privacy" text NOT NULL,
	"vehicle" boolean NOT NULL,
	"slots" integer NOT NULL,
	"used_slots" integer NOT NULL,
	"unreadable" boolean NOT NULL,
	"omitted_entries" integer NOT NULL,
	CONSTRAINT "valheim_containers_scan_key_uq" UNIQUE("scan_id","public_key"),
	CONSTRAINT "valheim_containers_privacy_chk" CHECK ("valheim_containers"."privacy" IN ('public','private','group'))
);
--> statement-breakpoint
ALTER TABLE "valheim_link_snapshots" DROP CONSTRAINT "valheim_link_snapshots_kind_chk";--> statement-breakpoint
ALTER TABLE "valheim_container_scans" ADD CONSTRAINT "valheim_container_scans_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_container_scans" ADD CONSTRAINT "valheim_container_scans_source_snapshot_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."valheim_link_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_container_stacks" ADD CONSTRAINT "valheim_container_stacks_container_id_valheim_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."valheim_containers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_containers" ADD CONSTRAINT "valheim_containers_scan_id_valheim_container_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."valheim_container_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valheim_container_scans_server_captured_idx" ON "valheim_container_scans" USING btree ("pelican_server_id","captured_at");--> statement-breakpoint
CREATE INDEX "valheim_container_scans_source_snapshot_idx" ON "valheim_container_scans" USING btree ("source_snapshot_id");--> statement-breakpoint
CREATE INDEX "valheim_containers_scan_privacy_idx" ON "valheim_containers" USING btree ("scan_id","privacy");--> statement-breakpoint
CREATE INDEX "valheim_profiles_server_player_idx" ON "valheim_profiles" USING btree ("pelican_server_id","player_id");--> statement-breakpoint
ALTER TABLE "valheim_link_snapshots" ADD CONSTRAINT "valheim_link_snapshots_kind_chk" CHECK ("valheim_link_snapshots"."kind" IN ('character','map','items','containers'));