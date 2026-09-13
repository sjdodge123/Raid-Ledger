/**
 * Candidate C — "Conversation-style timeline" (ROK-1540) — DEV-ONLY wireframe.
 *
 * The poll reads as a thread: who proposed what, who joined which time, and
 * what the group is converging on. A pinned "verdict" bar keeps the answer on
 * screen (P-1) while the feed below carries the social pressure that makes a
 * poll close — the thing neither a grid nor a ladder can express.
 */
import type { JSX } from 'react';
import { Treatments, Faces, StatusPill, Rationale, Chip } from './wireframe-chrome';
import { pollFor, statusLine, leader, isTied, type WfPoll, type WfSlot, type WfStateId } from './wireframe-states';

/** Sticky verdict bar — the answer, always on screen. */
function Verdict({ p }: { p: WfPoll }): JSX.Element {
  const top = leader(p);
  const tone = p.status === 'locked' ? 'locked' : p.status === 'open' ? 'open' : 'closed';
  const headline =
    p.status === 'locked' ? `Locked in — ${p.lockedTime}`
      : p.status === 'cancelled' ? 'Cancelled'
        : p.status === 'closed' ? 'Poll closed with no lock-in'
          : top ? `Converging on ${top.day} ${top.time}` : 'Waiting on a first time';
  return (
    <div data-testid="wf-c-verdict" className="sticky top-0 z-10 rounded-lg border border-edge bg-surface p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{headline}</span>
        <StatusPill text={statusLine(p)} tone={tone} />
      </div>
      <p className="mt-0.5 text-[11px] text-muted">
        {top ? `${top.votes} of ${p.members} in${isTied(p) ? ' · tied, earliest wins' : ''} · ` : ''}{p.deadline ?? 'no deadline'}
      </p>
    </div>
  );
}

