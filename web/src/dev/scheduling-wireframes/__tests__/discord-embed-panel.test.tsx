/**
 * ROK-1553 — candidate D (Discord embed) smoke coverage.
 *
 * Same bar as `scheduling-wireframes.test.tsx`: this is a DEMO_MODE dev route,
 * so the assertions are behavioural, not visual. What IS pinned here is the
 * difference the panel exists to show — the action row is absent in every
 * Today embed (ROK-1461) and present in Target only while the poll is open —
 * because a wireframe that quietly renders the same thing in both columns
 * would still pass a "it mounts" test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { DiscordEmbedPanel } from '../DiscordEmbedPanel';
import { SchedulingWireframesPage } from '../SchedulingWireframesPage';
import { WF_STATES, pollFor, type WfStateId } from '../wireframe-states';
import { todayAuthorLine, todayEmbed, todaySlotLines } from '../embed-grammar-today';
import { targetActionRow, targetEmbed, targetStatusLine } from '../embed-grammar-target';

const mockStatus = vi.fn();
vi.mock('../../../hooks/use-system-status', () => ({
  useSystemStatus: () => mockStatus(),
}));

beforeEach(() => {
  mockStatus.mockReturnValue({ data: { demoMode: true }, isLoading: false });
});

/** States where a vote can still be cast — Target must offer an action row. */
const OPEN_STATES: WfStateId[] = ['open-empty', 'open-unvoted', 'voted', 'changed', 'tie', 'late-joiner', 'read-only-viewer', 'no-availability'];
/** Terminal states — no action row, on either surface. */
const TERMINAL_STATES: WfStateId[] = ['locked', 'cancelled', 'expired'];

describe('DiscordEmbedPanel — mounts for the whole state matrix', () => {
  it.each(WF_STATES.map((s) => s.id))('renders both columns for the %s state', (state) => {
    renderWithProviders(<DiscordEmbedPanel state={state} />);
    expect(screen.getByTestId('wf-d-panel')).toBeInTheDocument();
    expect(screen.getByTestId('de-col-today')).toBeInTheDocument();
    expect(screen.getByTestId('de-col-target')).toBeInTheDocument();
  });

  it('renders each column at a Discord desktop and a Discord mobile width', () => {
    renderWithProviders(<DiscordEmbedPanel state="open-unvoted" />);
    for (const id of ['de-today-desktop', 'de-today-mobile', 'de-target-desktop', 'de-target-mobile']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId('de-today-desktop')).toHaveStyle({ width: '600px' });
    expect(screen.getByTestId('de-target-mobile')).toHaveStyle({ width: '360px' });
  });

  it('carries a per-state rationale under the target column', () => {
    renderWithProviders(<DiscordEmbedPanel state="cancelled" />);
    expect(screen.getByTestId('de-caption-target')).toHaveTextContent('F-02');
  });
});

