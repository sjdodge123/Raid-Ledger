/**
 * ROK-1648 (L12): the public-profile activity toggles sit on the shared form
 * primitives — the period selector is a segmented RadioGroup (arrow keys move
 * the selection) and the privacy toggle is a Checkbox with a description.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import * as useUserProfileHook from "../../hooks/use-user-profile";
import * as apiClient from "../../lib/api-client";
import { ActivitySection } from "./user-profile-components";

vi.mock("../../hooks/use-user-profile");
vi.mock("../../lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-client")>()),
  getMyPreferences: vi.fn(),
  updatePreference: vi.fn(),
}));

function renderSection(isOwnProfile = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActivitySection userId={1} isOwnProfile={isOwnProfile} pricingMap={new Map()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function periodGroup(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "Activity period" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useUserProfileHook.useUserActivity).mockReturnValue({
    data: { data: [], period: "week" },
    isLoading: false,
    error: null,
  } as never);
  vi.mocked(apiClient.getMyPreferences).mockResolvedValue({ show_activity: true } as never);
  vi.mocked(apiClient.updatePreference).mockResolvedValue(undefined as never);
});

describe("ActivitySection — period selector (ROK-1648 L12)", () => {
  it("is a radiogroup named 'Activity period' with exactly one checked radio", () => {
    renderSection();
    const radios = within(periodGroup()).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(["week", "month", "all"]);
    const checked = radios.filter((r) => (r as HTMLInputElement).checked);
    expect(checked, "exactly one period should be checked").toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName("This Week");
  });

  it("moves the selection with the arrow keys", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("radio", { name: "This Week" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "This Month" })).toBeChecked();
    expect(useUserProfileHook.useUserActivity).toHaveBeenLastCalledWith(1, "month");
  });
});

describe("ActivitySection — privacy toggle (ROK-1648 L12)", () => {
  it("is a Checkbox named by its visible label and described by its hint", () => {
    renderSection(true);
    const box = screen.getByRole("checkbox");
    expect(box, "the name should be the visible label alone").toHaveAccessibleName("Show my game activity publicly");
    expect(box).toHaveAccessibleDescription("When disabled, your activity is hidden from others");
    expect(box.className, "the privacy toggle should wear tokens, not raw emerald").not.toMatch(/emerald/);
    expect(box).toBeChecked();
  });

  it("unchecking saves show_activity=false", async () => {
    const user = userEvent.setup();
    renderSection(true);
    await user.click(screen.getByRole("checkbox"));
    expect(apiClient.updatePreference).toHaveBeenCalledWith("show_activity", false);
  });

  it("is not rendered on someone else's profile", () => {
    renderSection(false);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
