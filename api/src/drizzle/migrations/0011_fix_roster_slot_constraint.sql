-- M1 Fix: Add partial unique constraint on role+position per event
-- This prevents race conditions where two users could be assigned to the same slot
-- Only applies when role is not null (generic events don't have role slots)

CREATE UNIQUE INDEX IF NOT EXISTS "unique_slot_per_event" 
ON "roster_assignments" ("event_id", "role", "position") 
WHERE "role" IS NOT NULL;
