import { useMemo, useState } from 'react';
import { Button } from '../../../ui/button';
import { Field } from '../../../ui/field';
import { Input } from '../../../ui/input';
import { copyWithToast } from '../../../../lib/clipboard';
import { buildCallbackUrl, buildLinkCallbackUrl } from '../../discord-shared/callback-urls';
import { SubstepFooter, SubstepNote, SubstepScreen, type SubstepNav } from './substep-screen';

function LinkRow({ label, url }: { label: string; url: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async (): Promise<void> => {
        if (await copyWithToast(url, { error: 'Failed to copy' })) setCopied(true);
    };
    return (
        <Field label={label}>
            <div className="flex items-center gap-2">
                <Input readOnly mono value={url} className="flex-1 min-w-0" />
                <Button variant="secondary" onClick={copy} aria-label={copied ? `${label} link copied` : `Copy ${label} link`}>
                    {copied ? 'Copied ✓' : 'Copy'}
                </Button>
            </div>
            <span className="sr-only" aria-live="polite">{copied ? `${label} link copied` : ''}</span>
        </Field>
    );
}

/** 4b — "Add your sign-in links" (approved sheet Discord2; banner copy per D-6). */
export function SignInLinksScreen({ onNext, onBack }: SubstepNav) {
    const signIn = useMemo(() => buildCallbackUrl(), []);
    const linking = useMemo(() => buildLinkCallbackUrl(signIn), [signIn]);
    return (
        <SubstepScreen step={2} title="Add your sign-in links"
            lead={<>In the portal, open <strong className="text-foreground">OAuth2</strong> and find <strong className="text-foreground">Redirects</strong>. Add both links below. They have to match exactly, so use the copy buttons.</>}
            footer={<SubstepFooter onBack={onBack}><Button onClick={onNext}>Both links added</Button></SubstepFooter>}>
            <div className="space-y-4">
                <LinkRow label="Sign-in" url={signIn} />
                <LinkRow label="Linking an existing account" url={linking} />
            </div>
            <SubstepNote>These links use the address you opened Raid Ledger at. If you move to your own domain later, this screen shows the new links and you add those too.</SubstepNote>
            <p className="text-sm text-secondary">Then click <strong className="text-foreground">Save Changes</strong> at the bottom of the portal page.</p>
        </SubstepScreen>
    );
}
