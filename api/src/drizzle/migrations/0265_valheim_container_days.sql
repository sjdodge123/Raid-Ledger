CREATE TABLE "valheim_container_base_item_days" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day_id" bigint NOT NULL,
	"base_key" text NOT NULL,
	"base_x" integer NOT NULL,
	"base_z" integer NOT NULL,
	"prefab" text NOT NULL,
	"vehicle" boolean NOT NULL,
	"owner" text NOT NULL,
	"total" bigint NOT NULL,
	CONSTRAINT "valheim_container_base_item_days_key_uq" UNIQUE("day_id","base_key","prefab","vehicle","owner"),
	CONSTRAINT "valheim_container_base_item_days_total_chk" CHECK ("valheim_container_base_item_days"."total" > 0)
);
--> statement-breakpoint
CREATE TABLE "valheim_container_days" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"world_uid" text NOT NULL,
	"play_date" date NOT NULL,
	"first_captured_at" timestamp with time zone NOT NULL,
	"last_captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "valheim_container_days_server_world_date_uq" UNIQUE("pelican_server_id","world_uid","play_date")
);
--> statement-breakpoint
CREATE TABLE "valheim_container_item_days" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day_id" bigint NOT NULL,
	"prefab" text NOT NULL,
	"vehicle" boolean NOT NULL,
	"owner" text NOT NULL,
	"total" bigint NOT NULL,
	CONSTRAINT "valheim_container_item_days_key_uq" UNIQUE("day_id","prefab","vehicle","owner"),
	CONSTRAINT "valheim_container_item_days_total_chk" CHECK ("valheim_container_item_days"."total" > 0)
);
--> statement-breakpoint
ALTER TABLE "valheim_container_base_item_days" ADD CONSTRAINT "valheim_container_base_item_days_day_fk" FOREIGN KEY ("day_id") REFERENCES "public"."valheim_container_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_container_days" ADD CONSTRAINT "valheim_container_days_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_container_item_days" ADD CONSTRAINT "valheim_container_item_days_day_fk" FOREIGN KEY ("day_id") REFERENCES "public"."valheim_container_days"("id") ON DELETE cascade ON UPDATE no action;