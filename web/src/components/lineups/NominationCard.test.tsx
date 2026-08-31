/**
 * Tests for NominationCard (ROK-935).
 * Validates game name, nominator, ownership badge, pricing, and delete button.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/render-helpers";
import { createMockEntry } from "../../test/lineup-factories";
import { NominationCard } from "./NominationCard";

vi.mock("../../hooks/use-auth", () => ({
  useAuth: vi.fn(() => ({ user: { id: 99, role: "member" } })),
  isOperatorOrAdmin: vi.fn(() => false),
}));

import { useAuth, isOperatorOrAdmin } from "../../hooks/use-auth";

describe("NominationCard — basic rendering", () => {
  it("renders game name", () => {
    renderWithProviders(
      <NominationCard entry={createMockEntry()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("Valheim")).toBeInTheDocument();
  });

  it("renders nominator display name", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({
          nominatedBy: { id: 5, displayName: "Alice" },
        })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders cover image when available", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ gameCoverUrl: "/cover.jpg" })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByAltText("Valheim")).toBeInTheDocument();
  });
});

describe("NominationCard — ownership badge", () => {
  it("shows owner count as tally", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ ownerCount: 6, totalMembers: 10 })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("+6")).toBeInTheDocument();
  });
});

describe("NominationCard — pricing", () => {
  it("displays price for non-owners when available", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ itadCurrentPrice: 14.99, nonOwnerCount: 4 })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/\$14.99/)).toBeInTheDocument();
  });

  it("shows no pricing text when price is null", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ itadCurrentPrice: null })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe("NominationCard — note", () => {
  it("renders note in italic when present", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ note: "Great co-op game" })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/Great co-op game/)).toBeInTheDocument();
  });

  it("does not render note area when note is null", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ note: null })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Great co-op game/)).not.toBeInTheDocument();
  });
});

describe("NominationCard — confirmation pill (ROK-1209 AC-5)", () => {
  it("shows 'Your nomination' pill on the user's own card", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, role: "member" },
    } as ReturnType<typeof useAuth>);
    vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ nominatedBy: { id: 1, displayName: "Me" } })}
        onRemove={vi.fn()}
      />,
    );
    const pill = screen.getByTestId("confirmation-pill");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent(/your nomination/i);
  });

  it("does NOT render the pill on cards nominated by other users", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 99, role: "member" },
    } as ReturnType<typeof useAuth>);
    vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({
          nominatedBy: { id: 5, displayName: "Other" },
        })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("confirmation-pill")).not.toBeInTheDocument();
  });

  it("does NOT render the pill when user is anonymous", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<
      typeof useAuth
    >);
    vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({
          nominatedBy: { id: 5, displayName: "Other" },
        })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("confirmation-pill")).not.toBeInTheDocument();
  });
});

describe("NominationCard — delete button", () => {
  it("shows delete button when user is the nominator", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, role: "member" },
    } as ReturnType<typeof useAuth>);
    vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ nominatedBy: { id: 1, displayName: "Me" } })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("shows delete button when user is operator", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 99, role: "operator" },
    } as ReturnType<typeof useAuth>);
    vi.mocked(isOperatorOrAdmin).mockReturnValue(true);
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({
          nominatedBy: { id: 5, displayName: "Other" },
        })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("hides delete button for non-nominator members", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 99, role: "member" },
    } as ReturnType<typeof useAuth>);
    vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({
          nominatedBy: { id: 5, displayName: "Other" },
        })}
        onRemove={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onRemove when delete button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, role: "member" },
    } as ReturnType<typeof useAuth>);
    vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
    const onRemove = vi.fn();
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({
          gameId: 42,
          nominatedBy: { id: 1, displayName: "Me" },
        })}
        onRemove={onRemove}
      />,
    );
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith(42);
  });
});

/**
 * ROK-1444 — roster-fit highlight.
 *
 * When the group outgrows a nominated game the card is flagged so people can
 * see which existing picks no longer work before voting opens. Reuses
 * ROK-1400's rule: strictly Co-Optimus-verified, online max only, advisory —
 * a flagged card is still fully interactive.
 */
describe("NominationCard — roster fit (ROK-1444)", () => {
  it("flags a nomination the grown roster can no longer all play", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ cooptimusOnlineMax: 4 })}
        onRemove={vi.fn()}
        participantCount={5}
      />,
    );
    expect(screen.getByTestId("nomination-card-too-small")).toBeInTheDocument();
    expect(screen.getByTestId("nomination-fit-warning")).toHaveTextContent(
      /Fits 4 online · group is 5/,
    );
  });

  it("does not flag a game that still fits the roster exactly", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ cooptimusOnlineMax: 5 })}
        onRemove={vi.fn()}
        participantCount={5}
      />,
    );
    expect(screen.getByTestId("nomination-card")).toBeInTheDocument();
    expect(
      screen.queryByTestId("nomination-fit-warning"),
    ).not.toBeInTheDocument();
  });

  it("stays silent for a never-synced game rather than inventing a capacity", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ cooptimusOnlineMax: null })}
        onRemove={vi.fn()}
        participantCount={99}
      />,
    );
    expect(
      screen.queryByTestId("nomination-fit-warning"),
    ).not.toBeInTheDocument();
  });

  it("flags a synced ZERO — real data meaning no online co-op", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ cooptimusOnlineMax: 0 })}
        onRemove={vi.fn()}
        participantCount={2}
      />,
    );
    expect(screen.getByTestId("nomination-fit-warning")).toBeInTheDocument();
  });

  it("does not flag when the roster size is unknown", () => {
    renderWithProviders(
      <NominationCard
        entry={createMockEntry({ cooptimusOnlineMax: 1 })}
        onRemove={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("nomination-fit-warning"),
    ).not.toBeInTheDocument();
  });
});
