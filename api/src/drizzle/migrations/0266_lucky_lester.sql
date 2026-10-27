ALTER TABLE "hub_media" DROP CONSTRAINT "hub_media_source_check";--> statement-breakpoint
ALTER TABLE "hub_media" DROP CONSTRAINT "hub_media_kind_check";--> statement-breakpoint
ALTER TABLE "hub_media" ADD COLUMN "uploaded_by" integer;--> statement-breakpoint
ALTER TABLE "hub_media" ADD CONSTRAINT "hub_media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hub_media_uploaded_by_idx" ON "hub_media" USING btree ("uploaded_by");--> statement-breakpoint
ALTER TABLE "hub_media" ADD CONSTRAINT "hub_media_source_check" CHECK ("hub_media"."source" IN ('discord', 'upload'));--> statement-breakpoint
ALTER TABLE "hub_media" ADD CONSTRAINT "hub_media_kind_check" CHECK ("hub_media"."kind" IN ('death', 'screenshot', 'image', 'upload'));