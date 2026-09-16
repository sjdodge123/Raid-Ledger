/**
 * ROK-1540 / ROK-1569 — scheduling-poll wireframes. DEMO_MODE-gated, dev-only.
 *
 * APPROVED TARGETS ONLY. Rejected candidates (the calendar-first heatmap, the
 * conversation timeline, the four-answer game-time step) were deleted in
 * ROK-1569 — their reasoning lives in
 * `docs/spikes/rok-1540-scheduling-poll-audit.md`, not here, because a route
 * that shows every idea ever drawn cannot tell an operator what was chosen.
 * All data is mocked (`wireframe-states.ts`) — no API, no hooks, no router
 * dependency beyond the gate's redirect.
 *
 * Gated identically to `simplify-wireframes`: `useSystemStatus().demoMode`,
 * redirect to `/` when false, lazily imported from `lazy-routes.ts`.
 */
import { useState, type JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import { LayoutPicker, StatePicker } from './wireframe-chrome';
import { pollFor, type WfStateId } from './wireframe-states';
import { LayoutBLadder, LayoutBRationale } from './LayoutBLadder';
import { DiscordEmbedPanel, DiscordEmbedRationale } from './DiscordEmbedPanel';
import { OptionACompPanel, OptionACompRationale } from './OptionACompPanel';

/** DEMO_MODE gate — mirrors `SimplifyWireframesPage`. */
function useDemoMode(): { ready: boolean; allowed: boolean } {
  const { data, isLoading } = useSystemStatus();
  if (isLoading) return { ready: false, allowed: false };
  return { ready: true, allowed: data?.demoMode === true };
}

/** Approved targets, in the order the operator should read them. */
const LAYOUTS = [
  { id: 'b', label: 'B · Slot cards / vote ladder' },
  { id: 'c', label: 'C · phone week editor (Option A)' },
  { id: 'd', label: 'D · Discord embed' },
];

/** Render the chosen candidate for the chosen state. */
function Candidate({ layout, state }: { layout: string; state: WfStateId }): JSX.Element {
  if (layout === 'c') return <OptionACompPanel />;
  if (layout === 'd') return <DiscordEmbedPanel state={state} />;
  return <LayoutBLadder state={state} />;
}

/** Rationale for the chosen candidate. */
function CandidateRationale({ layout }: { layout: string }): JSX.Element {
  if (layout === 'c') return <OptionACompRationale />;
  if (layout === 'd') return <DiscordEmbedRationale />;
  return <LayoutBRationale />;
}

/** Page header — what this is and where the reasoning lives. */
function Header(): JSX.Element {
  return (
    <header className="mb-5 border-b border-edge pb-3">
      <h1 className="text-xl font-semibold text-foreground">ROK-1540 — Scheduling poll revamp</h1>
      <p className="mt-1 text-sm text-secondary">
        Approved targets only — rejected candidates are recorded in the spike doc, not here. The poll page itself
        (B · slot cards / vote ladder) in desktop and 375px mobile, the phone week editor the poll's step 1 opens
        (C · Option A, ROK-1569), and the Discord embed the same state produces — today and after P2-2 + P4-1
        (ROK-1553). Pick a state to see how the page holds up. Mocked data only — nothing here talks to the API.
      </p>
      <p className="mt-1 text-xs text-amber-300">
        Audit, principles and implementation plan: <code className="text-amber-200">docs/spikes/rok-1540-scheduling-poll-audit.md</code>
        {' · '}supersedes the Ss/Sx sections of <code className="text-amber-200">web/src/dev/simplify-wireframes/README.md</code> where §Superseding Cycle 4 says so.
      </p>
    </header>
  );
}

/** DEMO_MODE-gated wireframe page — see file-level docstring. */
export function SchedulingWireframesPage(): JSX.Element | null {
  const { ready, allowed } = useDemoMode();
  const [layout, setLayout] = useState('b');
  const [state, setState] = useState<WfStateId>('open-unvoted');
  if (!ready) return null;
  if (!allowed) return <Navigate to="/" replace />;
  const poll = pollFor(state);
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Header />
      <div className="space-y-3">
        <LayoutPicker value={layout} options={LAYOUTS} onChange={setLayout} />
        <StatePicker value={state} onChange={setState} />
        <p data-testid="wf-state-note" className="rounded border border-edge bg-overlay/30 p-2 text-xs text-secondary">
          {poll.note}
        </p>
      </div>
      <div className="mt-5 space-y-4">
        <CandidateRationale layout={layout} />
        <Candidate layout={layout} state={state} />
      </div>
    </div>
  );
}
