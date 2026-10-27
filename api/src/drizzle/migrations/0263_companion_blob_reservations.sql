CREATE TABLE "companion_blob_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companion_blob_reservations_bytes_chk" CHECK ("companion_blob_reservations"."bytes" > 0)
);
--> statement-breakpoint
CREATE INDEX "companion_blob_reservations_created_at_idx" ON "companion_blob_reservations" USING btree ("created_at");