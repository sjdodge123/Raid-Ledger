ALTER TABLE "hub_forum_replies" DROP CONSTRAINT "hub_forum_replies_kind";--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD COLUMN "copied_from_reply_id" integer;--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD COLUMN "copied_from_thread_id" integer;--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_copied_from_reply_id_hub_forum_replies_id_fk" FOREIGN KEY ("copied_from_reply_id") REFERENCES "public"."hub_forum_replies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_copied_from_thread_id_hub_forum_threads_id_fk" FOREIGN KEY ("copied_from_thread_id") REFERENCES "public"."hub_forum_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hub_forum_replies_copy" ON "hub_forum_replies" USING btree ("thread_id","copied_from_reply_id") WHERE "hub_forum_replies"."copied_from_reply_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hub_forum_replies_copy_header" ON "hub_forum_replies" USING btree ("thread_id","copied_from_thread_id") WHERE "hub_forum_replies"."kind" = 'copy_header';--> statement-breakpoint
CREATE INDEX "idx_hub_forum_replies_copied_from_reply_id" ON "hub_forum_replies" USING btree ("copied_from_reply_id");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_replies_copied_from_thread_id" ON "hub_forum_replies" USING btree ("copied_from_thread_id");--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_kind" CHECK ("hub_forum_replies"."kind" IN ('reply', 'signup_line', 'copy_header'));