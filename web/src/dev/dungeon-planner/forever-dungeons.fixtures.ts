/**
 * ROK-2207 prototype — the WoW: Forever dungeon list (audit
 * `story-notes/ROK-2207-forever-dungeon-audit.md` §a). Forever versions only:
 * Classic dungeons keep their counterpart id (quests, boss rows and saved
 * events key on it) but are labelled "Forever"; Scarlet Halls is out, Upper
 * Blackrock Spire is in. Level ranges are NOT verified for Forever yet.
 * BUILD: read the variant-aware instance catalogue — one table everywhere.
 */
import type { WowInstanceDto } from '@raid-ledger/contract';
import { getWowVariantIntegrations } from '../../plugins/wow/lib/wow-variant-config';

export const DALARAN_ID = 90000004;
export const SFK_ID = 64;
/** Upper Blackrock Spire has no counterpart id today (audit §a) — placeholder. */
export const UBRS_PLACEHOLDER_ID = 90000098;

type Row = [id: number, name: string, min: number, max: number, zone: number];

const ROWS: Row[] = [
    [226, 'Ragefire Chasm', 13, 18, 2437], [240, 'Wailing Caverns', 17, 24, 718],
    [63, 'The Deadmines', 17, 26, 1581], [SFK_ID, 'Shadowfang Keep', 22, 30, 209],
    [238, 'The Stockade', 22, 30, 717], [227, 'Blackfathom Deeps', 24, 32, 719],
    [231, 'Gnomeregan', 29, 38, 721], [234, 'Razorfen Kraul', 30, 40, 1717],
    [31601, 'Scarlet Monastery: Graveyard', 26, 32, 796], [31602, 'Scarlet Monastery: Library', 29, 33, 796],
    [31603, 'Scarlet Monastery: Armory', 32, 36, 796], [31604, 'Scarlet Monastery: Cathedral', 34, 40, 796],
    [233, 'Razorfen Downs', 40, 50, 722], [239, 'Uldaman', 42, 52, 1517], [241, "Zul'Farrak", 44, 54, 1176],
    [23201, 'Maraudon: Wicked Grotto', 40, 49, 2100], [23202, 'Maraudon: Foulspore Cavern', 40, 49, 2100],
    [23203, 'Maraudon: Earth Song Falls', 46, 55, 2100], [237, "The Temple of Atal'Hakkar", 50, 56, 1477],
    [228, 'Blackrock Depths', 52, 60, 1584], [229, 'Lower Blackrock Spire', 55, 60, 1583],
    [UBRS_PLACEHOLDER_ID, 'Upper Blackrock Spire', 55, 60, 1583],
    [230, 'Dire Maul: West', 55, 60, 2557], [1276, 'Dire Maul: East', 55, 60, 2557], [1277, 'Dire Maul: North', 55, 60, 2557],
    [236, 'Stratholme: Live', 58, 60, 2017], [1292, 'Stratholme: Undead', 58, 60, 2017], [246, 'Scholomance', 58, 60, 2057],
    // Forever-new dungeons (seed ids). The two Forever raids are listed separately, not here.
    [90000001, 'The Hall of Thanes', 13, 18, 16919], [90000002, 'Ruins of Lordaeron', 15, 20, 16611],
    [90000003, 'Excavation Site: Wetlands', 24, 29, 16732], [DALARAN_ID, 'City of Dalaran', 28, 33, 16544],
    [90000005, 'The Drowned City', 35, 40, 16550], [90000006, "Krol'dok Stronghold", 40, 45, 16842],
    [90000007, 'Alcaz Prison', 48, 53, 16620], [90000008, 'Blackmaw Hold', 55, 60, 16554],
    [90000009, "The Shaper's Terrace", 58, 60, 16985],
];

/** The Forever dungeon picker's rows, sorted by minimum level. */
export const INSTANCES: WowInstanceDto[] = ROWS
    .map(([id, name, min, max]) => ({ id, name, expansion: 'Forever', minimumLevel: min, maximumLevel: max }))
    .sort((a, b) => a.minimumLevel - b.minimumLevel || a.name.localeCompare(b.name));

/** Hand-kept instanceId → Wowhead zone id (the audit's "Forever area" column; OQ7 ruling). */
export const WOWHEAD_ZONE_IDS: Readonly<Record<number, number>> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));

/** The dungeon's Wowhead zone page on Wowhead's Forever environment, or null without a zone id. */
export function wowheadZoneUrl(instanceId: number): string | null {
    const zone = WOWHEAD_ZONE_IDS[instanceId];
    const base = getWowVariantIntegrations('wow_forever')?.wowhead.urlBase ?? 'www.wowhead.com';
    return zone == null ? null : `https://${base}/zone=${zone}`;
}

/** Look up a Forever dungeon by id. */
export function instanceById(id: number): WowInstanceDto | undefined {
    return INSTANCES.find((i) => i.id === id);
}
