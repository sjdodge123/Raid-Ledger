CREATE TABLE "guild_editors" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"kind" varchar(10) NOT NULL,
	"rank_index" integer,
	"guild_member_id" integer,
	"granted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_editors_kind_target" CHECK (("guild_editors"."kind" = 'rank' AND "guild_editors"."rank_index" IS NOT NULL AND "guild_editors"."guild_member_id" IS NULL) OR ("guild_editors"."kind" = 'member' AND "guild_editors"."guild_member_id" IS NOT NULL AND "guild_editors"."rank_index" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "guild_editors" ADD CONSTRAINT "guild_editors_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_editors" ADD CONSTRAINT "guild_editors_guild_member_id_guild_members_id_fk" FOREIGN KEY ("guild_member_id") REFERENCES "public"."guild_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_editors" ADD CONSTRAINT "guild_editors_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guild_editors_guild_rank" ON "guild_editors" USING btree ("guild_id","rank_index") WHERE "guild_editors"."rank_index" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guild_editors_guild_member" ON "guild_editors" USING btree ("guild_id","guild_member_id") WHERE "guild_editors"."guild_member_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_guild_editors_guild_id" ON "guild_editors" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "idx_guild_editors_guild_member_id" ON "guild_editors" USING btree ("guild_member_id");--> statement-breakpoint
CREATE INDEX "idx_guild_editors_granted_by" ON "guild_editors" USING btree ("granted_by");