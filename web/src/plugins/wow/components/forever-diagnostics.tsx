/**
 * ROK-2163: the WoW Forever namespace diagnostics — status line, prefix
 * override and the probe panel. Developer tooling from the pre-launch hunt for
 * the Forever namespace (ROK-1716/2102), so it renders only on test/dev sites
 * (DEMO_MODE). While system status is loading or unknown it renders nothing,
 * so prod never flashes it (operator ruling 2026-11-10).
 */
import { useState, type FormEvent, type JSX } from 'react';
import {
    WowForeverNamespacePrefixSchema,
    type WowForeverConfigResponseDto,
} from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { useSystemStatus } from '../../../hooks/use-system-status';
import { useForeverProbe } from '../hooks/use-forever-probe';
import { ForeverProbePanel } from './forever-probe-panel';
import { save, savedDto, type SaveFn } from './forever-settings-save';

interface DiagnosticsProps {
    saved: WowForeverConfigResponseDto;
    mutate: SaveFn;
    pending: boolean;
}

function PrefixForm({
    saved,
    mutate,
    pending,
}: DiagnosticsProps): JSX.Element {
    const [prefix, setPrefix] = useState(saved.namespacePrefix);
    const [error, setError] = useState<string | undefined>();
    const onSubmit = (e: FormEvent): void => {
        e.preventDefault();
        const parsed = WowForeverNamespacePrefixSchema.safeParse(prefix);
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Invalid prefix');
            return;
        }
        setError(undefined);
        void save(
            mutate,
            savedDto(saved, { namespacePrefix: parsed.data }),
            'WoW Forever namespace saved',
        );
    };
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-3">
            <Field
                label="Namespace prefix"
                error={error}
                hint="Blizzard namespace without the static-/dynamic-/profile- part and region"
            >
                <Input
                    type="text"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="forever"
                    fieldSize="lg"
                />
            </Field>
            <Button
                type="submit"
                variant="secondary"
                loading={pending}
                loadingLabel="Saving..."
                aria-label="Save Forever settings"
            >
                Save
            </Button>
        </form>
    );
}

/** One-line status: is the configured prefix a match in the latest probe run? (ROK-2102) */
function NamespaceStatus({ prefix }: { prefix: string }): JSX.Element | null {
    const { probe } = useForeverProbe();
    if (probe.isPending) return null;
    const live =
        probe.data?.result?.matches.some((m) => m.prefix === prefix) ?? false;
    if (live) {
        return (
            <p className="text-sm text-secondary">
                Forever namespace: <span className="text-foreground">live</span>{' '}
                — prefix <code>{prefix}</code>
            </p>
        );
    }
    return (
        <p className="text-sm text-secondary">
            Forever namespace:{' '}
            <span className="text-foreground">not confirmed</span> — prefix{' '}
            <code>{prefix}</code>. Run the probe below.
        </p>
    );
}

/** DEMO_MODE-only Forever diagnostics; renders nothing on prod or while status loads. */
export function ForeverDiagnostics({
    saved,
    mutate,
    pending,
}: DiagnosticsProps): JSX.Element | null {
    const { data } = useSystemStatus();
    if (data?.demoMode !== true) return null;
    return (
        <>
            <NamespaceStatus prefix={saved.namespacePrefix} />
            <PrefixForm
                key={saved.namespacePrefix}
                saved={saved}
                mutate={mutate}
                pending={pending}
            />
            <ForeverProbePanel />
        </>
    );
}
