CREATE SEQUENCE "public"."hub_games_updated_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "hub_games" (
	"rl_game_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"name_source" text NOT NULL,
	"normalized_name" text NOT NULL,
	"updated_seq" bigint DEFAULT nextval('hub_games_updated_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_games_name_source_check" CHECK ("hub_games"."name_source" in ('instance', 'rl_seed', 'wikidata', 'hub_admin'))
);
--> statement-breakpoint
CREATE TABLE "hub_game_ids" (
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"rl_game_id" text NOT NULL,
	"source" text NOT NULL,
	"provenance" text,
	"first_contributor_instance_id" uuid,
	"contributor_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_game_ids_pkey" PRIMARY KEY("kind","value"),
	CONSTRAINT "hub_game_ids_provenance_check" CHECK ("hub_game_ids"."provenance" in ('steam', 'igdb', 'itad', 'wikidata', 'manual', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "hub_crosswalk_conflicts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"existing_rl_game_id" text NOT NULL,
	"proposed_rl_game_id" text,
	"instance_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "hub_game_ids" ADD CONSTRAINT "hub_game_ids_rl_game_id_hub_games_rl_game_id_fk" FOREIGN KEY ("rl_game_id") REFERENCES "public"."hub_games"("rl_game_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_game_ids" ADD CONSTRAINT "hub_game_ids_first_contributor_instance_id_hub_instances_instance_id_fk" FOREIGN KEY ("first_contributor_instance_id") REFERENCES "public"."hub_instances"("instance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_crosswalk_conflicts" ADD CONSTRAINT "hub_crosswalk_conflicts_instance_id_hub_instances_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."hub_instances"("instance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hub_games_normalized_name_idx" ON "hub_games" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "hub_games_updated_seq_idx" ON "hub_games" USING btree ("updated_seq");--> statement-breakpoint
CREATE INDEX "hub_game_ids_rl_game_id_idx" ON "hub_game_ids" USING btree ("rl_game_id");--> statement-breakpoint
CREATE INDEX "hub_crosswalk_conflicts_open_idx" ON "hub_crosswalk_conflicts" USING btree ("kind","value") WHERE "hub_crosswalk_conflicts"."resolved_at" is null;