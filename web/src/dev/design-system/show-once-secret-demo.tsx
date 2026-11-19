/**
 * ShowOnceSecretDialog demo for /dev/design-system (ROK-2263). Opens the real
 * primitive with a fake token: Modal at ≥1024px, BottomSheet below. Press
 * Done / Esc / the backdrop before copying to see "Leave without copying the
 * token?"; copy first and it closes straight away. Check both colour families.
 */
import { useState, type JSX } from 'react';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { CopyButton } from '../../components/ui/CopyButton';
import { ShowOnceSecretDialog } from '../../components/ui/show-once-secret-dialog';
import { StateFrame } from './design-system-bits';

const DEMO_SECRET = 'rlbx_DEMO-not-a-real-token_0123456789abcdefgh';

/** One trigger; the dialog is mounted only while open, like every caller. */
export function ShowOnceSecretDemo({ triggerClass }: { triggerClass: string }): JSX.Element {
    const [open, setOpen] = useState(false);
    const leading = (
        <Field label="Label">
            <Input readOnly value="Laptop clone script" trailing={<CopyButton text="Laptop clone script" />} />
        </Field>
    );
    return (
        <StateFrame label="ShowOnceSecretDialog — show-once secret"
            note="Masked secret + Copy; every close asks until copied (ROK-2263). Optional `leading` / `children` slots.">
            <button type="button" className={triggerClass} onClick={() => setOpen(true)}>Open show-once dialog</button>
            {open && (
                <ShowOnceSecretDialog title="New clone access token" secret={DEMO_SECRET} leading={leading}
                    explainer="This token is shown once. Copy it now — Raid Ledger keeps only a fingerprint."
                    onClose={() => setOpen(false)} testIdPrefix="ds-show-once" />
            )}
        </StateFrame>
    );
}
