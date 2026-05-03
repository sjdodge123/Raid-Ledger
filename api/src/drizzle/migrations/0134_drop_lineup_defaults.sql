-- ROK-1060: Drop the per-community lineup phase duration defaults that the
-- removed admin "Lineup Defaults" panel managed. The runtime now uses the
-- hardcoded DEFAULT_DURATIONS constant (api/src/lineups/queue/
-- lineup-phase.constants.ts) when a per-lineup override is not supplied.
DELETE FROM app_settings
WHERE key IN (
  'lineup_default_building_hours',
  'lineup_default_voting_hours',
  'lineup_default_decided_hours'
);
