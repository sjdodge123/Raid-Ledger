/**
 * Candidate B — "Slot cards / vote ladder" (ROK-1540) — DEV-ONLY wireframe.
 *
 * A ranked ladder of times. The leader is promoted into a decision card at
 * the top; every other slot is a full-width row whose whole surface is the
 * vote target. No submit step, no heatmap above the fold — "Find a better
 * time" opens the grid in a `BottomSheet` on mobile / `Modal` on desktop.
 */
import { useState, type JSX } from 'react';
import { Modal } from '../../components/ui/modal';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Treatments, Faces, StatusPill, Rationale, VoteBar } from './wireframe-chrome';
import { pollFor, statusLine, leader, isTied, type WfPoll, type WfSlot, type WfStateId } from './wireframe-states';

/** Header: status grammar + deadline + late-joiner orientation (P-6). */
function Header({ p }: { p: WfPoll }): JSX.Element {
  const tone = p.status === 'locked' ? 'locked' : p.status === 'open' ? 'open' : 'closed';
  return (
    <div data-testid="wf-b-header" className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="h-8 w-8 rounded bg-overlay" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-foreground">When should we play {p.game}?</p>
          <p className="text-[11px] text-muted">{p.members} in this poll · {p.deadline ?? 'no deadline'}</p>
        </div>
      </div>
      <StatusPill text={statusLine(p)} tone={tone} />
    </div>
  );
}

/** Promoted decision card for the leading slot. */
function LeaderCard({ p }: { p: WfPoll }): JSX.Element {
  const top = leader(p);
  if (p.status === 'locked') {
    return (
      <div data-testid="wf-b-leader" className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-3">
        <p className="text-xs uppercase tracking-wider text-cyan-300">Locked in</p>
        <p className="mt-0.5 text-lg font-semibold text-foreground">{p.lockedTime}</p>
        <p className="mt-1 text-xs text-secondary">You're signed up. <span className="text-cyan-200 underline">Open the event →</span></p>
      </div>
    );
  }
  if (p.status === 'cancelled') {
    return (
      <div data-testid="wf-b-leader" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
        <p className="text-xs uppercase tracking-wider text-rose-300">Poll cancelled</p>
        <p className="mt-1 text-sm text-foreground">“{p.reason}”</p>
        <p className="mt-1 text-xs text-secondary">Nothing more to do here — you'll be DM'd if it re-runs.</p>
      </div>
    );
  }
  if (!top) {
    return (
      <div data-testid="wf-b-leader" className="rounded-lg border border-edge bg-surface p-3">
        <p className="text-sm text-foreground">No times proposed yet.</p>
        <p className="mt-1 text-xs text-secondary">{p.deadline} — be the first to put one up.</p>
      </div>
    );
  }
  return (
    <div data-testid="wf-b-leader" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
      <p className="text-xs uppercase tracking-wider text-emerald-300">
        {p.status === 'closed' ? 'Finished ahead' : 'Leading'}{isTied(p) ? ' · tied, earliest wins' : ''}
      </p>
      <p className="mt-0.5 text-lg font-semibold text-foreground">{top.day} {top.time}</p>
      <p className="mt-1 text-xs text-secondary">{top.votes} of {p.members} · needs {Math.max(0, Math.ceil(p.members / 2) - top.votes)} more to clear half the roster</p>
      {p.lateJoiner && <p className="mt-1 text-xs text-amber-300">You joined late — this is where the group is at.</p>}
    </div>
  );
}

