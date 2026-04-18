import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TasteProfileResponseDto } from "@raid-ledger/contract";
import { renderWithProviders } from "../../../test/render-helpers";
import { TasteProfileSection } from "./TasteProfileSection";

const mockUseTasteProfile = vi.fn();

vi.mock("../../../hooks/use-taste-profile", () => ({
    useTasteProfile: (...args: unknown[]) => mockUseTasteProfile(...args),
}));

function makeResult(
    overrides?: Partial<UseQueryResult<TasteProfileResponseDto, Error>>,
): UseQueryResult<TasteProfileResponseDto, Error> {
    return {
        data: undefined,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPending: false,
        isFetching: false,
        error: null,
        status: "success",
        refetch: vi.fn(),
        ...overrides,
    } as unknown as UseQueryResult<TasteProfileResponseDto, Error>;
}

function makeProfile(
    overrides?: Partial<TasteProfileResponseDto>,
): TasteProfileResponseDto {
    return {
        userId: 42,
        dimensions: {
            co_op: 60,
            pvp: 10,
            rpg: 35,
            survival: 20,
            strategy: 45,
            social: 50,
            mmo: 5,
        },
        intensityMetrics: {
            intensity: 72,
            focus: 75,
            breadth: 20,
            consistency: 55,
        },
        archetype: "Specialist",
        coPlayPartners: [],
        computedAt: "2026-04-16T00:00:00.000Z",
        ...overrides,
    };
}

beforeEach(() => {
    mockUseTasteProfile.mockReset();
});

describe("<TasteProfileSection> (states)", () => {
    it("always renders the 'Taste Profile' heading", () => {
        mockUseTasteProfile.mockReturnValue(
            makeResult({ isLoading: true, data: undefined }),
        );
        renderWithProviders(<TasteProfileSection userId={1} />);
        expect(
            screen.getByRole("heading", { name: "Taste Profile" }),
        ).toBeInTheDocument();
    });

    it("renders the empty-state message when all dimensions are zero", () => {
        const profile = makeProfile({
            dimensions: {
                co_op: 0,
                pvp: 0,
                rpg: 0,
                survival: 0,
                strategy: 0,
                social: 0,
                mmo: 0,
            },
        });
        mockUseTasteProfile.mockReturnValue(
            makeResult({ data: profile, isLoading: false }),
        );
        renderWithProviders(<TasteProfileSection userId={1} />);
        expect(
            screen.getByText(/Not enough data yet — play more games!/),
        ).toBeInTheDocument();
        // Empty state should suppress the intensity badge.
        expect(
            screen.queryByTestId("intensity-badge"),
        ).not.toBeInTheDocument();
    });

    it("renders the empty-state message on error (no crash)", () => {
        mockUseTasteProfile.mockReturnValue(
            makeResult({
                isError: true,
                isLoading: false,
                data: undefined,
                error: new Error("boom"),
            }),
        );
        renderWithProviders(<TasteProfileSection userId={1} />);
        expect(
            screen.getByText(/Not enough data yet — play more games!/),
        ).toBeInTheDocument();
    });

    it("shows a loading indicator while fetching", () => {
        mockUseTasteProfile.mockReturnValue(
            makeResult({
                isLoading: true,
                data: undefined,
                isSuccess: false,
                status: "pending",
            }),
        );
        renderWithProviders(<TasteProfileSection userId={1} />);
        expect(screen.getByText(/Loading/)).toBeInTheDocument();
    });
});

describe("<TasteProfileSection> (content)", () => {
    it("renders intensity badge + archetype + focus line for populated profiles", () => {
        const profile = makeProfile();
        mockUseTasteProfile.mockReturnValue(
            makeResult({ data: profile, isLoading: false }),
        );
        renderWithProviders(<TasteProfileSection userId={1} />);
        expect(screen.getByTestId("intensity-badge")).toBeInTheDocument();
        expect(
            screen.getByText(/Intensity: 72\/100/),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Focused play \(75%\)/),
        ).toBeInTheDocument();
        // Archetype appears somewhere on the page (pill overlay + badge).
        expect(screen.getAllByText("Specialist").length).toBeGreaterThan(0);
    });

    it("opens the partners modal when 'Show all' is clicked", async () => {
        const partners = Array.from({ length: 5 }, (_, i) => ({
            userId: 100 + i,
            username: `Friend${i + 1}`,
            avatar: null,
            sessionCount: 4 + i,
            totalMinutes: 120,
            lastPlayedAt: "2026-04-10T00:00:00.000Z",
        }));
        const profile = makeProfile({ coPlayPartners: partners });
        mockUseTasteProfile.mockReturnValue(
            makeResult({ data: profile, isLoading: false }),
        );
        const user = userEvent.setup();
        renderWithProviders(<TasteProfileSection userId={1} />);

        const showAll = screen.getByRole("button", {
            name: /^Show all \(5\)$/,
        });
        await user.click(showAll);

        // Modal adds another copy of each partner name — assert at least
        // one dialog is now open.
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
});
