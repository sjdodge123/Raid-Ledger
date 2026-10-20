/**
 * What a create-route import will do (ROK-1738 D3/D10): a §4.7 status banner
 * above the preview summary. `create` → success tone, "Creates <Name> · <REGION>
 * · <ruleset> · Level <n> <Class>"; `update` → warning tone with the ruled copy
 * "Already on your account — this will update <name>". Tokens only.
 */
import type { JSX } from 'react';
import { WOW_FOREVER_RULESET_LABELS, type AddonImportRulesetInferenceDto, type AddonImportTargetDto } from '@raid-ledger/contract';
import { selectableInference } from './addon-import.helpers';

/** Shown in the create line when the export carries no ruleset (the picker below asks for one). */
const RULESET_NOT_IN_EXPORT = 'ruleset not in export';

/** ROK-1739 §6.3: a selectable realm inference stands in for the missing export ruleset, labelled as inferred. */
function rulesetText(target: AddonImportTargetDto, inference: AddonImportRulesetInferenceDto | undefined): string {
    if (target.ruleset !== null) return WOW_FOREVER_RULESET_LABELS[target.ruleset];
    const inferred = selectableInference(inference);
    if (!inferred || !inference) return RULESET_NOT_IN_EXPORT;
    return `${WOW_FOREVER_RULESET_LABELS[inferred]} (inferred from ${inference.realmName})`;
}

function createTargetLine(target: AddonImportTargetDto, inference: AddonImportRulesetInferenceDto | undefined): string {
    const ruleset = rulesetText(target, inference);
    return `Creates ${target.name} · ${target.region.toUpperCase()} · ${ruleset} · Level ${target.level} ${target.class}`;
}

function updateTargetLine(target: AddonImportTargetDto): string {
    return `Already on your account — this will update ${target.name}`;
}

const TONE: Record<AddonImportTargetDto['action'], string> = {
    create: 'bg-success/10 border-success/30 text-success',
    update: 'bg-warning/10 border-warning/30 text-warning',
};

export interface AddonImportTargetBannerProps {
    target: AddonImportTargetDto;
    /** ROK-1739: the preview's realm inference, shown in place of a missing export ruleset. */
    inference?: AddonImportRulesetInferenceDto | undefined;
}

export function AddonImportTargetBanner({ target, inference }: AddonImportTargetBannerProps): JSX.Element {
    const line = target.action === 'create' ? createTargetLine(target, inference) : updateTargetLine(target);
    return (
        <div data-testid="addon-import-target" data-action={target.action} className={`p-3 rounded-lg border ${TONE[target.action]}`}>
            <p className="text-sm font-medium">{line}</p>
        </div>
    );
}
