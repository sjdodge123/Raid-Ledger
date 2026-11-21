CREATE TABLE "hub_forum_signup_line_states" (
	"thread_id" integer NOT NULL,
	"member_key" varchar(40) NOT NULL,
	"state" jsonb NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_forum_signup_line_states_thread_id_member_key_pk" PRIMARY KEY("thread_id","member_key")
);
--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD COLUMN "kind" varchar(16) DEFAULT 'reply' NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD COLUMN "subject_user_id" integer;--> statement-breakpoint
ALTER TABLE "hub_forum_signup_line_states" ADD CONSTRAINT "hub_forum_signup_line_states_thread_id_hub_forum_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."hub_forum_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hub_forum_replies_subject_user_id" ON "hub_forum_replies" USING btree ("subject_user_id");--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_kind" CHECK ("hub_forum_replies"."kind" IN ('reply', 'signup_line'));--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_line_no_author" CHECK ("hub_forum_replies"."kind" = 'reply' OR "hub_forum_replies"."author_id" IS NULL);