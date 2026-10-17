/**
 * Mock components for the channel-binding admin wireframe (ROK-1416).
 * Static visuals only — no state wiring, no network. DEMO_MODE-gated preview.
 */
import type { JSX } from 'react';

const INPUT = 'w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-sm';
const PILL = 'inline-block px-2 py-0.5 text-[10px] rounded';

function PurposeChip({ label, tone, active }: { label: string; tone: string; active?: boolean }): JSX.Element {
  return (
    <span className={`${PILL} ${tone} ${active ? 'ring-2 ring-emerald-400' : 'opacity-60'}`}>{label}</span>
  );
}

/* ─────────────── EDIT — BEFORE (today's 3-field form) ─────────────── */
export function BindingEditBefore(): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-foreground font-medium">#General</span>
        <PurposeChip label="Activity Monitor" tone="bg-purple-600/40 text-purple-200" active />
        <span className="text-muted">All games · Quick Play (Activity Monitoring)</span>
      </div>
      <div className="bg-overlay/30 border border-edge rounded-lg p-3 space-y-3">
        <div className="text-[11px] font-medium text-foreground">Edit Config: #General</div>
        <div>
          <div className="text-[10px] text-muted mb-1">Minimum Players (to spawn Quick Play event)</div>
          <div className={INPUT}>2</div>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-foreground"><input type="checkbox" defaultChecked readOnly /> Auto-close event when voice empties</label>
        <div>
          <div className="text-[10px] text-muted mb-1">Grace Period (minutes before closing)</div>
          <div className={INPUT}>5</div>
        </div>
        <div className="flex gap-2 pt-1">
          <span className={`${PILL} bg-emerald-600 text-white`}>Save</span>
          <span className={`${PILL} bg-overlay text-foreground`}>Cancel</span>
        </div>
      </div>
      <div className="text-[10px] text-red-300 font-mono">No purpose field · no game field · a mis-bound channel can never be corrected here — only Remove + /bind in Discord</div>
    </div>
  );
}

/* ─────────────── EDIT — AFTER (purpose + game + inline heal) ─────────────── */
export function BindingEditAfter(): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-foreground font-medium">#General</span>
        <PurposeChip label="General Lobby" tone="bg-amber-600/40 text-amber-200" active />
        <span className="text-muted">All games · General Lobby</span>
      </div>

      {/* Inert-binding heal banner (ROK-1415 one-click repair lives here) */}
      <div className="border border-red-500/40 bg-red-500/10 rounded-lg p-2 text-[10px]">
        <div className="text-red-200 font-medium">⚠ This voice monitor has no game — Quick Play can never fire on it.</div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-red-300/80">Pick a game below, or convert to a General Lobby (any game, auto-detected).</span>
          <span className={`${PILL} bg-emerald-600 text-white`}>Convert to General Lobby</span>
        </div>
      </div>

      <div className="bg-overlay/30 border border-edge rounded-lg p-3 space-y-3">
        <div className="text-[11px] font-medium text-foreground">Edit Config: #General</div>

        {/* Purpose selector — segmented */}
        <div>
          <div className="text-[10px] text-muted mb-1">Purpose</div>
          <div className="flex gap-1">
            <PurposeChip label="Announcements" tone="bg-sky-600/40 text-sky-200" />
            <PurposeChip label="Activity Monitor" tone="bg-purple-600/40 text-purple-200" />
            <PurposeChip label="General Lobby" tone="bg-amber-600/40 text-amber-200" active />
          </div>
          <div className="text-[9px] text-muted mt-1">Voice + a game = Activity Monitor · Voice, no game = General Lobby · Text = Announcements. The form won't let you save an invalid combination.</div>
        </div>

        {/* Game field — appears only for Activity Monitor / Announcements; greyed for lobby */}
        <div className="opacity-40">
          <div className="text-[10px] text-muted mb-1">Game <span className="text-muted/70">(not needed for General Lobby — detected live)</span></div>
          <div className={`${INPUT} flex items-center justify-between`}><span className="text-muted">All games</span><span className="text-muted">▾</span></div>
        </div>

        {/* allowJustChatting appears live when General Lobby selected (no page reload) */}
        <label className="flex items-center gap-2 text-[11px] text-foreground"><input type="checkbox" readOnly /> Allow &quot;Just Chatting&quot; events (no game required)</label>

        <div>
          <div className="text-[10px] text-muted mb-1">Minimum Players</div>
          <div className={INPUT}>2</div>
        </div>
        <div className="flex gap-2 pt-1">
          <span className={`${PILL} bg-emerald-600 text-white`}>Save</span>
          <span className={`${PILL} bg-overlay text-foreground`}>Cancel</span>
        </div>
      </div>
      <div className="text-[10px] text-emerald-300 font-mono">Purpose + game editable · invalid combos rejected by the shared validateBindingTriple classifier · config preserved across purpose change</div>
    </div>
  );
}

