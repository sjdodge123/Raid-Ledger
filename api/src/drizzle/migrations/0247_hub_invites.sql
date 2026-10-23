CREATE TABLE "hub_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "hub_invites_token_unique" UNIQUE("token"),
	CONSTRAINT "hub_invites_max_uses_check" CHECK ("hub_invites"."max_uses" IS NULL OR "hub_invites"."max_uses" > 0)
);
--> statement-breakpoint
ALTER TABLE "hub_community_members" ADD COLUMN "join_source" varchar(10);--> statement-breakpoint
ALTER TABLE "hub_community_members" ADD COLUMN "invite_id" integer;--> statement-breakpoint
ALTER TABLE "hub_invites" ADD CONSTRAINT "hub_invites_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_invites" ADD CONSTRAINT "hub_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hub_invites_guild_id" ON "hub_invites" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "idx_hub_invites_created_by" ON "hub_invites" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_hub_invites_live_by_maker" ON "hub_invites" USING btree ("guild_id","created_by") WHERE "hub_invites"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "hub_community_members" ADD CONSTRAINT "hub_community_members_invite_id_hub_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."hub_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hub_community_members_invite_id" ON "hub_community_members" USING btree ("invite_id");--> statement-breakpoint
ALTER TABLE "hub_community_members" ADD CONSTRAINT "hub_community_members_join_source_check" CHECK ("hub_community_members"."join_source" IS NULL OR "hub_community_members"."join_source" IN ('manual', 'invite', 'auto', 'prompt'));