CREATE TABLE "calendar_busy_blocks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"first_date" date,
	"last_date" date,
	CONSTRAINT "calendar_busy_blocks_range_chk" CHECK ("calendar_busy_blocks"."ends_at" > "calendar_busy_blocks"."starts_at"),
	CONSTRAINT "calendar_busy_blocks_all_day_dates_chk" CHECK ("calendar_busy_blocks"."all_day" = ("calendar_busy_blocks"."first_date" IS NOT NULL AND "calendar_busy_blocks"."last_date" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "read_access_granted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_busy_blocks" ADD CONSTRAINT "calendar_busy_blocks_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_busy_blocks" ADD CONSTRAINT "calendar_busy_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_busy_blocks_user_range_idx" ON "calendar_busy_blocks" USING btree ("user_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "calendar_busy_blocks_connection_id_idx" ON "calendar_busy_blocks" USING btree ("connection_id");