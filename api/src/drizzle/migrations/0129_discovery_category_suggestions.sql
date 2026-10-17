CREATE TABLE "discovery_category_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"category_type" text NOT NULL,
	"theme_vector" vector(7) NOT NULL,
	"filter_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"candidate_game_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"population_strategy" text NOT NULL,
	"sort_order" integer DEFAULT 1000 NOT NULL,
	"expires_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_category_suggestions_category_type_check" CHECK ("category_type" IN ('seasonal','trend','community_pattern','event')),
	CONSTRAINT "discovery_category_suggestions_status_check" CHECK ("status" IN ('pending','approved','rejected','expired')),
	CONSTRAINT "discovery_category_suggestions_population_strategy_check" CHECK ("population_strategy" IN ('vector','fixed','hybrid'))
);
--> statement-breakpoint
ALTER TABLE "discovery_category_suggestions" ADD CONSTRAINT "discovery_category_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_category_status_idx" ON "discovery_category_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discovery_category_sort_idx" ON "discovery_category_suggestions" USING btree ("status","sort_order") WHERE "discovery_category_suggestions"."status" = 'approved';