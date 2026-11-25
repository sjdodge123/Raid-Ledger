CREATE TABLE "hub_instances" (
	"instance_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text,
	"status" text NOT NULL,
	"trust_tier" text DEFAULT 'reader' NOT NULL,
	"version" text NOT NULL,
	"schema_version" integer NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "hub_instances_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "hub_instances_status_check" CHECK ("hub_instances"."status" in ('pending', 'approved', 'revoked', 'disconnected'))
);
