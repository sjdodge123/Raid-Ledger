/**
 * The characters table carries TWO unique keys that include game_id. Game
 * merge helpers re-point characters between game rows and must detect a
 * collision on either one, so both share this join builder (ROK-1721).
 *
 *   1. unique_user_game_character       (user_id, game_id, name, realm)
 *   2. idx_characters_ruleset_identity  (game_id, region, lower(name))
 *                                       WHERE ruleset IS NOT NULL
 */
export function characterUniqueKeyJoin(l: string, r: string): string {
  const perUser = ['user_id', 'name', 'realm']
    .map((c) => `${l}.${c} IS NOT DISTINCT FROM ${r}.${c}`)
    .join(' AND ');
  const forever =
    `${l}.ruleset IS NOT NULL AND ${r}.ruleset IS NOT NULL` +
    ` AND ${l}.region = ${r}.region AND lower(${l}.name) = lower(${r}.name)`;
  return `((${perUser}) OR (${forever}))`;
}
