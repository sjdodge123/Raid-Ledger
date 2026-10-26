/**
 * ROK-1969 §3.5 — the Setup checklist inside a plugin card, under "Adds to
 * hubs" (operator rulings 2026-10-26). A native `<details>` disclosure (the
 * `ScrollCollapsible` idiom) that opens by itself while a required step is
 * left and stays closed once Ready. Unmet steps warn — they never block
 * Install or Activate. Unknown is always neutral.
 */
import type { JSX } from 'react';
import type { PluginInfoDto, PluginSetupRequirement, PluginSetupStatus } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { HubKindChip } from '../../../components/layout/hub-nav/hub-kind-chip';
import { SECTION_LABEL } from './plugin-hub-contributions';
import { PluginSetupRowBody } from './plugin-setup-row-body';
import { setupCountLine, setupRowState, statusFor, summarizeSetup, type SetupChipState } from './setup-summary';

/** The summary chip: "N steps left" / "Check setup" / "Ready" / "No setup needed". */
export function SetupSummaryChip({ summary }: { summary: SetupChipState }): JSX.Element {
    return <StatusChip tone={summary.tone} title={`Setup: ${summary.label}`}>{summary.label}</StatusChip>;
}

/** The card's Setup block — rows from `hub.setup.requirements`, state from `setupStatus`. */
export function PluginSetupChecklist({ plugin }: { plugin: PluginInfoDto }): JSX.Element {
    const reqs = plugin.hub.setup.requirements;
    const statuses = plugin.setupStatus ?? [];
    const summary = summarizeSetup(reqs, statuses);
    if (reqs.length === 0) {
        return (
            <div data-testid="plugin-setup" className="flex items-center gap-2">
                <span className={SECTION_LABEL}>Setup</span>
                <span className="flex-1" />
                <SetupSummaryChip summary={summary} />
            </div>
        );
    }
    return (
        <details data-testid="plugin-setup" open={summary.open || undefined}
            className="group/setup rounded-lg border border-edge/50 bg-surface/30 px-3 py-1">
            <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-2 select-none">
                <span aria-hidden="true" className="text-dim transition-transform group-open/setup:rotate-90">▸</span>
                <span className={SECTION_LABEL}>Setup</span>
                <span className="text-xs text-muted">{setupCountLine(summary)}</span>
                <span className="flex-1" />
                <SetupSummaryChip summary={summary} />
            </summary>
            <ul aria-label="Setup steps">
                {reqs.map((r) => <PluginSetupRow key={r.id} req={r} status={statusFor(statuses, r.id)} />)}
            </ul>
        </details>
    );
}

/**
 * The row's chip group. Below `sm` it takes a full line under the title, indented
 * past the ▸ (approved mockup, phone 343px) — beside the title it squeezed a
 * long title to one word per line and an optional row's title to ~5px.
 */
const ROW_CHIPS = 'flex w-full flex-wrap justify-start gap-1.5 pl-5 sm:w-auto sm:justify-end sm:pl-0';

/** One requirement: title, live detail, Optional / hub-kind / state chips; expands to its steps. */
function PluginSetupRow({ req, status }: { req: PluginSetupRequirement; status: PluginSetupStatus | undefined }): JSX.Element {
    const chip = setupRowState(req, status);
    const open = req.required && status?.state === 'unmet';
    return (
        <li data-testid={`setup-row-${req.id}`} className="border-t border-edge-subtle">
            <details open={open || undefined} className="group/row">
                <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-start gap-2 py-2 select-none">
                    <span aria-hidden="true" className="mt-0.5 text-dim transition-transform group-open/row:rotate-90">▸</span>
                    <span data-testid="setup-row-title" className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{req.title}</span>
                        {status?.detail && <span className="block text-xs text-muted">{status.detail}</span>}
                    </span>
                    <span data-testid="setup-row-chips" className={ROW_CHIPS}>
                        {!req.required && <StatusChip tone="neutral" title="Optional — the plugin works without it">Optional</StatusChip>}
                        {(req.appliesTo ?? []).map((k) => <HubKindChip key={k} kind={k} />)}
                        <StatusChip tone={chip.tone} title={`Setup step: ${chip.label}`}>{chip.label}</StatusChip>
                    </span>
                </summary>
                <PluginSetupRowBody req={req} />
            </details>
        </li>
    );
}
