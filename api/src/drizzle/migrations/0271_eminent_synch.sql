ALTER TABLE "hub_media" DROP CONSTRAINT "hub_media_source_check";--> statement-breakpoint
ALTER TABLE "hub_media" DROP CONSTRAINT "hub_media_kind_check";--> statement-breakpoint
ALTER TABLE "hub_media" ADD CONSTRAINT "hub_media_source_check" CHECK ("hub_media"."source" IN ('discord', 'upload', 'bg3-save'));--> statement-breakpoint
ALTER TABLE "hub_media" ADD CONSTRAINT "hub_media_kind_check" CHECK ("hub_media"."kind" IN ('death', 'screenshot', 'image', 'upload', 'save'));