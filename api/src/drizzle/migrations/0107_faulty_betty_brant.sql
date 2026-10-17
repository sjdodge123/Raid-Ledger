CREATE TABLE "consumed_intent_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"consumed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "consumed_intent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "idx_consumed_intent_tokens_consumed_at" ON "consumed_intent_tokens" USING btree ("consumed_at");