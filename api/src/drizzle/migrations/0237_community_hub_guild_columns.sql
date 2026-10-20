CREATE TABLE "hub_community_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(8) NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"removed_by" integer,
	"banned_at" timestamp with time zone,
	"banned_by" integer,
	"ban_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_community_members_role_check" CHECK ("hub_community_members"."role" IN ('leader', 'officer', 'member'))
);
--> statement-breakpoint
ALTER TABLE "guilds" DROP CONSTRAINT "guilds_kind_check";--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "status" varchar(10) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "blurb" varchar(280);--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "proposed_by" integer;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "reviewed_by" integer;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "archived_reason" varchar(10);--> statement-breakpoint
ALTER TABLE "hub_community_members" ADD CONSTRAINT "hub_community_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_community_members" ADD CONSTRAINT "hub_community_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_community_members" ADD CONSTRAINT "hub_community_members_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_community_members" ADD CONSTRAINT "hub_community_members_banned_by_users_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_hub_community_members_guild_user" ON "hub_community_members" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_hub_community_one_leader" ON "hub_community_members" USING btree ("guild_id") WHERE "hub_community_members"."role" = 'leader' AND "hub_community_members"."left_at" IS NULL AND "hub_community_members"."banned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_hub_community_members_user_id" ON "hub_community_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_hub_community_members_removed_by" ON "hub_community_members" USING btree ("removed_by");--> statement-breakpoint
CREATE INDEX "idx_hub_community_members_banned_by" ON "hub_community_members" USING btree ("banned_by");--> statement-breakpoint
CREATE INDEX "idx_hub_community_members_live" ON "hub_community_members" USING btree ("guild_id") WHERE "hub_community_members"."left_at" IS NULL AND "hub_community_members"."banned_at" IS NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guilds_community_name" ON "guilds" USING btree ("game_id","name_key") WHERE "guilds"."kind" = 'game_community' AND "guilds"."status" <> 'archived';--> statement-breakpoint
CREATE INDEX "idx_guilds_proposed_by" ON "guilds" USING btree ("proposed_by");--> statement-breakpoint
CREATE INDEX "idx_guilds_reviewed_by" ON "guilds" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX "idx_guilds_kind_status" ON "guilds" USING btree ("kind","status");--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_status_check" CHECK ("guilds"."status" IN ('proposed', 'active', 'archived'));--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_status_kind_check" CHECK ("guilds"."status" = 'active' OR "guilds"."kind" = 'game_community');--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_community_server_check" CHECK ("guilds"."kind" <> 'game_community' OR "guilds"."pelican_server_id" IS NULL);--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_kind_check" CHECK ("guilds"."kind" IN ('wow_guild', 'game_server', 'game_community'));