/** One ladder row. The whole row is the vote target (P-2). */
function LadderRow({ p, s }: { p: WfPoll; s: WfSlot }): JSX.Element {
  const interactive = p.canVote && p.status === 'open' && !s.past;
  return (
    <li>
      <button
        type="button"
        disabled={!interactive}
        aria-pressed={s.mine}
        data-testid={`wf-b-slot-${s.id}`}
        aria-label={`${s.mine ? 'Remove your vote for' : 'Vote for'} ${s.day} ${s.time}, ${s.votes} of ${p.members} so far`}
        className={`min-h-[56px] w-full rounded-lg border p-2.5 text-left transition-colors disabled:opacity-60 ${
          s.mine ? 'border-emerald-500 bg-emerald-600/20' : 'border-edge bg-panel/50 hover:border-emerald-500/60'
        }`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">
            {s.day} {s.time}
            {s.past && <span className="ml-1 text-[11px] text-muted">· past</span>}
            {s.mine && <span className="ml-1.5 text-emerald-300">✓ your pick</span>}
          </span>
          <span className="flex items-center gap-2 text-xs text-muted"><Faces names={s.voters} />{s.votes}</span>
        </span>
        <span className="mt-1.5 block"><VoteBar votes={s.votes} members={p.members} /></span>
        {s.conflict && (
          <span className="mt-1 block text-[11px] text-amber-300">⚠ Clashes with your “{s.conflict}”</span>
        )}
      </button>
    </li>
  );
}

/** The ladder plus the "another time" affordance. */
function Ladder({ p, onOpenGrid }: { p: WfPoll; onOpenGrid: () => void }): JSX.Element {
  const rows = [...p.slots].sort((a, b) => b.votes - a.votes || a.id - b.id);
  return (
    <div className="mt-3">
      <ul data-testid="wf-b-ladder" className="space-y-2">
        {rows.map((s) => <LadderRow key={s.id} p={p} s={s} />)}
      </ul>
      {p.canVote && p.status === 'open' && (
        <button
          type="button"
          data-testid="wf-b-open-grid"
          onClick={onOpenGrid}
          className="mt-2 min-h-[44px] w-full rounded-lg border border-dashed border-edge px-3 text-sm text-secondary hover:border-emerald-500/60"
        >
          + None of these work — find a better time
        </button>
      )}
      {!p.canVote && (
        <p className="mt-2 rounded border border-edge bg-overlay/40 p-2 text-xs text-muted">
          You're viewing this poll. Ask {p.game}'s organiser to add you if you want a say.
        </p>
      )}
    </div>
  );
}

/** Body of the availability sheet, shared by both viewports. */
function GridSheetBody(): JSX.Element {
  return (
    <div data-testid="wf-b-grid-sheet" className="space-y-2">
      <p className="text-xs text-secondary">Group availability for the next two weeks. Tap a slot to propose it — proposing counts as your vote.</p>
      <div className="h-40 rounded border border-edge bg-surface" aria-label="Group availability heatmap" />
    </div>
  );
}

/** Candidate B rendered for one state, desktop + mobile. */
export function LayoutBLadder({ state }: { state: WfStateId }): JSX.Element {
  const p = pollFor(state);
  const [deskOpen, setDeskOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <Treatments
      desktop={
        <div data-testid="wf-b-desktop">
          <Header p={p} />
          <div className="mt-3 grid grid-cols-[1fr_minmax(0,1.3fr)] gap-3">
            <LeaderCard p={p} />
            <div className="rounded-lg border border-edge bg-surface p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted">Group availability</p>
              <div className="mt-1 h-28 rounded bg-overlay/40" aria-label="Group availability heatmap" />
            </div>
          </div>
          <Ladder p={p} onOpenGrid={() => setDeskOpen(true)} />
          <Modal isOpen={deskOpen} onClose={() => setDeskOpen(false)} title="Find a better time" maxWidth="max-w-3xl">
            <GridSheetBody />
          </Modal>
        </div>
      }
      mobile={
        <div data-testid="wf-b-mobile">
          <Header p={p} />
          <div className="mt-3"><LeaderCard p={p} /></div>
          <Ladder p={p} onOpenGrid={() => setSheetOpen(true)} />
          <BottomSheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} title="Find a better time" maxHeight="80vh">
            <GridSheetBody />
          </BottomSheet>
        </div>
      }
    />
  );
}

/** Candidate B's in-page rationale. */
export function LayoutBRationale(): JSX.Element {
  return (
    <Rationale
      pitch="Everything above the strip is the shipped header and stays; Layout B replaces the body only. A ranked ladder with the leader promoted to a decision card. The whole row is the vote target, the heatmap moves behind one affordance, and the submit step is gone."
      wins={[
        'Strongest on 375px — every row is a full-width 56px target and the leader is always first (P-1, A-2)',
        'Closest to the shipped component tree, so it is the cheapest of the three to build',
        'Semantic list of buttons: a clean screen-reader and keyboard story (A-1)',
        'Reuses bottom-sheet on mobile and modal on desktop exactly as RescheduleModal already does (P-4)',
      ]}
      costs={[
        'The heatmap is one tap away instead of visible, which the Cycle 4 Ss wireframe deliberately made primary — a real reversal, argued in §Superseding Cycle 4',
        'A poll with 8+ proposed times becomes a long scroll with no spatial sense of the week',
        'Proposing a time is still a second gesture, not a cell tap as in candidate A',
      ]}
    />
  );
}
