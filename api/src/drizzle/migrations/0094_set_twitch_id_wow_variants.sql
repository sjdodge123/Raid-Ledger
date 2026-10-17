-- Set twitch_game_id on all WoW variant game rows so Twitch streams
-- appear on every variant's game detail page.
-- Twitch uses a single "World of Warcraft" category (ID 18122) for all variants.
--
-- Rollback: UPDATE games SET twitch_game_id = NULL WHERE slug IN (...) AND twitch_game_id = '18122';

UPDATE games
SET twitch_game_id = '18122'
WHERE slug IN (
  'world-of-warcraft-burning-crusade-classic-anniversary-edition',
  'world-of-warcraft-burning-crusade-classic',
  'world-of-warcraft-wrath-of-the-lich-king',
  'world-of-warcraft-wrath-of-the-lich-king-classic',
  'world-of-warcraft-cataclysm-classic',
  'world-of-warcraft-mists-of-pandaria-classic',
  'world-of-warcraft-classic-season-of-discovery',
  'world-of-warcraft-the-war-within',
  'world-of-warcraft-dragonflight',
  'world-of-warcraft-shadowlands',
  'world-of-warcraft-midnight',
  'world-of-warcraft-the-last-titan'
)
AND (twitch_game_id IS NULL OR twitch_game_id = '');
