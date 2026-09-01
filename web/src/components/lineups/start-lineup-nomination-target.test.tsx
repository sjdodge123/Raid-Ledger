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

describe("NominationTargetControl", () => {
  it("renders no slider while the target is off", () => {
    render(<NominationTargetControl value={null} onChange={vi.fn()} />);
    expect(screen.getByTestId("nomination-target-enabled")).not.toBeChecked();
    expect(
      screen.queryByTestId("nomination-target-pct"),
    ).not.toBeInTheDocument();
  });

  it("switches on at the default percentage", async () => {
    const onChange = vi.fn();
    render(<NominationTargetControl value={null} onChange={onChange} />);

    await userEvent.click(screen.getByTestId("nomination-target-enabled"));

    expect(onChange).toHaveBeenCalledWith(DEFAULT_NOMINATION_TARGET_PCT);
  });

  it("switches back off to null, restoring deadline-only advancement", async () => {
    const onChange = vi.fn();
    render(<NominationTargetControl value={50} onChange={onChange} />);

    await userEvent.click(screen.getByTestId("nomination-target-enabled"));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows the slider and current percentage when on", () => {
    render(<NominationTargetControl value={60} onChange={vi.fn()} />);
    expect(screen.getByTestId("nomination-target-pct")).toHaveValue("60");
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("names the moving denominator so the cap is not left implicit", () => {
    render(<NominationTargetControl value={75} onChange={vi.fn()} />);
    expect(
      screen.getByText(/20 games, plus 5 for every extra person/i),
    ).toBeInTheDocument();
  });
});
