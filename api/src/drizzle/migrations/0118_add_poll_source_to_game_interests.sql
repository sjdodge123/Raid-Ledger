-- ROK-1031: Add 'poll' to the game_interests source CHECK constraint.
-- Allows auto-hearting games when voters are signed up from scheduling polls.
ALTER TABLE game_interests DROP CONSTRAINT IF EXISTS chk_game_interests_source;
ALTER TABLE game_interests ADD CONSTRAINT chk_game_interests_source
  CHECK (source = ANY(ARRAY['manual', 'discord', 'steam_library', 'steam_wishlist', 'poll']));
