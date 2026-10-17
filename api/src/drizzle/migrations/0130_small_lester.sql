CREATE TABLE "community_insights_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" date NOT NULL,
	"radar_payload" jsonb NOT NULL,
	"engagement_payload" jsonb NOT NULL,
	"churn_payload" jsonb NOT NULL,
	"social_graph_payload" jsonb NOT NULL,
	"temporal_payload" jsonb NOT NULL,
	"key_insights_payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "community_insights_snapshots_snapshot_date_unique" UNIQUE("snapshot_date")
);
--> statement-breakpoint
CREATE INDEX "idx_community_insights_snapshots_created_at" ON "community_insights_snapshots" USING btree ("created_at");