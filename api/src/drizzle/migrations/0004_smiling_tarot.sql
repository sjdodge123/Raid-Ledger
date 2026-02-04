CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"realm" varchar(100),
	"class" varchar(50),
	"spec" varchar(50),
	"role" varchar(20),
	"is_main" boolean DEFAULT false NOT NULL,
	"item_level" integer,
	"external_id" varchar(255),
	"avatar_url" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_user_game_character" UNIQUE("user_id","game_id","name","realm")
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_game_id_game_registry_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_one_main_per_game" ON "characters" USING btree ("user_id","game_id") WHERE "characters"."is_main" = true;--> statement-breakpoint
CREATE INDEX "idx_characters_user_id" ON "characters" USING btree ("user_id");