describe('DiscordEmbedPanel — the action row is the whole point', () => {
  it.each([...OPEN_STATES, ...TERMINAL_STATES])('never renders an action row in Today for %s (ROK-1461)', (state) => {
    renderWithProviders(<DiscordEmbedPanel state={state} />);
    expect(screen.queryByTestId('de-today-desktop-action-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('de-today-mobile-action-row')).not.toBeInTheDocument();
    expect(todayEmbed(pollFor(state)).actionRow).toBeNull();
  });

  it.each(OPEN_STATES)('renders an action row in Target for the open state %s (P4-1, F-17)', (state) => {
    renderWithProviders(<DiscordEmbedPanel state={state} />);
    expect(screen.getByTestId('de-target-desktop-action-row')).toBeInTheDocument();
    expect(screen.getByTestId('de-target-mobile-action-row')).toBeInTheDocument();
  });

  it.each(TERMINAL_STATES)('drops the Target action row once the poll is %s', (state) => {
    renderWithProviders(<DiscordEmbedPanel state={state} />);
    expect(screen.queryByTestId('de-target-desktop-action-row')).not.toBeInTheDocument();
    expect(targetActionRow(pollFor(state))).toBeNull();
  });

  it('gives one button per slot while slots + suggest still fit the row (the P4-1 pick)', () => {
    renderWithProviders(<DiscordEmbedPanel state="open-unvoted" />);
    for (const s of pollFor('open-unvoted').slots) {
      expect(screen.getByTestId(`de-target-desktop-btn-slot-${s.id}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('de-target-desktop-btn-vote')).not.toBeInTheDocument();
  });

  it('falls back to a single Vote button past Discord’s five-per-row limit', () => {
    const p = pollFor('open-unvoted');
    const many = { ...p, slots: [1, 2, 3, 4, 5, 6].map((id) => ({ ...p.slots[0], id })) };
    const row = targetActionRow(many);
    expect(row?.map((b) => b.id)).toEqual(['vote', 'suggest']);
  });

  it('never models a row Discord would refuse — suggest counts toward the five', () => {
    const p = pollFor('open-unvoted');
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const slots = Array.from({ length: count }, (_, i) => ({ ...p.slots[0], id: i + 1 }));
      expect(targetActionRow({ ...p, slots })?.length).toBeLessThanOrEqual(5);
    }
    // Exactly five slots is the boundary: four buttons fit, five do not.
    const five = Array.from({ length: 5 }, (_, i) => ({ ...p.slots[0], id: i + 1 }));
    expect(targetActionRow({ ...p, slots: five })?.map((b) => b.id)).toEqual(['vote', 'suggest']);
  });

  it('renders one identical row for every reader — Discord has no per-viewer button state (F-07)', () => {
    // The row hangs off the SHARED message, so a non-member must see exactly
    // what a member sees; the ephemeral is what differs.
    const viewer = targetActionRow(pollFor('read-only-viewer'));
    const member = targetActionRow(pollFor('open-unvoted'));
    expect(viewer).toEqual(member);
    expect(viewer?.some((b) => b.disabled)).toBe(false);
    expect(targetEmbed(pollFor('read-only-viewer')).ephemeral?.headline).toBe('Join this poll');
  });
});

describe('DiscordEmbedPanel — per-viewer state and the terminal grammars', () => {
  it.each(WF_STATES.map((s) => s.id))('addresses no reader in the shared %s message (F-16)', (state) => {
    // Property, not a literal: the one channel message every member reads
    // cannot say "you" about any of them. Per-viewer state is ephemeral-only.
    const m = targetEmbed(pollFor(state));
    const shared = [...m.lines.map((l) => l.text), ...(m.actionRow ?? []).map((b) => b.label)];
    expect(shared.filter((t) => /\byou\b/i.test(t))).toEqual([]);
  });

  it('puts the viewer’s own vote in the ephemeral, where it is actually visible only to them', () => {
    const p = pollFor('voted');
    expect(p.slots.some((s) => s.mine)).toBe(true);
    expect(targetEmbed(p).ephemeral?.lines.some((l) => l.text.startsWith('Your vote:'))).toBe(true);
    expect(targetEmbed(pollFor('late-joiner')).ephemeral?.lines.some((l) => l.text.includes('joined late'))).toBe(true);
  });

  it('shows the ephemeral reply only where a vote can be cast (F-16)', () => {
    renderWithProviders(<DiscordEmbedPanel state="voted" />);
    expect(screen.getByTestId('de-target-desktop-ephemeral')).toHaveTextContent('Only you can see this');
    expect(screen.getByTestId('de-target-desktop-ephemeral')).toHaveTextContent('Your vote: Thu 8:00 PM');
    expect(screen.queryByTestId('de-today-desktop-ephemeral')).not.toBeInTheDocument();
  });

  it('names the cancellation reason in the Target author line, where Today says POLL CLOSED (F-02)', () => {
    const p = pollFor('cancelled');
    renderWithProviders(<DiscordEmbedPanel state="cancelled" />);
    expect(screen.getByTestId('de-today-desktop-author')).toHaveTextContent('POLL CLOSED');
    const target = screen.getByTestId('de-target-desktop-author');
    expect(target).toHaveTextContent('POLL CANCELLED');
    expect(target).toHaveTextContent(p.reason as string);
  });

  it('distinguishes expired from cancelled, which Today cannot', () => {
    expect(todayAuthorLine(pollFor('expired'))).toBe(todayAuthorLine(pollFor('cancelled')));
    expect(targetStatusLine(pollFor('expired'))).not.toBe(targetStatusLine(pollFor('cancelled')));
    expect(targetStatusLine(pollFor('expired'))).toContain('EXPIRED');
  });

  it('adds the deadline the shipped embed has never carried (F-04)', () => {
    const p = pollFor('open-unvoted');
    expect(targetEmbed(p).lines.some((l) => l.text.includes(p.deadline as string))).toBe(true);
    expect(todayEmbed(p).lines.some((l) => l.text.includes(p.deadline as string))).toBe(false);
  });

  it('caps Today at three slot lines and Target at none', () => {
    const p = pollFor('open-unvoted');
    const many = { ...p, slots: [1, 2, 3, 4, 5].map((id) => ({ ...p.slots[0], id, votes: 6 - id })) };
    expect(todaySlotLines(many)).toHaveLength(3);
    expect(targetEmbed(many).lines.filter((l) => l.id.startsWith('slot-'))).toHaveLength(5);
  });
});

describe('SchedulingWireframesPage — candidate D is switchable', () => {
  it('swaps to the Discord embed panel and back without disturbing A/B/C', () => {
    renderWithProviders(<SchedulingWireframesPage />);
    expect(screen.getByTestId('wf-b-desktop')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('wf-layout-d'));
    expect(screen.getByTestId('wf-d-panel')).toBeInTheDocument();
    expect(screen.getByTestId('wf-d-open-question')).toHaveTextContent('ROK-1461');
    expect(screen.queryByTestId('wf-b-desktop')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('wf-layout-b'));
    expect(screen.getByTestId('wf-b-desktop')).toBeInTheDocument();
    expect(screen.queryByTestId('wf-d-panel')).not.toBeInTheDocument();
  });

  it('drives candidate D from the same state switcher as A/B/C', () => {
    renderWithProviders(<SchedulingWireframesPage />);
    fireEvent.click(screen.getByTestId('wf-layout-d'));
    fireEvent.click(screen.getByTestId('wf-state-locked'));
    expect(screen.getByTestId('de-today-desktop-author')).toHaveTextContent('LOCKED IN');
    expect(screen.getByTestId('wf-state-note')).toHaveTextContent(pollFor('locked').note);
  });
});
