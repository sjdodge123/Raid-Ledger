// ROK-1944 — `portals` fixtures. Synthetic tags and ids only (CONTRACT §8). Imported by gen-valheim-link-fixtures.mjs.
export function portalsFixtures(header, worldUid) {
    const base = { ...header, kind: 'portals', worldUid, omitted: 0 };
    const portal = (prefab, x, y, z, tag) => ({ prefab, x, y, z, tag });
    const vanilla = {
        ...base,
        portals: [
            portal('portal_wood', -12.5, 33.25, 48, 'home'),
            portal('portal_wood', 1820.75, 41.5, -655, 'home'),
            portal('portal_wood', 410, 28, 902.25, 'swamp'),
            portal('portal_stone', -3100, 60.5, 2210.5, 'ashlands'),
            portal('portal_wood', 64, 30, 64, ''),
        ],
    };
    const modded = {
        ...base,
        capturedAt: '2026-10-17T20:25:00Z',
        portals: [
            portal('portal_wood', -12.5, 33.25, 48, 'home'),
            // AdvancedPortals / XPortal prefabs as the scan reports them (open set).
            portal('portal_blackmarble', 5020, 120, -4400.5, 'mistlands'),
            portal('portal_xportal_fixture', 900, null, 900, 'Hub Gate'),
        ],
        omitted: 2,
    };
    const valid = { 'portals-vanilla': vanilla, 'portals-modded': modded };
    const withPortal = (p) => ({ ...vanilla, portals: [p, vanilla.portals[2]] });
    const invalid = {
        'portals-duplicate-position': [{ ...vanilla, portals: [vanilla.portals[0], { ...vanilla.portals[0], tag: 'other' }] }, { path: 'portals.1', code: 'custom' }],
        'portals-tag-too-long': [withPortal(portal('portal_wood', 1, 1, 1, 'x'.repeat(65))), { path: 'portals.0.tag', code: 'too_big' }],
        'portals-coord-out-of-range': [withPortal(portal('portal_wood', 40_000, 1, 1, 'far')), { path: 'portals.0.x', code: 'too_big' }],
        'portals-missing-z': [withPortal({ prefab: 'portal_wood', x: 1, y: 1, tag: 'a' }), { path: 'portals.0.z', code: 'invalid_type' }],
        'portals-bad-prefab': [withPortal(portal('portal wood', 1, 1, 1, 'a')), { path: 'portals.0.prefab', code: 'invalid_format' }],
        'portals-unknown-key': [withPortal({ ...portal('portal_wood', 1, 1, 1, 'a'), target: 'home' }), { path: 'portals.0', code: 'unrecognized_keys' }],
        'portals-omitted-negative': [{ ...vanilla, omitted: -1 }, { path: 'omitted', code: 'too_small' }],
    };
    return { valid, invalid };
}
