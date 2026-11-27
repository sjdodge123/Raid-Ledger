CREATE TABLE "wow_lfg_hand_details" (
	"intent_id" integer PRIMARY KEY NOT NULL,
	"roles" text[] NOT NULL,
	"character_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wow_lfg_hand_details_roles_check" CHECK ("wow_lfg_hand_details"."roles" <@ ARRAY['tank', 'healer', 'dps']::text[] AND cardinality("wow_lfg_hand_details"."roles") between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "wow_lfg_hand_details" ADD CONSTRAINT "wow_lfg_hand_details_intent_id_lfg_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."lfg_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wow_lfg_hand_details" ADD CONSTRAINT "wow_lfg_hand_details_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wow_lfg_hand_details_character_id" ON "wow_lfg_hand_details" USING btree ("character_id");