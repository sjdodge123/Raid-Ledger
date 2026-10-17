/**
 * ROK-1569 — the approved phone week-editor comp (Option A), embedded as a
 * wireframe panel so the operator can read the target next to the poll page
 * it belongs to.
 *
 * The comp is a self-contained HTML document (its own tokens, fonts and mock
 * JS), so it is imported `?raw` and rendered in a sandbox-free `srcDoc`
 * iframe rather than being ported to React — porting it would make it a
 * second implementation of the thing Lane A is actually building.
 *
 * Rejected Option B (three-day window) is NOT in this copy: this route shows
 * decisions only. Its reasoning is in
 * `docs/spikes/rok-1540-scheduling-poll-audit.md`.
 */
import type { JSX } from 'react';
import compHtml from './rok-1569-option-a-comp.html?raw';
import { Rationale } from './wireframe-chrome';

/** Why this panel exists and what it is the target for. */
export function OptionACompRationale(): JSX.Element {
  return (
    <Rationale
      pitch="The operator pick (2026-09-14) for step 1 of the poll on phones: one day per screen, stepped with the arrows or a horizontal swipe, the shipped ROK-1426 block editor filling the sheet with no inner scroll, and a seven-column week-at-a-glance strip that doubles as the day picker. Desktop keeps the full 7 x evening grid."
      wins={[
        'Rows stay ~52px and drag handles ~34px at 375 x 812 — above the 44px target rule the three-day window could not hold',
        'The mini strip shows the shape of all seven days at once and is the day picker, so the week is never out of sight',
        'Smallest delta on the shipped block editor: same slot model, one column rendered',
      ]}
      costs={[
        'More gestures than a multi-day window for someone editing four separate evenings — mitigated by "Same as last week" answering the common case in one tap',
        'Rejected alongside it: day-chip tabs, copy-to-weekdays/weekend and the three-day window (reasoning in the spike doc, not here)',
      ]}
    />
  );
}

/** The comp itself, in an iframe so its own stylesheet cannot leak into the app. */
export function OptionACompPanel(): JSX.Element {
  return (
    <div data-testid="wf-option-a-comp" className="rounded-lg border border-edge bg-surface p-2">
      <iframe
        title="ROK-1569 Option A comp"
        data-testid="wf-option-a-comp-frame"
        srcDoc={compHtml}
        className="h-[900px] w-full rounded border-0"
      />
    </div>
  );
}
