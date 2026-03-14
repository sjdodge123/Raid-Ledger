CREATE TABLE "ai_request_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"feature" varchar(50) NOT NULL,
	"user_id" integer,
	"provider" varchar(50) NOT NULL,
	"model" varchar(100) NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"latency_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"error_message" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_request_logs" ADD CONSTRAINT "ai_request_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_request_logs_created_at" ON "ai_request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_request_logs_feature_created_at" ON "ai_request_logs" USING btree ("feature","created_at");