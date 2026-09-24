import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BindingCreateForm, type BindingChannelOption } from "./BindingCreateForm";

// GameSearchInput (shown for the default voice-monitor purpose) calls
// useGameSearch; no MSW handler serves /games/search, so stub the hook.
vi.mock("../../hooks/use-game-search", () => ({ useGameSearch: vi.fn() }));
import { useGameSearch } from "../../hooks/use-game-search";

const CHANNELS: BindingChannelOption[] = [
  { id: "t-1", name: "announcements", channelType: "text" },
  { id: "v-1", name: "Raid Voice", channelType: "voice" },
];

const onCreate = vi.fn();

function renderOpen(props: { isCreating?: boolean; createError?: string | null } = {}) {
  const view = render(
    <BindingCreateForm channels={CHANNELS} onCreate={onCreate}
      isCreating={props.isCreating ?? false} createError={props.createError} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "+ Add binding" }));
  return view;
}

function channelSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Channel" }) as HTMLSelectElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  onCreate.mockResolvedValue(undefined);
  vi.mocked(useGameSearch).mockReturnValue({
    data: undefined,
    isLoading: false,
  } as unknown as ReturnType<typeof useGameSearch>);
});

describe("BindingCreateForm — fields", () => {
  it("names both selects by their labels, keeps their ids and renders them as the shared Select", () => {
    renderOpen();
    expect(channelSelect()).toHaveAttribute("id", "new-binding-channel");
    expect(screen.getByRole("combobox", { name: "Purpose" })).toHaveAttribute("id", "new-binding-purpose");
    // The shared Select draws its own chevron; a raw <select> has none.
    expect(screen.getAllByTestId("select-chevron")).toHaveLength(2);
  });

  it("keeps Create disabled until a channel is chosen, then submits the binding", async () => {
    renderOpen();
    const create = screen.getByRole("button", { name: "Create binding" });
    expect(create).toBeDisabled();
    fireEvent.change(channelSelect(), { target: { value: "t-1" } });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({
      channelId: "t-1", channelType: "text", bindingPurpose: "game-announcements", gameId: null,
    });
  });
});

describe("BindingCreateForm — pending and error", () => {
  // ROK-1652 ruling 7: a pending Create is Button `loading` — aria-disabled +
  // aria-busy (focus stays) and the click is swallowed.
  it("a pending Create is loading and swallows the click", () => {
    const { rerender } = renderOpen();
    fireEvent.change(channelSelect(), { target: { value: "t-1" } });
    rerender(<BindingCreateForm channels={CHANNELS} onCreate={onCreate} isCreating />);
    const create = screen.getByRole("button", { name: "Creating..." });
    expect(create).toHaveAttribute("aria-busy", "true");
    expect(create).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(create);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows the create error as an alert in the danger token", () => {
    renderOpen({ createError: "Channel already bound" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Channel already bound");
    expect(alert).toHaveClass("text-danger");
  });
});
