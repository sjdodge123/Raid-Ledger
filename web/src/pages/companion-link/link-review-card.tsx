/** ROK-1955 — `/link` review state: check the computer, then Approve or Deny. */
import { useState } from 'react';
import type { JSX } from 'react';
import { CompanionDeviceNameSchema } from '@raid-ledger/contract';
import type { CompanionLinkPreview } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import type { CompanionLinkErrorKind } from '../../hooks/use-companion-link';
import { LinkCard } from './link-card';
import { LinkErrorAlert } from './link-error-copy';
import { LinkReviewDetails, LinkWarningBanner } from './link-review-details';

export type LinkDecision = 'approve' | 'deny';

interface LinkReviewCardProps {
    preview: CompanionLinkPreview;
    nowMs: number;
    pending: LinkDecision | null;
    errorKind: CompanionLinkErrorKind | null;
    /** `name` is set only when the approver changed it. */
    onDecide: (decision: LinkDecision, name?: string) => void;
}

const NAME_ERROR = 'Use 1–64 characters, no line breaks.';

/**
 * Shown when this device's clock is past `expiresAt`. A soft hint only: the
 * clock may be wrong, so Approve stays and the server's 404 is the answer.
 */
function MaybeExpiredHint({ preview, nowMs }: { preview: CompanionLinkPreview; nowMs: number }): JSX.Element | null {
    if (Date.parse(preview.expiresAt) > nowMs) return null;
    return <p className="mt-3 text-sm text-warning">This code may have expired. If Approve fails, start again on your computer.</p>;
}

/** The review card. Nothing is sent until Approve / Deny is clicked. */
export function LinkReviewCard(props: LinkReviewCardProps): JSX.Element {
    const original = props.preview.device.name;
    const [name, setName] = useState(original);
    const parsed = CompanionDeviceNameSchema.safeParse(name);
    const busy = props.pending !== null;
    const approve = (): void => {
        if (!parsed.success) return;
        if (parsed.data === original) props.onDecide('approve');
        else props.onDecide('approve', parsed.data);
    };
    return (
        <LinkCard title="Link this computer to your account?">
            <Field label="Device name" error={parsed.success ? undefined : NAME_ERROR} className="mt-3">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoComplete="off" />
            </Field>
            <LinkReviewDetails preview={props.preview} nowMs={props.nowMs} />
            <MaybeExpiredHint preview={props.preview} nowMs={props.nowMs} />
            <LinkWarningBanner differentNetwork={!props.preview.sameNetworkAsYou} />
            <p className="mt-3 text-xs text-muted">
                It can upload game data from the Companion app to your account. It cannot sign in as you, see your
                messages or change settings. Remove it any time under My Integrations.
            </p>
            {props.errorKind && <LinkErrorAlert kind={props.errorKind} />}
            <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={approve} disabled={busy || !parsed.success} loading={props.pending === 'approve'} loadingLabel="Approving…">Approve</Button>
                <Button variant="secondary" onClick={() => props.onDecide('deny')} disabled={busy} loading={props.pending === 'deny'} loadingLabel="Denying…">Deny</Button>
            </div>
        </LinkCard>
    );
}
