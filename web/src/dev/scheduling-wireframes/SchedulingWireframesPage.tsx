/**
 * ROK-1540 — scheduling-poll revamp wireframes. DEMO_MODE-gated, dev-only.
 *
 * Three candidate layouts for the poll surface, each with a desktop and a
 * 375px mobile treatment, driven by a state switcher covering the state
 * matrix in `docs/spikes/rok-1540-scheduling-poll-audit.md` §2. All data is
 * mocked (`wireframe-states.ts`) — no API, no hooks, no router dependency
 * beyond the gate's redirect.
 *
 * Gated identically to `simplify-wireframes`: `useSystemStatus().demoMode`,
 * redirect to `/` when false, lazily imported from `lazy-routes.ts`.
 */
import { useState, type JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import { LayoutPicker, StatePicker } from './wireframe-chrome';
import { pollFor, type WfStateId } from './wireframe-states';
import { LayoutAHeatmap, LayoutARationale } from './LayoutAHeatmap';
import { LayoutBLadder, LayoutBRationale } from './LayoutBLadder';
import { LayoutCTimeline, LayoutCRationale } from './LayoutCTimeline';
import { DiscordEmbedPanel, DiscordEmbedRationale } from './DiscordEmbedPanel';

/** DEMO_MODE gate — mirrors `SimplifyWireframesPage`. */
function useDemoMode(): { ready: boolean; allowed: boolean } {
  const { data, isLoading } = useSystemStatus();
  if (isLoading) return { ready: false, allowed: false };
  return { ready: true, allowed: data?.demoMode === true };
}

/** Candidate ids, in the order the operator should read them. */
const LAYOUTS = [
  { id: 'a', label: 'A · Calendar-first heatmap' },
  { id: 'b', label: 'B · Slot cards / vote ladder' },
  { id: 'c', label: 'C · Conversation timeline' },
  { id: 'd', label: 'D · Discord embed' },
];

/** Render the chosen candidate for the chosen state. */
function Candidate({ layout, state }: { layout: string; state: WfStateId }): JSX.Element {
  if (layout === 'a') return <LayoutAHeatmap state={state} />;
  if (layout === 'c') return <LayoutCTimeline state={state} />;
  if (layout === 'd') return <DiscordEmbedPanel state={state} />;
  return <LayoutBLadder state={state} />;
}

/** Rationale for the chosen candidate. */
function CandidateRationale({ layout }: { layout: string }): JSX.Element {
  if (layout === 'a') return <LayoutARationale />;
  if (layout === 'c') return <LayoutCRationale />;
  if (layout === 'd') return <DiscordEmbedRationale />;
  return <LayoutBRationale />;
}

/** Page header — what this is and where the reasoning lives. */
function Header(): JSX.Element {
  return (
    <header className="mb-5 border-b border-edge pb-3">
      <h1 className="text-xl font-semibold text-foreground">ROK-1540 — Scheduling poll revamp</h1>
      <p className="mt-1 text-sm text-secondary">
        Three candidate layouts for the poll surface, each in desktop and 375px mobile, plus a fourth panel showing the
        Discord embed the same state produces — today and after P2-2 + P4-1 (ROK-1553). Pick a state to see how each one
        holds up. Mocked data only — nothing here talks to the API.
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
