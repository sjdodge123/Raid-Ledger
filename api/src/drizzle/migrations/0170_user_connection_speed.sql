ALTER TABLE "users" ADD COLUMN "connection_downstream_mbps" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "connection_speed_source" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "connection_speed_measured_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "speed_test_consent_at" timestamp;