/* ─────────────── LIST ROW — inert-binding detection (BEFORE/AFTER) ─────────────── */
export function InertRowBefore(): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between bg-overlay/30 border border-edge rounded-lg p-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-muted">🎙</span>
          <span className="text-foreground">#General</span>
          <PurposeChip label="Activity Monitor" tone="bg-purple-600/40 text-purple-200" />
          <span className="text-muted">All games · Quick Play (Activity Monitoring)</span>
        </div>
        <div className="flex gap-1"><span className={`${PILL} bg-overlay text-foreground`}>Edit</span><span className={`${PILL} bg-red-600/30 text-red-200`}>Remove</span></div>
      </div>
      <div className="text-[10px] text-red-300 font-mono">Looks healthy · advertises &quot;Quick Play&quot; · silently inert for months · no signal anywhere</div>
    </div>
  );
}

export function InertRowAfter(): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between bg-red-500/5 border border-red-500/30 rounded-lg p-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-red-300">🎙</span>
          <span className="text-foreground">#General</span>
          <PurposeChip label="Activity Monitor" tone="bg-purple-600/40 text-purple-200" />
          <span className={`${PILL} bg-red-600/40 text-red-100`}>⚠ INERT — Quick Play can&apos;t fire</span>
        </div>
        <div className="flex gap-1"><span className={`${PILL} bg-emerald-600 text-white`}>Fix →</span><span className={`${PILL} bg-overlay text-foreground`}>Edit</span></div>
      </div>
      <div className="text-[10px] text-emerald-300 font-mono">Same detection that fires the boot WARN + Sentry alert · &quot;Fix →&quot; one-click converts to General Lobby (the guided repair)</div>
    </div>
  );
}

/* ─────────────── CREATE FORM (BEFORE/AFTER) ─────────────── */
export function CreateBefore(): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted">Map Discord channels to games. Use <code className="text-foreground bg-overlay px-1 rounded">/bind</code> in Discord for quick setup, or manage bindings here.</div>
      <div className="border border-dashed border-edge rounded-lg p-3 text-[11px] text-muted text-center">…or add one below</div>
      <div className="text-[10px] text-red-300 font-mono">Copy promises a create form · the createBinding hook exists · but nothing is wired — dead affordance</div>
    </div>
  );
}

export function CreateAfter(): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="bg-overlay/30 border border-edge rounded-lg p-3 space-y-3">
        <div className="text-[11px] font-medium text-foreground">New binding</div>
        <div>
          <div className="text-[10px] text-muted mb-1">Channel</div>
          <div className={`${INPUT} flex items-center justify-between`}><span className="text-muted">Select a channel…</span><span className="text-muted">▾</span></div>
        </div>
        <div>
          <div className="text-[10px] text-muted mb-1">Purpose</div>
          <div className="flex gap-1">
            <PurposeChip label="Announcements" tone="bg-sky-600/40 text-sky-200" />
            <PurposeChip label="Activity Monitor" tone="bg-purple-600/40 text-purple-200" active />
            <PurposeChip label="General Lobby" tone="bg-amber-600/40 text-amber-200" />
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted mb-1">Game <span className="text-red-300">*required for Activity Monitor</span></div>
          <div className={`${INPUT} flex items-center justify-between`}><span className="text-muted">Search games…</span><span className="text-muted">▾</span></div>
        </div>
        <div className="flex gap-2 pt-1"><span className={`${PILL} bg-emerald-600 text-white`}>Create binding</span><span className={`${PILL} bg-overlay text-foreground`}>Cancel</span></div>
      </div>
      <div className="text-[10px] text-emerald-300 font-mono">Wires the existing createBinding hook · same validateBindingTriple guard as edit · &quot;Create binding&quot; disabled until the combo is valid</div>
    </div>
  );
}
