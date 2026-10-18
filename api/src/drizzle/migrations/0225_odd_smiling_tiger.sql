CREATE TABLE "hub_onboarding_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"guild_id" integer,
	"key" varchar(64) NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub_onboarding_dismissals" ADD CONSTRAINT "hub_onboarding_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_onboarding_dismissals" ADD CONSTRAINT "hub_onboarding_dismissals_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hub_onboarding_dismissals_user_guild_key_uq" ON "hub_onboarding_dismissals" USING btree ("user_id","guild_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_onboarding_dismissals_user_key_global_uq" ON "hub_onboarding_dismissals" USING btree ("user_id","key") WHERE "hub_onboarding_dismissals"."guild_id" is null;--> statement-breakpoint
CREATE INDEX "hub_onboarding_dismissals_guild_id_idx" ON "hub_onboarding_dismissals" USING btree ("guild_id");