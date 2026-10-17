CREATE TABLE IF NOT EXISTS "cron_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"plugin_slug" text,
	"cron_expression" text NOT NULL,
	"description" text,
	"paused" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cron_jobs_name_unique" UNIQUE("name")
);-->statement-breakpoint
CREATE TABLE IF NOT EXISTS "cron_job_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"cron_job_id" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"duration_ms" integer,
	"error" text,
	CONSTRAINT "cron_job_executions_cron_job_id_fkey" FOREIGN KEY ("cron_job_id") REFERENCES "cron_jobs"("id") ON DELETE CASCADE
);-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_job_executions_job_started_idx" ON "cron_job_executions" ("cron_job_id", "started_at");
