CREATE TABLE "discord_game_role_grants" (
	"game_role_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"discord_user_id" varchar(32) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_game_role_grants_pk" PRIMARY KEY("game_role_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "discord_game_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"role_id" varchar(32) NOT NULL,
	"bot_created" boolean DEFAULT false NOT NULL,
	"window_days" integer DEFAULT 14 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_game_roles_game_id_unique" UNIQUE("game_id"),
	CONSTRAINT "discord_game_roles_window_days_range" CHECK ("discord_game_roles"."window_days" BETWEEN 1 AND 365)
);
--> statement-breakpoint
ALTER TABLE "discord_game_role_grants" ADD CONSTRAINT "discord_game_role_grants_game_role_id_discord_game_roles_id_fk" FOREIGN KEY ("game_role_id") REFERENCES "public"."discord_game_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_game_role_grants" ADD CONSTRAINT "discord_game_role_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_game_roles" ADD CONSTRAINT "discord_game_roles_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_discord_game_role_grants_user_id" ON "discord_game_role_grants" USING btree ("user_id");