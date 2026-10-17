import { describe, it, expect } from "vitest";
import {
    isEmptyTasteProfile,
    axisLabel,
    composeArchetypeLabel,
    formatFocusIndicator,
    formatIntensity,
    topAxes,
} from "./taste-profile-helpers";
import {
    TASTE_PROFILE_AXIS_POOL,
    type ArchetypeDto,
    type TasteProfileResponseDto,
} from "@raid-ledger/contract";

function zeroPool(): TasteProfileResponseDto["dimensions"] {
    const dims: Record<string, number> = {};
    for (const axis of TASTE_PROFILE_AXIS_POOL) dims[axis] = 0;
    return dims as TasteProfileResponseDto["dimensions"];
}

function makeArchetype(overrides?: Partial<ArchetypeDto>): ArchetypeDto {
    return {
        intensityTier: "Casual",
        vectorTitles: [],
        descriptions: { tier: "Drops in once or twice a week", titles: [] },
        ...overrides,
    };
}

function makeProfile(
    overrides?: Partial<Record<string, number>>,
): TasteProfileResponseDto {
    const dims = { ...zeroPool(), ...overrides } as Record<string, number>;
    return {
        userId: 42,
        dimensions: dims as TasteProfileResponseDto["dimensions"],
        intensityMetrics: {
            intensity: 0,
            focus: 0,
            breadth: 0,
            consistency: 0,
        },
        archetype: makeArchetype(),
        coPlayPartners: [],
        computedAt: "2026-04-16T00:00:00.000Z",
    };
}

describe("isEmptyTasteProfile", () => {
    it("returns true when every pool dimension is zero", () => {
        expect(isEmptyTasteProfile(makeProfile())).toBe(true);
    });

    it("returns false when any pool dimension is non-zero", () => {
        expect(isEmptyTasteProfile(makeProfile({ co_op: 5 }))).toBe(false);
        expect(isEmptyTasteProfile(makeProfile({ mmo: 1 }))).toBe(false);
        expect(isEmptyTasteProfile(makeProfile({ horror: 42 }))).toBe(false);
    });
});

describe("axisLabel", () => {
    it("returns a non-empty label for every pool axis", () => {
        for (const axis of TASTE_PROFILE_AXIS_POOL) {
            const label = axisLabel(axis);
            expect(label).toBeTruthy();
            expect(label.length).toBeGreaterThan(0);
        }
    });

    it("maps core axes to their display labels", () => {
        expect(axisLabel("co_op")).toBe("Co-op");
        expect(axisLabel("pvp")).toBe("PvP");
        expect(axisLabel("rpg")).toBe("RPG");
        expect(axisLabel("battle_royale")).toBe("Battle Royale");
        expect(axisLabel("sci_fi")).toBe("Sci-Fi");
    });
});

describe("topAxes", () => {
    it("returns the top 7 axes sorted by value descending", () => {
        const profile = makeProfile({
            shooter: 100,
            pvp: 90,
            battle_royale: 80,
            adventure: 70,
            co_op: 60,
            fantasy: 55,
            rpg: 40,
            survival: 20,
        });
        const result = topAxes(profile.dimensions, 7);
        expect(result.map((r) => r.axis)).toEqual([
            "shooter",
            "pvp",
            "battle_royale",
            "adventure",
            "co_op",
            "fantasy",
            "rpg",
        ]);
    });

    it("defaults to 7 when n is not provided", () => {
        const profile = makeProfile({ shooter: 90, pvp: 80, co_op: 70 });
        expect(topAxes(profile.dimensions)).toHaveLength(7);
    });

    it("returns all pool entries when n is larger than pool", () => {
        const profile = makeProfile({ shooter: 10 });
        expect(topAxes(profile.dimensions, 99)).toHaveLength(
            TASTE_PROFILE_AXIS_POOL.length,
        );
    });

    it("returns deterministic order for all-zero profiles", () => {
        const profile = makeProfile();
        const result = topAxes(profile.dimensions, 7);
        expect(result).toHaveLength(7);
        for (const entry of result) expect(entry.value).toBe(0);
    });
});

describe("formatFocusIndicator", () => {
    it("returns 'Focused play' when focus is > 60", () => {
        expect(formatFocusIndicator(75, 10)).toBe("Focused play (75%)");
    });

    it("returns 'Varied play' when breadth is > 60 and focus is not", () => {
        expect(formatFocusIndicator(30, 72)).toBe("Varied play (72%)");
    });

    it("prefers 'Focused play' when both are > 60", () => {
        expect(formatFocusIndicator(80, 70)).toBe("Focused play (80%)");
    });

    it("returns null when neither crosses the threshold", () => {
        expect(formatFocusIndicator(60, 60)).toBeNull();
        expect(formatFocusIndicator(0, 0)).toBeNull();
        expect(formatFocusIndicator(50, 55)).toBeNull();
    });
});

describe("formatIntensity", () => {
    it("formats intensity as an /100 score", () => {
        expect(formatIntensity(0)).toBe("Intensity: 0/100");
        expect(formatIntensity(82)).toBe("Intensity: 82/100");
    });
});

describe("composeArchetypeLabel", () => {
    it("returns '{Tier} Player' when there are no vector titles", () => {
        const archetype = makeArchetype({
            intensityTier: "Hardcore",
            vectorTitles: [],
        });
        expect(composeArchetypeLabel(archetype)).toBe("Hardcore Player");
    });

    it("returns '{Tier} {Title}' for one vector title", () => {
        const archetype = makeArchetype({
            intensityTier: "Hardcore",
            vectorTitles: ["Raider"],
            descriptions: {
                tier: "Plays nearly daily, many hours per week",
                titles: ["MMO group content is home base"],
            },
        });
        expect(composeArchetypeLabel(archetype)).toBe("Hardcore Raider");
    });

    it("returns '{Tier} {Title1} & {Title2}' for two vector titles", () => {
        const archetype = makeArchetype({
            intensityTier: "Hardcore",
            vectorTitles: ["Hero", "Raider"],
            descriptions: {
                tier: "Plays nearly daily, many hours per week",
                titles: [
                    "Drawn to story-driven RPGs and fantasy worlds",
                    "MMO group content is home base",
                ],
            },
        });
        expect(composeArchetypeLabel(archetype)).toBe(
            "Hardcore Hero & Raider",
        );
    });

    it("composes labels for non-hardcore tiers", () => {
        const dedicated = makeArchetype({
            intensityTier: "Dedicated",
            vectorTitles: ["Duelist"],
        });
        expect(composeArchetypeLabel(dedicated)).toBe("Dedicated Duelist");

        const casual = makeArchetype({
            intensityTier: "Casual",
            vectorTitles: [],
        });
        expect(composeArchetypeLabel(casual)).toBe("Casual Player");
    });
});
