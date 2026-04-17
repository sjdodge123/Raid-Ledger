import { describe, it, expect } from "vitest";
import {
    isEmptyTasteProfile,
    axisLabel,
    formatFocusIndicator,
    formatIntensity,
} from "./taste-profile-helpers";
import type { TasteProfileResponseDto } from "@raid-ledger/contract";

function makeProfile(
    overrides?: Partial<TasteProfileResponseDto["dimensions"]>,
): TasteProfileResponseDto {
    return {
        userId: 42,
        dimensions: {
            co_op: 0,
            pvp: 0,
            rpg: 0,
            survival: 0,
            strategy: 0,
            social: 0,
            mmo: 0,
            ...overrides,
        },
        intensityMetrics: {
            intensity: 0,
            focus: 0,
            breadth: 0,
            consistency: 0,
        },
        archetype: "Casual",
        coPlayPartners: [],
        computedAt: "2026-04-16T00:00:00.000Z",
    };
}

describe("isEmptyTasteProfile", () => {
    it("returns true when every dimension is zero", () => {
        expect(isEmptyTasteProfile(makeProfile())).toBe(true);
    });

    it("returns false when any dimension is non-zero", () => {
        expect(isEmptyTasteProfile(makeProfile({ co_op: 5 }))).toBe(false);
        expect(isEmptyTasteProfile(makeProfile({ mmo: 1 }))).toBe(false);
    });
});

describe("axisLabel", () => {
    it("maps every axis to a human-readable label", () => {
        expect(axisLabel("co_op")).toBe("Co-op");
        expect(axisLabel("pvp")).toBe("PvP");
        expect(axisLabel("rpg")).toBe("RPG");
        expect(axisLabel("survival")).toBe("Survival");
        expect(axisLabel("strategy")).toBe("Strategy");
        expect(axisLabel("social")).toBe("Social");
        expect(axisLabel("mmo")).toBe("MMO");
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
