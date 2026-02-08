ALTER TABLE "local_admins" RENAME TO "local_credentials";--> statement-breakpoint
ALTER TABLE "local_credentials" RENAME CONSTRAINT "local_admins_email_unique" TO "local_credentials_email_unique";--> statement-breakpoint
ALTER TABLE "local_credentials" RENAME CONSTRAINT "local_admins_user_id_users_id_fk" TO "local_credentials_user_id_users_id_fk";
