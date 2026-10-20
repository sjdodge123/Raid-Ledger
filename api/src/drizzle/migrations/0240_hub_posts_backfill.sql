-- ROK-1868: copy each guild's legacy GM post (guild_profiles.gm_post) into
-- hub_posts as that hub's first post. Self-contained; the NOT EXISTS makes a
-- re-run harmless (a guild that already has a post is skipped).
-- Author = the GM post's last editor (gm_post_updated_by) — the only author
-- the legacy column recorded. updated_by stays NULL (not "Edited").
-- The text is copied verbatim — not escaped, not validated (spec A7: the
-- renderer is the safety boundary for legacy plain text). The gm_post*
-- columns are kept (A3).
-- Blank = only whitespace of ANY kind (space, tab, CR, LF, ...), matching the
-- app's JS trim(); btrim() with one argument strips spaces only.
INSERT INTO "hub_posts" ("guild_id", "body", "author_id", "created_at", "updated_at", "updated_by")
SELECT gp."guild_id", gp."gm_post", gp."gm_post_updated_by",
       COALESCE(gp."gm_post_updated_at", gp."updated_at"),
       COALESCE(gp."gm_post_updated_at", gp."updated_at"),
       NULL
FROM "guild_profiles" gp
WHERE gp."gm_post" IS NOT NULL AND gp."gm_post" !~ '^[[:space:]]*$'
  AND NOT EXISTS (SELECT 1 FROM "hub_posts" hp WHERE hp."guild_id" = gp."guild_id");
