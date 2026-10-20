/**
 * Preview step of the addon "Import string" dialog (ROK-1724 §4.4).
 *
 * Summary + class/level diff + provenance, then each warning as a `warning`
 * status banner (design-system §4.7). `RULESET_CHANGED` carries an optional
 * "Update ruleset" checkbox (→ `confirm.updateRuleset` + the previewed
 * `updateRulesetTo`); `GUID_CHANGED`
 * carries a REQUIRED one (→ `confirm.repinGuid`) — `canApplyAddonImport`
 * keeps Import disabled until it is ticked. `noop` / `stale` previews have
 * nothing to apply.
 *
 * ROK-1738 create route: the resolved `target` banner sits above the summary,
 * and when the export has no ruleset the segmented Ruleset picker follows it;
 * Import stays disabled until a ruleset is picked (D13).
 */
import type { JSX, ReactNode } from 'react';
import {
    WOW_FOREVER_RULESET_LABELS,
    WowForeverRulesetSchema,
    type AddonImportResultDto,
    type AddonImportRulesetInferenceDto,
    type AddonImportTargetDto,
    type AddonImportWarning,
    type WowForeverSelectableRuleset,
} from '@raid-ledger/contract';
import { canApplyAddonImport, rulesetPickerHint } from './addon-import.helpers';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Button } from '../../../../components/ui/button';
import { AddonImportSummary } from './addon-import-summary';
import { AddonImportErrorBanner } from './addon-import-error-banner';
import { AddonImportTargetBanner } from './addon-import-target-banner';
import { AddonImportRulesetPicker, RULESET_HINT_ID } from './addon-import-ruleset-picker';
import { needsRulesetPick } from './use-addon-import-flow';
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

const INFERENCE_SOURCE: Record<AddonImportRulesetInferenceDto['source'], string> = {
    'realm-map': 'Inferred from the realm list your admin maintains — not from the export.',
    blizzard: 'Inferred from Blizzard\'s realm data.',
};

type RulesetWarningProps = Omit<WarningsProps, 'result'> & { warning: AddonImportWarning; inference: AddonImportRulesetInferenceDto | undefined };

/** ROK-1739 §6.2: an inferred change names the realm; without an inference the copy is unchanged. */
function rulesetWarningTitle(warning: AddonImportWarning, inference: AddonImportRulesetInferenceDto | undefined): string {
    const to = rulesetLabel(warning.to);
    const from = rulesetLabel(warning.from);
    if (inference) return `Realm "${inference.realmName}" is listed as ${to} — this character is ${from} here.`;
    return `The export says this character is on a ${to} realm, not ${from}.`;
}

/**
 * ROK-1739 (Codex r2 P2): ticking the box approves the previewed `to`, sent as
 * `updateRulesetTo` so the apply refuses a value the realm map changed to since.
 */
function withRulesetConfirm(confirm: AddonImportConfirm, checked: boolean, to: unknown): AddonImportConfirm {
    const approved = WowForeverRulesetSchema.safeParse(to);
    return {
        ...(confirm.repinGuid !== undefined ? { repinGuid: confirm.repinGuid } : {}),
        updateRuleset: checked,
        ...(checked && approved.success ? { updateRulesetTo: approved.data } : {}),
    };
}

function RulesetWarning({ warning, inference, confirm, onConfirmChange }: RulesetWarningProps): JSX.Element {
    const to = rulesetLabel(warning.to);
    return (
        <WarningBanner title={rulesetWarningTitle(warning, inference)}>
            {inference && <p data-testid="addon-import-inference-source" className="text-sm text-secondary">{INFERENCE_SOURCE[inference.source]}</p>}
            <Checkbox
                label={`Update ruleset to ${to}`}
                checked={confirm.updateRuleset === true}
                onChange={(e) => onConfirmChange(withRulesetConfirm(confirm, e.target.checked, warning.to))}
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
                if (w.code === 'RULESET_CHANGED') {
                    return <RulesetWarning key={w.code} warning={w} inference={result.rulesetInference} confirm={confirm} onConfirmChange={onConfirmChange} />;
                }
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
    /** Re-runs the preview with the same string — offered on `RULESET_CONFIRM_STALE`. */
    onPreviewAgain?: (() => void) | undefined;
    previewing?: boolean | undefined;
    /** Create route only: what the import will create or update. */
    target?: AddonImportTargetDto | null | undefined;
    /** Create route only: the picked ruleset when the export has none (D13). */
    ruleset?: WowForeverSelectableRuleset | null | undefined;
    onRulesetChange?: ((value: WowForeverSelectableRuleset) => void) | undefined;
}

type TargetSectionProps = Pick<AddonImportPreviewProps, 'target' | 'ruleset' | 'onRulesetChange'> & { inference: AddonImportRulesetInferenceDto | undefined };

function TargetSection({ target, ruleset, onRulesetChange, inference }: TargetSectionProps): JSX.Element | null {
    if (!target) return null;
    const pick = needsRulesetPick(target) && onRulesetChange;
    return (
        <>
            <AddonImportTargetBanner target={target} inference={inference} pick={ruleset} />
            {pick && <AddonImportRulesetPicker value={ruleset ?? null} onChange={pick} hint={rulesetPickerHint(inference)} />}
        </>
    );
}

export function AddonImportPreview(props: AddonImportPreviewProps): JSX.Element {
    const note = STATUS_NOTE[props.result.status];
    return (
        <div className="space-y-3">
            <TargetSection target={props.target} ruleset={props.ruleset} onRulesetChange={props.onRulesetChange} inference={props.result.rulesetInference} />
            <AddonImportSummary result={props.result} />
            {note && <p data-testid="addon-import-status-note" className="text-sm text-secondary">{note}</p>}
            <Warnings result={props.result} confirm={props.confirm} onConfirmChange={props.onConfirmChange} />
            {props.error != null && <AddonImportErrorBanner error={props.error} gameId={props.gameId} onPreviewAgain={props.onPreviewAgain} previewing={props.previewing} />}
        </div>
    );
}

export interface AddonImportPreviewActionsProps {
    result: AddonImportResultDto;
    confirm: AddonImportConfirm;
    onBack: () => void;
    onImport: () => void;
    importing: boolean;
    /** True while the create target still needs a ruleset pick (D13). */
    rulesetMissing?: boolean | undefined;
}

/** Footer for the preview step: Back + Import (gated by `canApplyAddonImport`). */
export function AddonImportPreviewActions(props: AddonImportPreviewActionsProps): JSX.Element {
    const allowed = canApplyAddonImport(props.result, props.confirm) && !props.rulesetMissing;
    return (
        <>
            <Button variant="ghost" disabled={props.importing} onClick={props.onBack}>Back</Button>
            <Button
                disabled={!allowed} loading={props.importing} loadingLabel="Importing…" onClick={() => { if (allowed) props.onImport(); }}
                aria-describedby={props.rulesetMissing ? RULESET_HINT_ID : undefined}
            >
                Import
            </Button>
        </>
    );
}
