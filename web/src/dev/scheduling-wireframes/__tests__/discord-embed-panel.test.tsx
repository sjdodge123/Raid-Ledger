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
import { VIEWER_NAME, WF_STATES, pollFor, type WfStateId } from '../wireframe-states';
import { todayAuthorLine, todayEmbed, todaySlotLines } from '../embed-grammar-today';
import { TARGET_OPEN_QUESTION, targetActionRow, targetEmbed, targetStatusLine } from '../embed-grammar-target';

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

  it('does NOT carry the shipped-header strip — that is a web-page concern', () => {
    renderWithProviders(<DiscordEmbedPanel state="open-unvoted" />);
    expect(screen.queryByTestId('wf-shipped-header')).not.toBeInTheDocument();
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
    // The refusal is the one thing an ephemeral is still for.
    expect(targetEmbed(pollFor('read-only-viewer')).ephemeral?.headline).toContain('not in this poll');
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

  it('names the voters under each slot, so no ephemeral is needed to answer "did I vote?" (F-15)', () => {
    const p = pollFor('voted');
    const lineFor = (id: number) => targetEmbed(p).lines.find((l) => l.id === `slot-${id}`)?.text ?? '';
    // Sat has two voters, so the reader finds their own name outright.
    expect(lineFor(3)).toContain(VIEWER_NAME);
    // Thu has six, and the list is truncated identically for everyone — the
    // reader's own name can sit behind `+N more`. That is the cost of a
    // shared message and it is stated in the rationale rather than hidden.
    expect(lineFor(1)).toMatch(/^Thu 8:00 PM · 6 ✓ — /);
    expect(lineFor(1)).toContain('+2 more');
  });

  it('truncates the name list so a field stays inside Discord’s 1024-character limit', () => {
    const p = pollFor('voted');
    const crowd = { ...p, slots: p.slots.map((s) => ({ ...s, votes: 12, voters: Array.from({ length: 12 }, (_, i) => `member${i}`) })) };
    const line = targetEmbed(crowd).lines.find((l) => l.id.startsWith('slot-'));
    expect(line?.text).toContain('+8 more');
    expect(targetEmbed(crowd).lines.every((l) => l.text.length < 1024)).toBe(true);
  });

  it('models approval voting: BOTH marked times read as voted, and a press withdraws (operator ask)', () => {
    const p = pollFor('voted');
    const mine = p.slots.filter((s) => s.mine);
    expect(mine.map((s) => s.id)).toEqual([1, 3]);
    // Both marked slots carry the viewer's name and a bumped count — on the
    // message everyone sees, which is the whole confirmation.
    const m = targetEmbed(p);
    for (const id of [1, 3]) {
      const slot = p.slots.find((x) => x.id === id)!;
      expect(m.lines.find((l) => l.id === `slot-${id}`)?.text).toContain(`· ${slot.votes} ✓`);
    }
    expect(m.lines.find((l) => l.id === 'slot-3')?.text).toContain(VIEWER_NAME);
    expect(m.lines.some((l) => l.text.includes('Tap every time that works'))).toBe(true);
    expect(m.lines.some((l) => l.text.includes('updates in place'))).toBe(true);
  });

  it('degrades to a multi-select, not a single pick, once the row is full', () => {
    const p = pollFor('open-unvoted');
    const many = { ...p, slots: [1, 2, 3, 4, 5, 6].map((id) => ({ ...p.slots[0], id })) };
    expect(targetActionRow(many)?.[0].label).toContain('pick any number');
    expect(TARGET_OPEN_QUESTION).toContain('MULTI-select');
  });

});

describe('DiscordEmbedPanel — where the ephemeral is, and is not, used', () => {
  it('keeps the ephemeral for refusals and errors ONLY — never for a confirmation', () => {
    // Operator ruling: an ephemeral gets lost in the chat, so a successful
    // vote is confirmed by the edited message, not by a private reply.
    for (const state of ['open-unvoted', 'voted', 'changed', 'late-joiner'] as WfStateId[]) {
      expect(targetEmbed(pollFor(state)).ephemeral).toBeNull();
    }
    renderWithProviders(<DiscordEmbedPanel state="read-only-viewer" />);
    const eph = screen.getByTestId('de-target-desktop-ephemeral');
    expect(eph).toHaveTextContent('not in this poll');
    expect(eph).toHaveTextContent('Errors only');
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
