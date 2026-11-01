/**
 * ROK-1955 — `/link` entry state: type the 8-letter code from the app.
 * ROK-2056 — "Don't have the app? Download it" → the Companion card, only
 * while a public download exists.
 */
import type { FormEvent, JSX } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { LinkCard } from './link-card';
import { formatUserCodeInput } from './companion-link-code';
import { COMPANION_CARD_HREF, companionDownloadAvailable } from '../../lib/companion-install';

interface LinkEntryCardProps {
    code: string;
    error: string | undefined;
    loading: boolean;
    onCodeChange: (code: string) => void;
    onSubmit: () => void;
}

/** The code form. Continue only previews; nothing is approved from here. */
export function LinkEntryCard(props: LinkEntryCardProps): JSX.Element {
    const submit = (e: FormEvent<HTMLFormElement>): void => { e.preventDefault(); props.onSubmit(); };
    return (
        <LinkCard title="Link a computer">
            <p className="text-sm text-muted mb-4">Enter the code shown in the Raid Ledger Companion app.</p>
            <form onSubmit={submit} noValidate>
                <Field label="Code shown on your computer" error={props.error}>
                    <Input
                        mono
                        value={props.code}
                        onChange={(e) => props.onCodeChange(formatUserCodeInput(e.target.value))}
                        autoCapitalize="characters"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={9}
                        placeholder="XXXX-XXXX"
                    />
                </Field>
                <div className="mt-4 flex gap-2">
                    <Button type="submit" loading={props.loading} loadingLabel="Checking…">Continue</Button>
                </div>
            </form>
            {companionDownloadAvailable() && <DownloadLine />}
        </LinkCard>
    );
}

/** One quiet line to the install card on My Integrations. */
function DownloadLine(): JSX.Element {
    return (
        <p data-testid="link-download-line" className="mt-4 text-xs text-muted">
            {"Don't have the app? "}
            <Link to={COMPANION_CARD_HREF} className="text-secondary underline underline-offset-2 hover:text-foreground">
                Download it
            </Link>
        </p>
    );
}
