CREATE TABLE "valheim_portal_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"world_uid" text NOT NULL,
	"game_version" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"omitted" integer NOT NULL,
	"portal_count" integer NOT NULL,
	"source_snapshot_id" bigint,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valheim_portal_scans_world_uq" UNIQUE("pelican_server_id","world_uid")
);
--> statement-breakpoint
CREATE TABLE "valheim_portals" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" integer NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"prefab" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision,
	"z" double precision NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "valheim_link_snapshots" DROP CONSTRAINT "valheim_link_snapshots_kind_chk";--> statement-breakpoint
ALTER TABLE "valheim_portal_scans" ADD CONSTRAINT "valheim_portal_scans_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_portal_scans" ADD CONSTRAINT "valheim_portal_scans_source_snapshot_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."valheim_link_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_portals" ADD CONSTRAINT "valheim_portals_scan_id_valheim_portal_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."valheim_portal_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valheim_portal_scans_server_captured_idx" ON "valheim_portal_scans" USING btree ("pelican_server_id","captured_at");--> statement-breakpoint
CREATE INDEX "valheim_portal_scans_source_snapshot_idx" ON "valheim_portal_scans" USING btree ("source_snapshot_id");--> statement-breakpoint
CREATE INDEX "valheim_portals_scan_idx" ON "valheim_portals" USING btree ("scan_id");--> statement-breakpoint
ALTER TABLE "valheim_link_snapshots" ADD CONSTRAINT "valheim_link_snapshots_kind_chk" CHECK ("valheim_link_snapshots"."kind" IN ('character','map','items','containers','recipes','portals'));