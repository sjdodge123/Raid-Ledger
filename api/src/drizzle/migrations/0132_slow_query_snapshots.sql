CREATE TABLE "slow_query_snapshot_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"queryid" bigint NOT NULL,
	"query_text" text NOT NULL,
	"calls" bigint NOT NULL,
	"mean_exec_time_ms" double precision NOT NULL,
	"total_exec_time_ms" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slow_query_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slow_query_snapshot_entries" ADD CONSTRAINT "slow_query_snapshot_entries_snapshot_id_slow_query_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."slow_query_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_slow_query_entries_snapshot_queryid" ON "slow_query_snapshot_entries" USING btree ("snapshot_id","queryid");
