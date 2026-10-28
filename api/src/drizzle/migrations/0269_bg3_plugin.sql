CREATE TABLE "bg3_campaign_keys" (
	"user_id" integer NOT NULL,
	"campaign_key" char(64) NOT NULL,
	"campaign_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bg3_campaign_keys_user_id_campaign_key_pk" PRIMARY KEY("user_id","campaign_key"),
	CONSTRAINT "bg3_campaign_keys_key_chk" CHECK ("bg3_campaign_keys"."campaign_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "bg3_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"host_user_id" integer,
	"created_by_user_id" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bg3_hub_settings" (
	"guild_id" integer PRIMARY KEY NOT NULL,
	"hide_location_and_screenshots" boolean DEFAULT false NOT NULL,
	"active_campaign_id" integer,
	"updated_by_user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bg3_party_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"slot_key" varchar(160) NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bg3_user_defaults" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bg3_saves" (
	"id" serial PRIMARY KEY NOT NULL,
	"uploader_user_id" integer NOT NULL,
	"device_id" integer,
	"campaign_id" integer,
	"campaign_key" char(64) NOT NULL,
	"campaign_key_source" varchar(12) NOT NULL,
	"save_name" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"game_version" varchar(40) NOT NULL,
	"platform" varchar(32) NOT NULL,
	"current_level" varchar(64) NOT NULL,
	"difficulty" varchar(64) NOT NULL,
	"ruleset" varchar(64),
	"party" jsonb NOT NULL,
	"party_max_level" smallint NOT NULL,
	"thumbnail_sha256" char(64),
	"thumbnail_width" integer,
	"thumbnail_height" integer,
	"session_first_saved_at" timestamp with time zone,
	"session_save_count" integer,
	CONSTRAINT "bg3_saves_key_chk" CHECK ("bg3_saves"."campaign_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "bg3_saves_key_source_chk" CHECK ("bg3_saves"."campaign_key_source" IN ('save-folder', 'game-id')),
	CONSTRAINT "bg3_saves_thumbnail_sha_chk" CHECK ("bg3_saves"."thumbnail_sha256" IS NULL OR "bg3_saves"."thumbnail_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "bg3_campaign_keys" ADD CONSTRAINT "bg3_campaign_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_campaign_keys" ADD CONSTRAINT "bg3_campaign_keys_campaign_id_bg3_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bg3_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_campaigns" ADD CONSTRAINT "bg3_campaigns_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_campaigns" ADD CONSTRAINT "bg3_campaigns_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_campaigns" ADD CONSTRAINT "bg3_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_hub_settings" ADD CONSTRAINT "bg3_hub_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_hub_settings" ADD CONSTRAINT "bg3_hub_settings_active_campaign_id_bg3_campaigns_id_fk" FOREIGN KEY ("active_campaign_id") REFERENCES "public"."bg3_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_hub_settings" ADD CONSTRAINT "bg3_hub_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_party_claims" ADD CONSTRAINT "bg3_party_claims_campaign_id_bg3_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bg3_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_party_claims" ADD CONSTRAINT "bg3_party_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_user_defaults" ADD CONSTRAINT "bg3_user_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_user_defaults" ADD CONSTRAINT "bg3_user_defaults_campaign_id_bg3_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bg3_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_saves" ADD CONSTRAINT "bg3_saves_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_saves" ADD CONSTRAINT "bg3_saves_device_id_companion_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."companion_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg3_saves" ADD CONSTRAINT "bg3_saves_campaign_id_bg3_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bg3_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bg3_campaign_keys_campaign_id_idx" ON "bg3_campaign_keys" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "bg3_campaigns_guild_id_idx" ON "bg3_campaigns" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "bg3_campaigns_host_user_id_idx" ON "bg3_campaigns" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX "bg3_campaigns_created_by_user_id_idx" ON "bg3_campaigns" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "bg3_hub_settings_active_campaign_id_idx" ON "bg3_hub_settings" USING btree ("active_campaign_id");--> statement-breakpoint
CREATE INDEX "bg3_hub_settings_updated_by_user_id_idx" ON "bg3_hub_settings" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bg3_party_claims_campaign_slot_uq" ON "bg3_party_claims" USING btree ("campaign_id","slot_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bg3_party_claims_campaign_user_uq" ON "bg3_party_claims" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE INDEX "bg3_party_claims_user_id_idx" ON "bg3_party_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bg3_user_defaults_campaign_id_idx" ON "bg3_user_defaults" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bg3_saves_uploader_key_saved_at_uq" ON "bg3_saves" USING btree ("uploader_user_id","campaign_key","saved_at");--> statement-breakpoint
CREATE INDEX "bg3_saves_campaign_saved_at_idx" ON "bg3_saves" USING btree ("campaign_id","saved_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bg3_saves_device_id_idx" ON "bg3_saves" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "bg3_saves_uploader_thumbnail_idx" ON "bg3_saves" USING btree ("uploader_user_id","thumbnail_sha256");