/** ROK-1955 — `/link` entry state: type the 8-letter code from the app. */
import type { FormEvent, JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { LinkCard } from './link-card';
import { formatUserCodeInput } from './companion-link-code';

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
        </LinkCard>
    );
}
