CREATE TABLE "companion_blob_refs" (
	"user_id" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"contract" text NOT NULL,
	"byte_length" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"referenced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companion_blob_refs_user_id_sha256_contract_pk" PRIMARY KEY("user_id","sha256","contract")
);
--> statement-breakpoint
CREATE TABLE "companion_blobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"byte_length" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"content_type" text DEFAULT 'image/webp' NOT NULL,
	"storage_path" text NOT NULL,
	"device_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companion_blobs_sha256_chk" CHECK ("companion_blobs"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "companion_blobs_content_type_chk" CHECK ("companion_blobs"."content_type" = 'image/webp')
);
--> statement-breakpoint
CREATE TABLE "companion_ingest_latest" (
	"user_id" integer NOT NULL,
	"contract" text NOT NULL,
	"latest_key" text NOT NULL,
	"latest_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companion_ingest_latest_user_id_contract_latest_key_pk" PRIMARY KEY("user_id","contract","latest_key"),
	CONSTRAINT "companion_ingest_latest_key_len_chk" CHECK (char_length("companion_ingest_latest"."latest_key") <= 128)
);
--> statement-breakpoint
ALTER TABLE "companion_blob_refs" ADD CONSTRAINT "companion_blob_refs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_blobs" ADD CONSTRAINT "companion_blobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_blobs" ADD CONSTRAINT "companion_blobs_device_id_companion_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."companion_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_ingest_latest" ADD CONSTRAINT "companion_ingest_latest_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companion_blobs_user_sha_uq" ON "companion_blobs" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE INDEX "companion_blobs_created_at_idx" ON "companion_blobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "companion_blobs_device_id_idx" ON "companion_blobs" USING btree ("device_id");