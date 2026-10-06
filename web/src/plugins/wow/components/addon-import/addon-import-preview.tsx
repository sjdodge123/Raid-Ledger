/**
 * Preview step of the addon "Import string" dialog (ROK-1724 §4.4).
 *
 * Summary + class/level diff + provenance, then each warning as a `warning`
 * status banner (design-system §4.7). `RULESET_CHANGED` carries an optional
 * "Update ruleset" checkbox (→ `confirm.updateRuleset`); `GUID_CHANGED`
 * carries a REQUIRED one (→ `confirm.repinGuid`) — `canApplyAddonImport`
 * keeps Import disabled until it is ticked. `noop` / `stale` previews have
 * nothing to apply.
 */
import type { JSX, ReactNode } from 'react';
import { WOW_FOREVER_RULESET_LABELS, type AddonImportResultDto, type AddonImportWarning } from '@raid-ledger/contract';
import { canApplyAddonImport } from './addon-import.helpers';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Button } from '../../../../components/ui/button';
import { AddonImportSummary } from './addon-import-summary';
import { AddonImportErrorBanner } from './addon-import-error-banner';
import type { AddonImportConfirm } from './use-addon-import';

function rulesetLabel(value: AddonImportWarning['to']): string {
    if (typeof value !== 'string') return 'none';
    return (WOW_FOREVER_RULESET_LABELS as Record<string, string>)[value] ?? value;
}

const STATUS_NOTE: Partial<Record<AddonImportResultDto['status'], string>> = {
    noop: 'Already imported — this export has no new data.',
    stale: 'This export is older than the data already imported, so there is nothing to apply.',
};

function WarningBanner({ title, children }: { title: string; children?: ReactNode }): JSX.Element {
    return (
        <div data-testid="addon-import-warning" className="p-3 rounded-lg border bg-warning/10 border-warning/30">
            <p className="text-sm font-medium text-warning">{title}</p>
            {children}
        </div>
    );
}

interface WarningsProps {
    result: AddonImportResultDto;
    confirm: AddonImportConfirm;
    onConfirmChange: (next: AddonImportConfirm) => void;
}

function RulesetWarning({ warning, confirm, onConfirmChange }: Omit<WarningsProps, 'result'> & { warning: AddonImportWarning }): JSX.Element {
    const to = rulesetLabel(warning.to);
    return (
        <WarningBanner title={`The export says this character is on a ${to} realm, not ${rulesetLabel(warning.from)}.`}>
            <Checkbox
                label={`Update ruleset to ${to}`}
                checked={confirm.updateRuleset === true}
                onChange={(e) => onConfirmChange({ ...confirm, updateRuleset: e.target.checked })}
            />
        </WarningBanner>
    );
}

function GuidWarning({ confirm, onConfirmChange }: Omit<WarningsProps, 'result'>): JSX.Element {
    return (
        <WarningBanner title="This export comes from a different in-game character than the last import.">
            <Checkbox
                label="This is a different in-game character — link it instead"
                description="Required before importing."
                checked={confirm.repinGuid === true}
                onChange={(e) => onConfirmChange({ ...confirm, repinGuid: e.target.checked })}
            />
        </WarningBanner>
    );
}

function Warnings({ result, confirm, onConfirmChange }: WarningsProps): JSX.Element {
    return (
        <>
            {result.warnings.map((w) => {
                if (w.code === 'RULESET_CHANGED') return <RulesetWarning key={w.code} warning={w} confirm={confirm} onConfirmChange={onConfirmChange} />;
                if (w.code === 'GUID_CHANGED') return <GuidWarning key={w.code} confirm={confirm} onConfirmChange={onConfirmChange} />;
                if (w.code === 'STALE_EXPORT') return <WarningBanner key={w.code} title="This export is older than the data already imported." />;
                return null;
            })}
        </>
    );
}

export interface AddonImportPreviewProps extends WarningsProps {
    /** The last apply error, shown as a danger banner. */
    error?: unknown;
    gameId?: number | undefined;
}

export function AddonImportPreview(props: AddonImportPreviewProps): JSX.Element {
    const note = STATUS_NOTE[props.result.status];
    return (
        <div className="space-y-3">
            <AddonImportSummary result={props.result} />
            {note && <p data-testid="addon-import-status-note" className="text-sm text-secondary">{note}</p>}
            <Warnings result={props.result} confirm={props.confirm} onConfirmChange={props.onConfirmChange} />
            {props.error != null && <AddonImportErrorBanner error={props.error} gameId={props.gameId} />}
        </div>
    );
}

export interface AddonImportPreviewActionsProps {
    result: AddonImportResultDto;
    confirm: AddonImportConfirm;
    onBack: () => void;
    onImport: () => void;
    importing: boolean;
}

/** Footer for the preview step: Back + Import (gated by `canApplyAddonImport`). */
export function AddonImportPreviewActions(props: AddonImportPreviewActionsProps): JSX.Element {
    const allowed = canApplyAddonImport(props.result, props.confirm);
    return (
        <>
            <Button variant="ghost" disabled={props.importing} onClick={props.onBack}>Back</Button>
            <Button disabled={!allowed} loading={props.importing} loadingLabel="Importing…" onClick={() => { if (allowed) props.onImport(); }}>
                Import
            </Button>
        </>
    );
}
