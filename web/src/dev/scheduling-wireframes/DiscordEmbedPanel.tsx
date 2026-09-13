/**
 * Candidate D — "Discord embed" (ROK-1553) — DEV-ONLY wireframe.
 *
 * The fourth panel on `/dev/wireframes/scheduling`. Unlike A/B/C it does not
 * propose a web layout: it shows the SAME 11 mocked states as the Discord
 * message they produce, today and after audit items P2-2 + P4-1, so the
 * "Discord and the web tell the same story" principle (P-5) can be judged
 * side by side against candidate B rather than asserted.
 *
 * Grammar lives in `embed-grammar-today.ts` / `embed-grammar-target.ts`;
 * markup lives in `discord-chrome.tsx`. This file only arranges them.
 */
import type { JSX, ReactNode } from 'react';
import { Rationale } from './wireframe-chrome';
import { DiscordMessage, EmbedColumn } from './discord-chrome';
import { todayCaption, todayEmbed } from './embed-grammar-today';
import { STATE_RATIONALE, TARGET_OPEN_QUESTION, targetEmbed } from './embed-grammar-target';
import { pollFor, type WfStateId } from './wireframe-states';

/** Discord's own widths: a ~360px phone client and a ~600px desktop client. */
const WIDTHS = [
  { key: 'desktop', label: 'Discord desktop · 600px', width: 600 },
  { key: 'mobile', label: 'Discord mobile · 360px', width: 360 },
] as const;

/** Labelled wrapper around one rendered message at one client width. */
function Viewport({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/** Candidate D rendered for one state: Today and Target, each at both widths. */
export function DiscordEmbedPanel({ state }: { state: WfStateId }): JSX.Element {
  const p = pollFor(state);
  const today = todayEmbed(p);
  const target = targetEmbed(p);
  return (
    <div data-testid="wf-d-panel" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <EmbedColumn label="Today · shipped grammar" tone="today" caption={todayCaption(p)}>
        {WIDTHS.map((v) => (
          <Viewport key={v.key} label={v.label}>
            <DiscordMessage m={today} idPrefix={`de-today-${v.key}`} width={v.width} />
          </Viewport>
        ))}
      </EmbedColumn>
      <EmbedColumn
        label="Target · after P2-2 + P4-1"
        tone="target"
        caption={STATE_RATIONALE[state] ?? 'Mirrors Layout B: leader first, every slot, deadline, votable in place.'}
      >
        {WIDTHS.map((v) => (
          <Viewport key={v.key} label={v.label}>
            <DiscordMessage m={target} idPrefix={`de-target-${v.key}`} width={v.width} />
          </Viewport>
        ))}
      </EmbedColumn>
    </div>
  );
}

/** Candidate D's in-page pitch, trade-offs and the P4-1 open question. */
export function DiscordEmbedRationale(): JSX.Element {
  return (
    <div className="space-y-2">
      <Rationale
        pitch="The same 11 states as a Discord message, before and after. The target mirrors candidate B — leader first, every slot with counts and your own tick, the deadline, and one status grammar shared with the web page — then adds the thing the link cannot do: a vote cast without leaving Discord."
        wins={[
          'Closes the surface gap the audit ranks highest: a vote is castable where the community already is (F-17)',
          'The ephemeral reply is the only tractable answer to "did I vote?" on one shared message (F-16)',
          'Deadline (F-04) and the cancellation reason (F-02) finally reach Discord; cancelled stops reading as `■ POLL CLOSED`',
          'One status helper and one slot comparator for both surfaces — P-5 and F-03 become structural, not a convention',
        ]}
        costs={[
          'P4-1 REVERSES ROK-1461, which removed this action row on purpose — it needs an explicit operator ruling and the ROK-1461 rationale read first',
          'Gated on P2-3: if the masked "Vote now ↗" link already converts, this is a large change for a small delta',
          'Per-viewer state costs an interaction round-trip; the shared message still cannot personalise, so the embed body stays generic',
          'Bots cannot click other bots’ components — the handler needs a NestJS integration test, only the shape is smoke-testable',
        ]}
      />
      <p data-testid="wf-d-open-question" className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
        {TARGET_OPEN_QUESTION}
      </p>
    </div>
  );
}
