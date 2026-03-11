-- ROK-788 rework: Add event types for TBC Anniversary Edition.
-- The game was configured with has_roles/has_specs but had no event types,
-- so the event creation form showed no dungeon/raid options and no MMO roster.

INSERT INTO event_types (slug, name, default_player_cap, default_duration_minutes, requires_composition, game_id)
SELECT 'classic-25-raid', '25-Man Raid', 25, 180, true, g.id
FROM games g WHERE g.slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition'
ON CONFLICT (game_id, slug) DO NOTHING;

INSERT INTO event_types (slug, name, default_player_cap, default_duration_minutes, requires_composition, game_id)
SELECT 'classic-10-raid', '10-Man Raid', 10, 120, true, g.id
FROM games g WHERE g.slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition'
ON CONFLICT (game_id, slug) DO NOTHING;

INSERT INTO event_types (slug, name, default_player_cap, default_duration_minutes, requires_composition, game_id)
SELECT 'classic-dungeon', 'Dungeon', 5, 90, true, g.id
FROM games g WHERE g.slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition'
ON CONFLICT (game_id, slug) DO NOTHING;
