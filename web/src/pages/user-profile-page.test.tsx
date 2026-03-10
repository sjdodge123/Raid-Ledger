import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { UserProfilePage } from "./user-profile-page";
import * as useUserProfileHook from "../hooks/use-user-profile";
import * as useGameRegistryHook from "../hooks/use-game-registry";
import type {
  UserProfileDto,
  CharacterDto,
  UserHeartedGameDto,
} from "@raid-ledger/contract";

// Mock the hooks
vi.mock("../hooks/use-user-profile");
vi.mock("../hooks/use-game-registry");
vi.mock("../hooks/use-auth", () => ({
  useAuth: () => ({ user: null, isLoading: false, isAuthenticated: false }),
}));

const createMockCharacter = (
  overrides: Partial<CharacterDto> = {},
): CharacterDto => ({
  id: "char-uuid-1",
  userId: 1,
  gameId: 1,
  name: "TestCharacter",
  realm: "TestRealm",
  class: "Warrior",
  spec: "Protection",
  role: "tank",
  roleOverride: null,
  effectiveRole: "tank",
  isMain: false,
  itemLevel: 450,
  externalId: null,
  avatarUrl: "https://example.com/avatar.jpg",
  renderUrl: null,
  level: 60,
  race: "Human",
  faction: "alliance",
  lastSyncedAt: "2026-02-13T00:00:00Z",
  profileUrl: "https://example.com/profile",
  region: "us",
  gameVariant: "classic",
  equipment: null,
  displayOrder: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const createMockProfile = (
  overrides: Partial<UserProfileDto> = {},
): UserProfileDto => ({
  id: 1,
  username: "TestUser",
  avatar: null,
  customAvatarUrl: null,
  discordId: "123456",
  characters: [],
  createdAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

function setupDefaultProfileMocks() {
  vi.spyOn(useGameRegistryHook, "useGameRegistry").mockReturnValue({
    games: [
      {
        id: 1,
        name: "World of Warcraft",
        slug: "world-of-warcraft",
        coverUrl: null,
      },
      { id: 2, name: "Final Fantasy XIV", slug: "ff14", coverUrl: null },
      { id: 3, name: "Elder Scrolls Online", slug: "eso", coverUrl: null },
    ],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useGameRegistryHook.useGameRegistry>);

  vi.spyOn(useUserProfileHook, "useUserHeartedGames").mockReturnValue({
    data: { data: [], meta: { total: 0, page: 1, limit: 10, hasMore: false } },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useUserProfileHook.useUserHeartedGames>);

  vi.spyOn(useUserProfileHook, "useUserHeartedGamesModal").mockReturnValue({
    items: [],
    total: 0,
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    sentinelRef: () => {},
    refetch: async () => {},
  } as unknown as ReturnType<typeof useUserProfileHook.useUserHeartedGamesModal>);

  vi.spyOn(useUserProfileHook, "useUserSteamLibrary").mockReturnValue({
    data: { data: [], meta: { total: 0, page: 1, limit: 10, hasMore: false } },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useUserProfileHook.useUserSteamLibrary>);

  vi.spyOn(useUserProfileHook, "useUserSteamLibraryModal").mockReturnValue({
    items: [],
    total: 0,
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    sentinelRef: () => {},
    refetch: async () => {},
  } as unknown as ReturnType<typeof useUserProfileHook.useUserSteamLibraryModal>);

  vi.spyOn(useUserProfileHook, "useUserEventSignups").mockReturnValue({
    data: { data: [], total: 0 },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useUserProfileHook.useUserEventSignups>);

  vi.spyOn(useUserProfileHook, "useUserActivity").mockReturnValue({
    data: { data: [], period: "week" },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useUserProfileHook.useUserActivity>);
}

const renderWithProviders = (userId = "1") => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/users/${userId}`]}>
        <Routes>
          <Route path="/users/:userId" element={<UserProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("AC1: Characters grouped by game with section headers — sub 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("groups characters by game with correct headers", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 1, name: "WowChar1" }),
        createMockCharacter({ id: "char-2", gameId: 1, name: "WowChar2" }),
        createMockCharacter({ id: "char-3", gameId: 2, name: "FF14Char" }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    expect(screen.getByText("World of Warcraft")).toBeInTheDocument();
    expect(screen.getByText("Final Fantasy XIV")).toBeInTheDocument();
    expect(screen.getByText("2 characters")).toBeInTheDocument();
    expect(screen.getByText("1 character")).toBeInTheDocument();
    expect(screen.getByText("WowChar1")).toBeInTheDocument();
    expect(screen.getByText("WowChar2")).toBeInTheDocument();
    expect(screen.getByText("FF14Char")).toBeInTheDocument();
  });
});

describe("AC1: Characters grouped by game with section headers — sub 2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it('shows singular "character" when count is 1', () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 1, name: "OnlyChar" }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    expect(screen.getByText("1 character")).toBeInTheDocument();
    expect(screen.queryByText("1 characters")).not.toBeInTheDocument();
  });

  it("shows main section header with total character count", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 1 }),
        createMockCharacter({ id: "char-2", gameId: 2 }),
        createMockCharacter({ id: "char-3", gameId: 3 }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    expect(screen.getByText("Characters (3)")).toBeInTheDocument();
  });
});

describe("AC2: Styling matches reference (My Characters page) — sub 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("renders game section with divider line", () => {
    const profile = createMockProfile({
      characters: [createMockCharacter({ id: "char-1", gameId: 1 })],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    const { container } = renderWithProviders();

    const divider = container.querySelector(".border-edge-subtle");
    expect(divider).toBeInTheDocument();
  });
});

describe("AC2: Styling matches reference (My Characters page) — sub 2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("uses correct CSS classes for section structure", () => {
    const profile = createMockProfile({
      characters: [createMockCharacter({ id: "char-1", gameId: 1 })],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    const charactersSection = screen
      .getByText("Characters (1)")
      .closest(".user-profile-section");
    expect(charactersSection).toBeInTheDocument();

    const sectionTitle = screen.getByText("Characters (1)");
    expect(sectionTitle).toHaveClass("user-profile-section-title");
  });
});

describe("AC3: Characters sorted (main first, displayOrder) — part 1 (sub 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("sorts main character first within game group", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 1, name: "Alt1", isMain: false, displayOrder: 1 }),
        createMockCharacter({ id: "char-2", gameId: 1, name: "MainChar", isMain: true, displayOrder: 2 }),
        createMockCharacter({ id: "char-3", gameId: 1, name: "Alt2", isMain: false, displayOrder: 3 }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    const characterLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("/characters/"));

    expect(within(characterLinks[0]).getByText("MainChar")).toBeInTheDocument();
  });
});

describe("AC3: Characters sorted (main first, displayOrder) — part 1 (sub 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("sorts by displayOrder when no main character", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 1, name: "Char3", isMain: false, displayOrder: 3 }),
        createMockCharacter({ id: "char-2", gameId: 1, name: "Char1", isMain: false, displayOrder: 1 }),
        createMockCharacter({ id: "char-3", gameId: 1, name: "Char2", isMain: false, displayOrder: 2 }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    const characterLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("/characters/"));

    expect(within(characterLinks[0]).getByText("Char1")).toBeInTheDocument();
    expect(within(characterLinks[1]).getByText("Char2")).toBeInTheDocument();
    expect(within(characterLinks[2]).getByText("Char3")).toBeInTheDocument();
  });
});

describe("UserProfilePage - Game Grouping (ROK-308) — part 4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  describe("AC3: Characters sorted (main first, displayOrder) — part 2", () => {
    it("sorts main first, then remaining by displayOrder", () => {
      const profile = createMockProfile({
        characters: [
          createMockCharacter({ id: "char-1", gameId: 1, name: "Alt2", isMain: false, displayOrder: 3 }),
          createMockCharacter({ id: "char-2", gameId: 1, name: "MainChar", isMain: true, displayOrder: 2 }),
          createMockCharacter({ id: "char-3", gameId: 1, name: "Alt1", isMain: false, displayOrder: 1 }),
        ],
      });

      vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
        data: profile, isLoading: false, error: null,
      } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

      renderWithProviders();

      const characterLinks = screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href")?.startsWith("/characters/"));

      expect(within(characterLinks[0]).getByText("MainChar")).toBeInTheDocument();
      expect(within(characterLinks[1]).getByText("Alt1")).toBeInTheDocument();
      expect(within(characterLinks[2]).getByText("Alt2")).toBeInTheDocument();
    });
  });
});

describe("AC4: Section repositioned (Characters below Events)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("renders sections in correct order: Events, Characters, Hearted Games", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 1, name: "TestChar" }),
      ],
    });

    const heartedGames: UserHeartedGameDto[] = [
      { id: 1, igdbId: 12345, name: "Final Fantasy XIV", slug: "final-fantasy-xiv", coverUrl: null },
    ];

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    vi.spyOn(useUserProfileHook, "useUserHeartedGames").mockReturnValue({
      data: {
        data: heartedGames,
        meta: { total: heartedGames.length, page: 1, limit: 10, hasMore: false },
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserHeartedGames>);

    vi.spyOn(useUserProfileHook, "useUserEventSignups").mockReturnValue({
      data: { data: [], total: 0 },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserEventSignups>);

    const { container } = renderWithProviders();

    const sections = container.querySelectorAll(".user-profile-section");
    const sectionTitles = Array.from(sections).map(
      (section) =>
        section.querySelector(".user-profile-section-title")?.textContent,
    );

    const eventsIndex = sectionTitles.indexOf("Upcoming Events");
    const charactersIndex = sectionTitles.indexOf("Characters (1)");
    const heartedIndex = sectionTitles.indexOf("Interested In (1)");

    expect(eventsIndex).toBeLessThan(charactersIndex);
    expect(charactersIndex).toBeLessThan(heartedIndex);
  });
});

describe("AC5: Edge cases — part 1 (sub 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("hides characters section when user has zero characters", () => {
    const profile = createMockProfile({ characters: [] });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();
    expect(screen.queryByText(/Characters/)).not.toBeInTheDocument();
  });

  it("renders single game section for single-game user", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 1, name: "Char1" }),
        createMockCharacter({ id: "char-2", gameId: 1, name: "Char2" }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    expect(screen.getByText("World of Warcraft")).toBeInTheDocument();
    expect(screen.queryByText("Final Fantasy XIV")).not.toBeInTheDocument();
    expect(screen.getByText("2 characters")).toBeInTheDocument();
  });
});

describe("AC5: Edge cases — part 1 (sub 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("renders multiple game sections for multi-game user", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 1, name: "WowChar" }),
        createMockCharacter({ id: "char-2", gameId: 2, name: "FF14Char1" }),
        createMockCharacter({ id: "char-3", gameId: 2, name: "FF14Char2" }),
        createMockCharacter({ id: "char-4", gameId: 3, name: "ESOChar" }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    expect(screen.getByText("World of Warcraft")).toBeInTheDocument();
    expect(screen.getByText("Final Fantasy XIV")).toBeInTheDocument();
    expect(screen.getByText("Elder Scrolls Online")).toBeInTheDocument();

    const singleCharTexts = screen.getAllByText("1 character");
    expect(singleCharTexts).toHaveLength(2);
    expect(screen.getByText("2 characters")).toBeInTheDocument();
  });
});

describe("AC5: Edge cases — part 2 (sub 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it('falls back to "Unknown Game" when game data is missing', () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 999, name: "OrphanChar" }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    expect(screen.getByText("Unknown Game")).toBeInTheDocument();
    expect(screen.getByText("OrphanChar")).toBeInTheDocument();
  });
});

describe("AC5: Edge cases — part 2 (sub 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("handles empty game registry gracefully", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-1", gameId: 1, name: "TestChar" }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    vi.spyOn(useGameRegistryHook, "useGameRegistry").mockReturnValue({
      games: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useGameRegistryHook.useGameRegistry>);

    renderWithProviders();

    expect(screen.getByText("Unknown Game")).toBeInTheDocument();
    expect(screen.getByText("TestChar")).toBeInTheDocument();
  });
});

describe("Character card rendering — sub 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("renders character with all details", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({
          id: "char-1", gameId: 1, name: "DetailedChar",
          level: 60, race: "Human", class: "Warrior", spec: "Protection",
          faction: "alliance", effectiveRole: "tank", itemLevel: 450,
        }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    expect(screen.getByText("DetailedChar")).toBeInTheDocument();
    expect(screen.getByText("Alliance")).toBeInTheDocument();
    expect(screen.getByText(/Lv\.60/)).toBeInTheDocument();
    expect(screen.getByText("Human")).toBeInTheDocument();
    expect(screen.getByText("Warrior")).toBeInTheDocument();
    expect(screen.getByText(/Protection/)).toBeInTheDocument();
    expect(screen.getByText("TANK")).toBeInTheDocument();
    expect(screen.getByText(/450 iLvl/)).toBeInTheDocument();
  });
});

describe("Character card rendering — sub 2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("links to character detail page", () => {
    const profile = createMockProfile({
      characters: [
        createMockCharacter({ id: "char-uuid-123", gameId: 1, name: "LinkChar" }),
      ],
    });

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: profile, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    const link = screen.getByRole("link", { name: /LinkChar/i });
    expect(link).toHaveAttribute("href", "/characters/char-uuid-123");
  });
});

describe("UserProfilePage - Game Grouping (ROK-308) — part 9", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  describe("Loading and error states", () => {
    it("renders loading skeleton", () => {
      vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
        data: undefined, isLoading: true, error: null,
      } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

      const { container } = renderWithProviders();

      expect(container.querySelector(".user-profile-skeleton")).toBeInTheDocument();
      expect(container.querySelector(".skeleton-avatar")).toBeInTheDocument();
    });

    it("renders error state when profile not found", () => {
      vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
        data: null, isLoading: false, error: new Error("Not found"),
      } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

      renderWithProviders();

      expect(screen.getByText("User Not Found")).toBeInTheDocument();
      expect(screen.getByText(/doesn't exist or has been removed/i)).toBeInTheDocument();
    });
  });
});

// ─── ROK-745: Show 10 + Show All modal ─────────────────────────────────────

describe("ROK-745: Hearted games show-10 + modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfileMocks();
  });

  it("shows Show All button when total > 10", () => {
    const games = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, igdbId: i + 100, name: `Game ${i + 1}`, slug: `game-${i + 1}`, coverUrl: null,
    }));

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: createMockProfile(), isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    vi.spyOn(useUserProfileHook, "useUserHeartedGames").mockReturnValue({
      data: {
        data: games,
        meta: { total: 25, page: 1, limit: 10, hasMore: true },
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserHeartedGames>);

    renderWithProviders();

    expect(screen.getByText("Show All (25)")).toBeInTheDocument();
  });

  it("hides Show All button when total <= 10", () => {
    const games = [
      { id: 1, igdbId: 100, name: "Game 1", slug: "game-1", coverUrl: null },
    ];

    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: createMockProfile(), isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    vi.spyOn(useUserProfileHook, "useUserHeartedGames").mockReturnValue({
      data: {
        data: games,
        meta: { total: 1, page: 1, limit: 10, hasMore: false },
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserHeartedGames>);

    renderWithProviders();

    expect(screen.queryByText(/Show All/)).not.toBeInTheDocument();
  });

  it("hides section when no hearted games", () => {
    vi.spyOn(useUserProfileHook, "useUserProfile").mockReturnValue({
      data: createMockProfile(), isLoading: false, error: null,
    } as unknown as ReturnType<typeof useUserProfileHook.useUserProfile>);

    renderWithProviders();

    expect(screen.queryByText(/Interested In/)).not.toBeInTheDocument();
  });
});
