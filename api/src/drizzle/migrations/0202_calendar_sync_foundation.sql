CREATE TABLE "calendar_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" varchar(16) NOT NULL,
	"account_subject" varchar(255) NOT NULL,
	"account_label" varchar(255),
	"credentials_encrypted" text NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"last_error_code" varchar(64),
	"last_synced_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone,
	"sync_cursor" jsonb,
	"read_enabled" boolean DEFAULT false NOT NULL,
	"read_calendar_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"write_enabled" boolean DEFAULT false NOT NULL,
	"write_target" varchar(16) DEFAULT 'dedicated' NOT NULL,
	"dedicated_calendar_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connections_user_provider_subject_uq" UNIQUE("user_id","provider","account_subject"),
	CONSTRAINT "calendar_connections_provider_chk" CHECK ("calendar_connections"."provider" IN ('google','microsoft','apple')),
	CONSTRAINT "calendar_connections_status_chk" CHECK ("calendar_connections"."status" IN ('active','needs_reconnect','error','disconnecting')),
	CONSTRAINT "calendar_connections_write_target_chk" CHECK ("calendar_connections"."write_target" IN ('dedicated','primary'))
);
--> statement-breakpoint
CREATE TABLE "calendar_event_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"calendar_id" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"etag" text,
	"state" varchar(16) DEFAULT 'synced' NOT NULL,
	"last_error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_links_conn_event_user_uq" UNIQUE("connection_id","event_id","user_id"),
	CONSTRAINT "calendar_event_links_state_chk" CHECK ("calendar_event_links"."state" IN ('synced','failed','suppressed'))
);
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_connections_next_sync_idx" ON "calendar_connections" USING btree ("next_sync_at") WHERE "calendar_connections"."status" = 'active' AND "calendar_connections"."read_enabled";--> statement-breakpoint
CREATE INDEX "calendar_event_links_event_id_idx" ON "calendar_event_links" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "calendar_event_links_user_id_idx" ON "calendar_event_links" USING btree ("user_id");