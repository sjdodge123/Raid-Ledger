/**
 * Tests for the "Owned by" section on game detail page (ROK-745).
 *
 * Verifies:
 * - Section renders when owners exist
 * - Section hidden when no owners
 * - Shows Steam icon and player count text
 * - Uses InterestPlayerAvatars component
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GameDetailPage } from "./game-detail-page";

// ─── Module mocks ─────────────────────────────────────────────────────────

vi.mock("../lib/config", () => ({
  API_BASE_URL: "http://localhost:3000",
}));

vi.mock("../lib/avatar", () => ({
  resolveAvatar: () => ({ url: null, type: "initials" }),
  toAvatarUser: (u: unknown) => u,
}));

vi.mock("../lib/game-utils", () => ({
  GENRE_MAP: {} as Record<number, string>,
}));

vi.mock("../components/games/ScreenshotGallery", () => ({
  ScreenshotGallery: () => null,
}));

vi.mock("../components/games/TwitchStreamEmbed", () => ({
  TwitchStreamEmbed: () => null,
}));

vi.mock("../components/events/event-card", () => ({
  EventCard: () => null,
}));

vi.mock("../components/games/InterestPlayerAvatars", () => ({
  InterestPlayerAvatars: ({
    totalCount,
    formatLabel,
  }: {
    totalCount: number;
    formatLabel?: (total: number, overflow: number) => string;
  }) => {
    const text = formatLabel ? formatLabel(totalCount, 0) : `${totalCount} players interested`;
    return <div data-testid="interest-avatars">{text}</div>;
  },
}));

vi.mock("../hooks/use-games-discover", () => ({
  useGameDetail: vi.fn(),
  useGameStreams: vi.fn(() => ({ data: null })),
  useGameActivity: vi.fn(() => ({ data: null, isLoading: false })),
  useGameNowPlaying: vi.fn(() => ({ data: null })),
}));

vi.mock("../hooks/use-events", () => ({
  useEvents: vi.fn(() => ({ data: null })),
}));

import * as useGamesDiscoverModule from "../hooks/use-games-discover";
import * as useAuthHook from "../hooks/use-auth";
import * as useWantToPlayModule from "../hooks/use-want-to-play";

vi.mock("../hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../hooks/use-want-to-play", () => ({
  useWantToPlay: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────

const mockGame = {
  id: 42,
  igdbId: 1234,
  name: "Valheim",
  slug: "valheim",
  coverUrl: null,
  genres: [],
  summary: null,
  rating: null,
  aggregatedRating: null,
  popularity: null,
  gameModes: [],
  themes: [],
  platforms: [],
  screenshots: [],
  videos: [],
  firstReleaseDate: null,
  playerCount: null,
  twitchGameId: null,
  crossplay: null,
};

const mockOwners = [
  { id: 1, username: "Player1", avatar: null, customAvatarUrl: null, discordId: "111" },
  { id: 2, username: "Player2", avatar: "hash", customAvatarUrl: null, discordId: "222" },
];

function renderDetailPage(gameId = "42") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/games/${gameId}`]}>
        <Routes>
          <Route path="/games/:id" element={<GameDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("GameDetailPage — Owned by section (ROK-745)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useGamesDiscoverModule.useGameDetail).mockReturnValue({
      data: mockGame,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useGamesDiscoverModule.useGameDetail>);

    vi.mocked(useAuthHook.useAuth).mockReturnValue({
      user: { id: 1, username: "Tester", role: "member" } as never,
      isAuthenticated: true,
    } as ReturnType<typeof useAuthHook.useAuth>);
  });

  it("renders Owned by section with owner count", () => {
    vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
      wantToPlay: false,
      count: 0,
      source: undefined,
      players: [],
      owners: mockOwners,
      ownerCount: 5,
      isLoading: false,
      toggle: vi.fn(),
      isToggling: false,
    });

    renderDetailPage();

    expect(screen.getByText(/5 players own this/i)).toBeInTheDocument();
  });

  it("hides Owned by section when ownerCount is 0", () => {
    vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
      wantToPlay: false,
      count: 0,
      source: undefined,
      players: [],
      owners: [],
      ownerCount: 0,
      isLoading: false,
      toggle: vi.fn(),
      isToggling: false,
    });

    renderDetailPage();

    expect(screen.queryByText(/players own this/i)).not.toBeInTheDocument();
  });

  it("shows singular text when only 1 owner", () => {
    vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
      wantToPlay: false,
      count: 0,
      source: undefined,
      players: [],
      owners: [mockOwners[0]],
      ownerCount: 1,
      isLoading: false,
      toggle: vi.fn(),
      isToggling: false,
    });

    renderDetailPage();

    expect(screen.getByText(/1 player owns this/i)).toBeInTheDocument();
  });

  it("does not render Owned by when user is not authenticated", () => {
    vi.mocked(useAuthHook.useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
    } as ReturnType<typeof useAuthHook.useAuth>);

    vi.mocked(useWantToPlayModule.useWantToPlay).mockReturnValue({
      wantToPlay: false,
      count: 0,
      source: undefined,
      players: [],
      owners: mockOwners,
      ownerCount: 5,
      isLoading: false,
      toggle: vi.fn(),
      isToggling: false,
    });

    renderDetailPage();

    // When not authenticated, WantToPlaySection (which contains OwnedBy) is not rendered
    expect(screen.queryByText(/players own this/i)).not.toBeInTheDocument();
  });
});
