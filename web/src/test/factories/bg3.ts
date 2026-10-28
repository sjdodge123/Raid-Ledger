/**
 * ROK-1958 — anonymised BG3 fixtures (fake handles, no real names/guilds).
 * The party mirrors the contract fixture `act2-party-4p-summon`: four
 * level-8 members + one summon (Scratch). Every builder returns a value the
 * ROK-1957 contract schema accepts.
 */
import type {
    Bg3CampaignSummary,
    Bg3HubCampaignsResponse,
    Bg3MySave,
    Bg3MySavesResponse,
    Bg3PartyClaim,
    Bg3PartySlot,
    Bg3Session,
    Bg3SessionsResponse,
    Bg3Snapshot,
} from '@raid-ledger/contract';

export const BG3_HUB_ID = 7;
export const BG3_CAMPAIGN_ID = 11;
export const BG3_SAVE_KEY = 'a'.repeat(64);

export function buildBg3Claim(over: Partial<Bg3PartyClaim> = {}): Bg3PartyClaim {
    return { userId: 21, displayName: 'Moonwhisper', avatarUrl: null, ...over };
}

export function buildBg3CampaignSummary(over: Partial<Bg3CampaignSummary> = {}): Bg3CampaignSummary {
    return {
        id: BG3_CAMPAIGN_ID, name: 'Tactician run', hostUserId: 21, isActive: true,
        lastSavedAt: '2026-10-27T23:05:00.000Z', saveCount: 41, archivedAt: null, ...over,
    };
}

export function buildBg3CampaignsResponse(over: Partial<Bg3HubCampaignsResponse> = {}): Bg3HubCampaignsResponse {
    return {
        campaigns: [buildBg3CampaignSummary()],
        settings: { hideLocationAndScreenshots: false, activeCampaignId: BG3_CAMPAIGN_ID },
        canEdit: false,
        ...over,
    };
}

/** No campaign on the hub yet. */
export function buildBg3NoCampaignsResponse(): Bg3HubCampaignsResponse {
    return buildBg3CampaignsResponse({ campaigns: [], settings: { hideLocationAndScreenshots: false, activeCampaignId: null } });
}

export function buildBg3PartySlot(over: Partial<Bg3PartySlot> = {}): Bg3PartySlot {
    return {
        origin: 'Generic', race: 'Elf_WoodElf', level: 8, xpLevel: 5630, xpTotal: 35630,
        classes: [{ main: 'Barbarian', sub: 'BerserkerPath' }], isSummon: false,
        slotKey: 'Generic:Elf_WoodElf:1', claim: null, ...over,
    };
}

/** Four members (first one claimed by Moonwhisper) + the Scratch summon. */
export function buildBg3Party(): Bg3PartySlot[] {
    return [
        buildBg3PartySlot({ claim: buildBg3Claim() }),
        buildBg3PartySlot({
            origin: 'DogFamiliar_Scratch_Summon', race: 'Beast', level: 1, xpLevel: 0, xpTotal: 0,
            classes: [], isSummon: true, slotKey: null,
        }),
        buildBg3PartySlot({
            race: 'Human', xpLevel: 5590, xpTotal: 35590,
            classes: [{ main: 'Wizard', sub: 'NecromancySchool' }], slotKey: 'Generic:Human:1',
        }),
        buildBg3PartySlot({
            race: 'Duergar', xpLevel: 5390, xpTotal: 35390,
            classes: [{ main: 'Ranger', sub: 'GloomStalker' }, { main: 'Rogue', sub: 'Thief' }],
            slotKey: 'Generic:Duergar:1',
        }),
        buildBg3PartySlot({
            race: 'Tiefling_Asmodeus', classes: [{ main: 'Paladin', sub: 'Vengeance' }],
            slotKey: 'Generic:Tiefling_Asmodeus:1',
        }),
    ];
}

export function buildBg3Snapshot(over: Partial<Bg3Snapshot> = {}): Bg3Snapshot {
    return {
        empty: false, campaignId: BG3_CAMPAIGN_ID, saveId: 301, saveName: 'QuickSave_1',
        savedAt: '2026-10-27T23:05:00.000Z', receivedAt: '2026-10-27T23:05:09.000Z', uploaderUserId: 21,
        uploader: { userId: 21, displayName: 'Moonwhisper' },
        area: 'SCL_Main_A', difficulty: 'DifficultyHard', ruleset: 'RulesetLarian',
        gameVersion: '4.1.1.7631656', platform: 'Steam', party: buildBg3Party(),
        thumbnailUrl: `/plugins/bg3/hubs/${BG3_HUB_ID}/saves/301/thumbnail`, spoilersHidden: false, ...over,
    };
}

/** Spoilers on: area + thumbnail are null for everyone (ROK-1957 D-14). */
export function buildBg3HiddenSnapshot(): Bg3Snapshot {
    return buildBg3Snapshot({ area: null, thumbnailUrl: null, spoilersHidden: true });
}

export function buildBg3Session(over: Partial<Bg3Session> = {}): Bg3Session {
    return {
        startedAt: '2026-10-27T19:40:00.000Z', endedAt: '2026-10-27T23:05:00.000Z', saveCount: 14,
        partyLevelFrom: 7, partyLevelTo: 8, areas: ['WLD_Main_A', 'CRE_Main_A', 'SCL_Main_A'],
        lastSaveId: 301, thumbnailUrl: null, ...over,
    };
}

/** Newest first: a 14-save session, then a one-save session. */
export function buildBg3SessionsResponse(over: Partial<Bg3SessionsResponse> = {}): Bg3SessionsResponse {
    return {
        sessions: [
            buildBg3Session(),
            buildBg3Session({
                startedAt: '2026-10-24T12:00:00.000Z', endedAt: '2026-10-24T12:00:00.000Z', saveCount: 1,
                partyLevelFrom: 7, partyLevelTo: 7, areas: ['WLD_Main_A'], lastSaveId: 280,
            }),
        ],
        nextCursor: null,
        ...over,
    };
}

export function buildBg3MySave(over: Partial<Bg3MySave> = {}): Bg3MySave {
    return {
        id: 401, saveName: 'QuickSave_2', savedAt: '2026-10-26T20:00:00.000Z', campaignKey: BG3_SAVE_KEY,
        campaignKeySource: 'save-folder', campaignId: null, area: 'WLD_Main_A', thumbnailUrl: null, ...over,
    };
}

export function buildBg3MySavesResponse(over: Partial<Bg3MySavesResponse> = {}): Bg3MySavesResponse {
    return {
        saves: [buildBg3MySave(), buildBg3MySave({ id: 402, saveName: 'AutoSave_9', campaignKey: 'b'.repeat(64) })],
        nextCursor: null, defaultCampaignId: null, ...over,
    };
}
