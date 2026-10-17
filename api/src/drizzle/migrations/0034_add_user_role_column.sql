-- AC-1: Add role column to users table, migrate from is_admin boolean
-- Step 1: Add role varchar column with default 'member'
ALTER TABLE "users" ADD COLUMN "role" varchar(20) NOT NULL DEFAULT 'member';

-- Step 2: Migrate existing admin users
UPDATE "users" SET "role" = 'admin' WHERE "is_admin" = true;

-- Step 3: Drop the is_admin column
ALTER TABLE "users" DROP COLUMN "is_admin";
