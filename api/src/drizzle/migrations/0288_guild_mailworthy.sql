CREATE TABLE "guild_mailworthy_givers" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"name_key" varchar(100) NOT NULL,
	"character_name" varchar(100) NOT NULL,
	"items_all_time" integer NOT NULL,
	"counting_since" timestamp with time zone NOT NULL,
	"days" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"reported_by_user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_guild_mailworthy_givers_guild_name" UNIQUE("guild_id","name_key")
);
--> statement-breakpoint
CREATE TABLE "guild_mailworthy_peers" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"name_key" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_guild_mailworthy_peers_guild_name" UNIQUE("guild_id","name_key")
);
--> statement-breakpoint
CREATE TABLE "guild_mailworthy_templates" (
	"guild_id" integer PRIMARY KEY NOT NULL,
	"rev" bigint NOT NULL,
	"author_name" varchar(100) NOT NULL,
	"rules" jsonb NOT NULL,
	"reported_by_user_id" integer,
	"reported_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_mailworthy_givers" ADD CONSTRAINT "guild_mailworthy_givers_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_mailworthy_givers" ADD CONSTRAINT "guild_mailworthy_givers_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_mailworthy_peers" ADD CONSTRAINT "guild_mailworthy_peers_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_mailworthy_templates" ADD CONSTRAINT "guild_mailworthy_templates_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_mailworthy_templates" ADD CONSTRAINT "guild_mailworthy_templates_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guild_mailworthy_givers_reported_by" ON "guild_mailworthy_givers" USING btree ("reported_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_guild_mailworthy_peers_guild_seen" ON "guild_mailworthy_peers" USING btree ("guild_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_guild_mailworthy_templates_reported_by" ON "guild_mailworthy_templates" USING btree ("reported_by_user_id");