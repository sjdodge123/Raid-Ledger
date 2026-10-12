CREATE TABLE "calendar_ignored_days" (
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_ignored_days_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "game_time_absences" ADD COLUMN "source" varchar(16) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_time_absences" ADD COLUMN "calendar_connection_id" integer;--> statement-breakpoint
ALTER TABLE "calendar_ignored_days" ADD CONSTRAINT "calendar_ignored_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_time_absences" ADD CONSTRAINT "game_time_absences_cal_conn_fk" FOREIGN KEY ("calendar_connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_time_absences_calendar_connection_id_idx" ON "game_time_absences" USING btree ("calendar_connection_id");--> statement-breakpoint
ALTER TABLE "game_time_absences" ADD CONSTRAINT "game_time_absences_source_chk" CHECK ("game_time_absences"."source" IN ('manual', 'calendar'));--> statement-breakpoint
ALTER TABLE "game_time_absences" ADD CONSTRAINT "game_time_absences_source_conn_chk" CHECK (("game_time_absences"."source" = 'calendar') = ("game_time_absences"."calendar_connection_id" IS NOT NULL));