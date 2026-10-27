CREATE TABLE "steam_app_achievements" (
	"app_id" integer NOT NULL,
	"api_name" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"global_pct" numeric(6, 3),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steam_app_achievements_app_id_api_name_pk" PRIMARY KEY("app_id","api_name")
);
--> statement-breakpoint
CREATE TABLE "steam_app_stats_apps" (
	"app_id" integer PRIMARY KEY NOT NULL,
	"achievement_count" integer DEFAULT 0 NOT NULL,
	"schema_status" varchar(10) NOT NULL,
	"schema_fetched_at" timestamp with time zone,
	CONSTRAINT "steam_app_stats_apps_schema_status_check" CHECK ("steam_app_stats_apps"."schema_status" IN ('ok', 'no_stats', 'error'))
);
--> statement-breakpoint
CREATE TABLE "steam_user_achievements" (
	"user_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"api_name" varchar(128) NOT NULL,
	"unlocked_at" timestamp with time zone,
	CONSTRAINT "steam_user_achievements_user_id_app_id_api_name_pk" PRIMARY KEY("user_id","app_id","api_name")
);
--> statement-breakpoint
CREATE TABLE "steam_user_app_stats" (
	"user_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"status" varchar(10) NOT NULL,
	"unlocked_count" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steam_user_app_stats_user_id_app_id_pk" PRIMARY KEY("user_id","app_id"),
	CONSTRAINT "steam_user_app_stats_status_check" CHECK ("steam_user_app_stats"."status" IN ('ok', 'private', 'not_owned', 'pending', 'unlinked', 'error'))
);
--> statement-breakpoint
ALTER TABLE "steam_app_achievements" ADD CONSTRAINT "steam_app_achievements_app_id_steam_app_stats_apps_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."steam_app_stats_apps"("app_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_user_achievements" ADD CONSTRAINT "steam_user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_user_app_stats" ADD CONSTRAINT "steam_user_app_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "steam_user_achievements_app_unlocked_idx" ON "steam_user_achievements" USING btree ("app_id","unlocked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "steam_user_app_stats_app_fetched_idx" ON "steam_user_app_stats" USING btree ("app_id","fetched_at");