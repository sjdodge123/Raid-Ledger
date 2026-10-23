CREATE TABLE "hub_join_prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(12) NOT NULL,
	"source" varchar(8) NOT NULL,
	"source_ref" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "hub_join_prompts_kind_check" CHECK ("hub_join_prompts"."kind" IN ('suggest', 'auto-joined')),
	CONSTRAINT "hub_join_prompts_source_check" CHECK ("hub_join_prompts"."source" IN ('signup', 'vote'))
);
--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "auto_membership" varchar(8) DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_join_prompts" ADD CONSTRAINT "hub_join_prompts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_join_prompts" ADD CONSTRAINT "hub_join_prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_hub_join_prompts_guild_user" ON "hub_join_prompts" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_hub_join_prompts_user_id" ON "hub_join_prompts" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_auto_membership_check" CHECK ("guilds"."auto_membership" IN ('off', 'suggest', 'auto'));--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_auto_membership_kind_check" CHECK ("guilds"."kind" = 'game_community' OR "guilds"."auto_membership" = 'off');