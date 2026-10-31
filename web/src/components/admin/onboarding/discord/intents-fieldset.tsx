import { useState } from 'react';
import { PRIVILEGED_INTENT_LABELS, type PrivilegedIntent } from '@raid-ledger/contract';
import { Checkbox } from '../../../ui/checkbox';
import { StatusChip } from '../../../ui/status-chip';
import { APP_ID_RE, missingIntentsMessage } from './keys-validation';

const INTENTS: PrivilegedIntent[] = ['presence', 'guildMembers', 'messageContent'];

function botPageUrl(appId: string): string {
    const id = appId.trim();
    return APP_ID_RE.test(id) ? `https://discord.com/developers/applications/${id}/bot` : 'https://discord.com/developers/applications';
}

type Ticks = Partial<Record<PrivilegedIntent, boolean>>;

/**
 * Controlled ticks: each box follows the latest detection (on → ticked) until
 * the owner toggles it (OQ-7: the owner's checklist). A new detection result
 * (a different `missing` list) drops the owner's overrides so the boxes match it.
 */
function useIntentTicks(missing: PrivilegedIntent[] | undefined) {
    const sig = missing === undefined ? 'unchecked' : missing.join(',');
    const [owner, setOwner] = useState<{ sig: string; ticks: Ticks }>({ sig, ticks: {} });
    const ticks = owner.sig === sig ? owner.ticks : {};
    const isTicked = (k: PrivilegedIntent) => ticks[k] ?? (missing ? !missing.includes(k) : false);
    const setTicked = (k: PrivilegedIntent, on: boolean) => setOwner({ sig, ticks: { ...ticks, [k]: on } });
    return { isTicked, setTicked };
}

/**
 * 4c — "On the Bot page, turn on three switches" (AC-5). The checkboxes are
 * the admin's own checklist, filled in from detection; the on/off chips appear
 * once the token check has read the application's flags (`missingIntents` defined).
 */
export function IntentsFieldset({ appId, missing }: { appId: string; missing: PrivilegedIntent[] | undefined }) {
    const { isTicked, setTicked } = useIntentTicks(missing);
    return (
        <fieldset className="rounded-lg border border-edge p-4 space-y-3">
            <legend className="px-1 text-sm font-semibold text-foreground">On the Bot page, turn on three switches</legend>
            {INTENTS.map((k) => (
                <div key={k} className="flex items-center justify-between gap-3">
                    <Checkbox label={PRIVILEGED_INTENT_LABELS[k]} checked={isTicked(k)} onChange={(e) => setTicked(k, e.target.checked)} />
                    {missing && (missing.includes(k)
                        ? <StatusChip tone="danger" title={`${PRIVILEGED_INTENT_LABELS[k]} is off`}>off</StatusChip>
                        : <StatusChip tone="success" title={`${PRIVILEGED_INTENT_LABELS[k]} is on`}>on</StatusChip>)}
                </div>
            ))}
            {missing && missing.length > 0 && <p role="alert" className="text-sm text-danger">{missingIntentsMessage(missing)}</p>}
            <p className="text-sm text-secondary">Then click Save Changes. Without them the bot can't see members or read signups.</p>
            <a href={botPageUrl(appId)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-foreground underline underline-offset-2">Open the Bot page</a>
        </fieldset>
    );
}
