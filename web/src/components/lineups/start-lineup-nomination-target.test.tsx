/**
 * ROK-1444 — "open voting early" nomination-target control.
 *
 * The target is OPTIONAL: null means today's deadline-only behaviour, so the
 * off state must stay reachable and must be the default.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  NominationTargetControl,
  DEFAULT_NOMINATION_TARGET_PCT,
} from './start-lineup-nomination-target';

const TOGGLE_NAME = "Open voting early once enough games are nominated";

function toggle(): HTMLElement {
  return screen.getByRole("checkbox", { name: TOGGLE_NAME });
}

describe("NominationTargetControl", () => {
  it("renders no slider while the target is off", () => {
    render(<NominationTargetControl value={null} onChange={vi.fn()} />);
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toHaveAttribute("data-testid", "nomination-target-enabled");
    expect(
      screen.queryByRole("slider", { name: "Nomination target" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("nomination-target-pct"),
    ).not.toBeInTheDocument();
  });

  it("describes the off state on the checkbox itself", () => {
    render(<NominationTargetControl value={null} onChange={vi.fn()} />);
    expect(toggle()).toHaveAccessibleDescription(
      "Off = voting opens only when the building phase deadline expires.",
    );
  });

  it("switches on at the default percentage", async () => {
    const onChange = vi.fn();
    render(<NominationTargetControl value={null} onChange={onChange} />);

    await userEvent.click(toggle());

    expect(onChange).toHaveBeenCalledWith(DEFAULT_NOMINATION_TARGET_PCT);
  });

  it("switches back off to null, restoring deadline-only advancement", async () => {
    const onChange = vi.fn();
    render(<NominationTargetControl value={50} onChange={onChange} />);

    await userEvent.click(toggle());

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows the slider and current percentage when on", () => {
    render(<NominationTargetControl value={60} onChange={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "Nomination target" });
    expect(slider).toHaveValue("60");
    expect(slider).toHaveAttribute("aria-valuetext", "60%");
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("keeps the smoke contract (id, testid, 25-100 step 5) on the range input", () => {
    render(<NominationTargetControl value={60} onChange={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "Nomination target" });
    expect(slider).toHaveAttribute("id", "nomination-target-pct");
    expect(slider).toHaveAttribute("data-testid", "nomination-target-pct");
    expect(slider).toHaveAttribute("min", "25");
    expect(slider).toHaveAttribute("max", "100");
    expect(slider).toHaveAttribute("step", "5");
  });

  it("names the moving denominator so the cap is not left implicit", () => {
    render(<NominationTargetControl value={75} onChange={vi.fn()} />);
    expect(
      screen.getByText(/20 games, plus 5 for every extra person/i),
    ).toBeInTheDocument();
  });
});
