CREATE TABLE "hub_notification_mutes" (
	"user_id" integer NOT NULL,
	"guild_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_notification_mutes_user_id_guild_id_pk" PRIMARY KEY("user_id","guild_id")
);
--> statement-breakpoint
ALTER TABLE "hub_notification_mutes" ADD CONSTRAINT "hub_notification_mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_notification_mutes" ADD CONSTRAINT "hub_notification_mutes_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hub_notification_mutes_guild_id" ON "hub_notification_mutes" USING btree ("guild_id");