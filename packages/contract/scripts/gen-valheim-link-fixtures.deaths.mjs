// ROK-1931 — `character.deaths` + `deathCount` fixtures. Synthetic ids and
// coordinates only (CONTRACT §8). Imported by gen-valheim-link-fixtures.mjs.
export function deathsFixtures(characterVanilla) {
    const world = characterVanilla.character.worldUid;
    const death = (x, z, at, worldUid = world) => ({ worldUid, x, z, at });
    // Newest first; the second entry is on another world (single-player or a
    // different server) — schema-valid, the server ignores it.
    const deaths = [
        death(-412.5, 1210.25, '2026-10-17T20:05:12Z'),
        death(88, -96.75, '2026-10-16T18:40:00.5Z', '987654321'),
        death(1830.125, -655, '2026-10-15T21:02:33.125Z'),
    ];
    const valid = { 'character-deaths': { ...characterVanilla, deaths, deathCount: 7 } };
    const base = valid['character-deaths'];
    const withDeath = (d) => ({ ...base, deaths: [d, deaths[2]] });
    const invalid = {
        'character-deaths-duplicate-at': [{ ...base, deaths: [deaths[0], { ...deaths[2], at: deaths[0].at }] }, { path: 'deaths.1', code: 'custom' }],
        'character-deaths-after-captured': [withDeath(death(1, 1, '2026-10-17T20:15:00.001Z')), { path: 'deaths.0.at', code: 'custom' }],
        'character-deaths-coord-out-of-range': [withDeath(death(40_000, 1, deaths[0].at)), { path: 'deaths.0.x', code: 'too_big' }],
        'character-deaths-unknown-key': [withDeath({ ...deaths[0], y: 30 }), { path: 'deaths.0', code: 'unrecognized_keys' }],
        'character-death-count-negative': [{ ...base, deathCount: -1 }, { path: 'deathCount', code: 'too_small' }],
    };
    return { valid, invalid };
}