/** One thread entry: a proposed time and who has joined it. */
function Entry({ p, s }: { p: WfPoll; s: WfSlot }): JSX.Element {
  const interactive = p.canVote && p.status === 'open' && !s.past;
  return (
    <li data-testid={`wf-c-entry-${s.id}`} className="relative pl-5">
      <span aria-hidden="true" className={`absolute left-1 top-3 h-2 w-2 rounded-full ${s.mine ? 'bg-emerald-400' : 'bg-overlay'}`} />
      <div className="rounded-lg border border-edge bg-panel/50 p-2.5">
        <p className="text-[11px] text-muted">
          <span className="text-secondary">{s.voters[0] ?? 'Someone'}</span> proposed · {s.relative}
        </p>
        <p className="mt-0.5 text-sm font-medium text-foreground">
          {s.day} {s.time}
          {s.past && <span className="ml-1 text-[11px] text-muted">· past</span>}
        </p>
        <p className="mt-1 flex items-center gap-2 text-xs text-secondary">
          <Faces names={s.voters} />
          {s.votes === 1 ? '1 person is in' : `${s.votes} people are in`}
          {s.mine && <span className="text-emerald-300">· including you</span>}
        </p>
        {s.conflict && <p className="mt-1 text-[11px] text-amber-300">⚠ You're already signed up for “{s.conflict}” then</p>}
        {interactive && (
          <button
            type="button"
            aria-pressed={s.mine}
            data-testid={`wf-c-join-${s.id}`}
            aria-label={`${s.mine ? "Leave" : "I'm in for"} ${s.day} ${s.time}`}
            className={`mt-2 min-h-[44px] w-full rounded-md border px-3 text-sm font-medium transition-colors ${
              s.mine ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-edge bg-surface text-foreground hover:border-emerald-500/60'
            }`}
          >
            {s.mine ? "✓ You're in — tap to leave" : "I'm in"}
          </button>
        )}
      </div>
    </li>
  );
}

/** Terminal-state footer: what happened and what to do next. */
function Outcome({ p }: { p: WfPoll }): JSX.Element | null {
  if (p.status === 'open') return null;
  const copy =
    p.status === 'locked' ? { tone: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200', text: `${p.lockedTime} won. You were signed up automatically.`, cta: 'Open the event →' }
      : p.status === 'cancelled' ? { tone: 'border-rose-500/40 bg-rose-500/10 text-rose-200', text: `Cancelled — “${p.reason}”`, cta: 'Back to events →' }
        : { tone: 'border-edge bg-overlay/40 text-muted', text: 'The deadline passed without a lock-in.', cta: 'Start a new poll →' };
  return (
    <div data-testid="wf-c-outcome" className={`mt-3 rounded-lg border p-2.5 text-sm ${copy.tone}`}>
      {copy.text} <span className="underline">{copy.cta}</span>
    </div>
  );
}

/** Feed body shared by both viewports. */
function Feed({ p }: { p: WfPoll }): JSX.Element {
  const entries = [...p.slots].sort((a, b) => b.votes - a.votes || a.id - b.id);
  return (
    <div className="mt-3">
      {p.lateJoiner && (
        <p data-testid="wf-c-catchup" className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
          Catching up: {p.voters} of {p.members} have voted, {leader(p)?.day} is ahead, and the poll {p.deadline}.
        </p>
      )}
      {entries.length === 0 ? (
        <p className="rounded border border-dashed border-edge p-3 text-center text-sm text-secondary">
          Nothing proposed yet — start the thread.
        </p>
      ) : (
        <ul data-testid="wf-c-feed" className="space-y-2 border-l border-edge">
          {entries.map((s) => <Entry key={s.id} p={p} s={s} />)}
        </ul>
      )}
      {p.canVote && p.status === 'open' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip>+ Propose a time</Chip>
          <Chip>View group availability</Chip>
        </div>
      )}
      {!p.canVote && <p className="mt-2 text-xs text-muted">Read-only — you're not in this poll.</p>}
      <Outcome p={p} />
    </div>
  );
}

/** Candidate C rendered for one state, desktop + mobile. */
export function LayoutCTimeline({ state }: { state: WfStateId }): JSX.Element {
  const p = pollFor(state);
  return (
    <Treatments
      desktop={
        <div data-testid="wf-c-desktop" className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
          <div>
            <Verdict p={p} />
            <Feed p={p} />
          </div>
          <aside className="rounded-lg border border-edge bg-surface p-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">Who's still out</p>
            <p className="mt-1 text-xs text-secondary">{p.members - p.voters} of {p.members} haven't voted.</p>
            <div className="mt-2 h-24 rounded bg-overlay/40" aria-label="Group availability heatmap" />
            <p className="mt-2 text-[10px] text-muted">Availability sits beside the thread on desktop; it collapses on mobile.</p>
          </aside>
        </div>
      }
      mobile={
        <div data-testid="wf-c-mobile">
          <Verdict p={p} />
          <Feed p={p} />
        </div>
      }
    />
  );
}

/** Candidate C's in-page rationale. */
export function LayoutCRationale(): JSX.Element {
  return (
    <Rationale
      pitch="Everything above the strip is the shipped header and stays; Layout C replaces the body only. The poll reads as a thread — who proposed a time, who is in, who is still missing. A sticky verdict bar carries the answer; the feed carries the social pressure that actually closes a poll."
      wins={[
        'Best late-joiner story of the three: the catch-up line is native to the format, not bolted on (P-6)',
        "\"N people are in\" is the framing Discord already uses, so embed and web converge on one vocabulary (P-5)",
        'Naming who has NOT voted is the honest lever for a stalled poll, and only this layout has room for it',
        'Verdict bar is sticky and short, so the answer survives scrolling on mobile without hiding the action (F-08)',
      ]}
      costs={[
        'The least dense — a 6-slot poll is a long scroll where the ladder would fit on one screen',
        'Ordering is a genuine fork: by votes reads as a ranking, chronological reads as a conversation; it cannot be both',
        'Conversation framing invites comments, which is real scope (moderation, notifications) not in this spike',
        'Furthest from the shipped component tree — the most expensive of the three to build',
      ]}
    />
  );
}
