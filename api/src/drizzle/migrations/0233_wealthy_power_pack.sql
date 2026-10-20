CREATE TABLE "valheim_pieces" (
	"set_id" integer NOT NULL,
	"prefab" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"tool" text NOT NULL,
	"station" text,
	"icon" jsonb,
	"resources" jsonb NOT NULL,
	CONSTRAINT "valheim_pieces_pk" PRIMARY KEY("set_id","prefab")
);
--> statement-breakpoint
CREATE TABLE "valheim_processes" (
	"set_id" integer NOT NULL,
	"ord" smallint NOT NULL,
	"processor" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"any_one_of" boolean NOT NULL,
	"output_prefab" text NOT NULL,
	"output_amount" integer NOT NULL,
	"seconds" double precision,
	"priority" integer NOT NULL,
	CONSTRAINT "valheim_processes_pk" PRIMARY KEY("set_id","ord")
);
--> statement-breakpoint
CREATE TABLE "valheim_processors" (
	"set_id" integer NOT NULL,
	"prefab" text NOT NULL,
	"type" text NOT NULL,
	"fuel" text,
	"fuel_per_product" integer,
	"fuel_seconds_per_unit" double precision,
	"wind_powered" boolean NOT NULL,
	"requires_roof" boolean NOT NULL,
	"max_input" integer,
	"burnt_result" text,
	"default_result" jsonb,
	CONSTRAINT "valheim_processors_pk" PRIMARY KEY("set_id","prefab"),
	CONSTRAINT "valheim_processors_type_chk" CHECK ("valheim_processors"."type" IN ('smelter','fermenter','cooking','incinerator'))
);
--> statement-breakpoint
CREATE TABLE "valheim_recipe_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"pelican_server_id" integer NOT NULL,
	"game_version" text NOT NULL,
	"locale" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"atlas_sha256" text,
	"atlas_width" integer,
	"atlas_height" integer,
	"source_snapshot_id" bigint,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valheim_recipe_sets_version_uq" UNIQUE("pelican_server_id","game_version")
);
--> statement-breakpoint
CREATE TABLE "valheim_recipe_stations" (
	"set_id" integer NOT NULL,
	"prefab" text NOT NULL,
	"name" text NOT NULL,
	"max_level" smallint NOT NULL,
	"stackable_extension" boolean NOT NULL,
	"upgrader" boolean DEFAULT false NOT NULL,
	"icon" jsonb,
	CONSTRAINT "valheim_recipe_stations_pk" PRIMARY KEY("set_id","prefab")
);
--> statement-breakpoint
CREATE TABLE "valheim_recipes" (
	"set_id" integer NOT NULL,
	"recipe_id" text NOT NULL,
	"result" text NOT NULL,
	"amount" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"station" text,
	"repair_station" text,
	"min_station_level" smallint NOT NULL,
	"upgrade_only" boolean NOT NULL,
	"any_one_of" boolean NOT NULL,
	"quality_result_amount_multiplier" double precision NOT NULL,
	"formula" text NOT NULL,
	"resources" jsonb NOT NULL,
	CONSTRAINT "valheim_recipes_pk" PRIMARY KEY("set_id","recipe_id"),
	CONSTRAINT "valheim_recipes_formula_chk" CHECK ("valheim_recipes"."formula" IN ('vanilla','custom'))
);
--> statement-breakpoint
ALTER TABLE "valheim_link_snapshots" DROP CONSTRAINT "valheim_link_snapshots_kind_chk";--> statement-breakpoint
ALTER TABLE "valheim_pieces" ADD CONSTRAINT "valheim_pieces_set_id_valheim_recipe_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."valheim_recipe_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_processes" ADD CONSTRAINT "valheim_processes_set_id_valheim_recipe_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."valheim_recipe_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_processors" ADD CONSTRAINT "valheim_processors_set_id_valheim_recipe_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."valheim_recipe_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_recipe_sets" ADD CONSTRAINT "valheim_recipe_sets_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_recipe_sets" ADD CONSTRAINT "valheim_recipe_sets_source_snapshot_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."valheim_link_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_recipe_stations" ADD CONSTRAINT "valheim_recipe_stations_set_id_valheim_recipe_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."valheim_recipe_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_recipes" ADD CONSTRAINT "valheim_recipes_set_id_valheim_recipe_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."valheim_recipe_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valheim_processes_set_output_idx" ON "valheim_processes" USING btree ("set_id","output_prefab");--> statement-breakpoint
CREATE INDEX "valheim_recipe_sets_server_captured_idx" ON "valheim_recipe_sets" USING btree ("pelican_server_id","captured_at");--> statement-breakpoint
CREATE INDEX "valheim_recipe_sets_source_snapshot_idx" ON "valheim_recipe_sets" USING btree ("source_snapshot_id");--> statement-breakpoint
CREATE INDEX "valheim_recipes_set_result_idx" ON "valheim_recipes" USING btree ("set_id","result");--> statement-breakpoint
ALTER TABLE "valheim_link_snapshots" ADD CONSTRAINT "valheim_link_snapshots_kind_chk" CHECK ("valheim_link_snapshots"."kind" IN ('character','map','items','containers','recipes'));