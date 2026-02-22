CREATE TABLE "wow_classic_boss_loot" (
	"id" serial PRIMARY KEY NOT NULL,
	"boss_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"item_name" varchar(255) NOT NULL,
	"slot" varchar(50),
	"quality" varchar(20) NOT NULL,
	"item_level" integer,
	"drop_rate" numeric(5, 4),
	"expansion" varchar(20) NOT NULL,
	"class_restrictions" jsonb,
	"icon_url" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_loot_boss_item_expansion" UNIQUE("boss_id","item_id","expansion")
);
--> statement-breakpoint
CREATE TABLE "wow_classic_bosses" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"order" integer NOT NULL,
	"expansion" varchar(20) NOT NULL,
	"sod_modified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_boss_instance_name_expansion" UNIQUE("instance_id","name","expansion")
);
--> statement-breakpoint
ALTER TABLE "wow_classic_boss_loot" ADD CONSTRAINT "wow_classic_boss_loot_boss_id_wow_classic_bosses_id_fk" FOREIGN KEY ("boss_id") REFERENCES "public"."wow_classic_bosses"("id") ON DELETE cascade ON UPDATE no action;