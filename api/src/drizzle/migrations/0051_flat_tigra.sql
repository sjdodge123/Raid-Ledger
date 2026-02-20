ALTER TABLE "pug_slots" DROP CONSTRAINT "unique_event_pug";--> statement-breakpoint
ALTER TABLE "pug_slots" ALTER COLUMN "discord_username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pug_slots" ADD COLUMN "invite_code" varchar(8);--> statement-breakpoint
CREATE UNIQUE INDEX "unique_event_pug" ON "pug_slots" USING btree ("event_id","discord_username") WHERE "pug_slots"."discord_username" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_invite_code" ON "pug_slots" USING btree ("invite_code") WHERE "pug_slots"."invite_code" IS NOT NULL;