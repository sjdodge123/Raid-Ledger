/** Draft + save/test handlers for the Pelican connection form (ROK-121). */
import { useState, type FormEvent } from 'react';
import type { PelicanConfig } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { useTestPelicanConnection, useUpdatePelicanConfig } from '../hooks/use-pelican-config';
import { buildUpdateBody, draftFromConfig, isDirty, type PelicanDraft } from './pelican-form.helpers';

type TestBanner = { success: boolean; message: string } | null;

function errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.message ? err.message : fallback;
}

export function usePelicanConnectionForm(config: PelicanConfig) {
    const update = useUpdatePelicanConfig();
    const test = useTestPelicanConnection();
    const [draft, setDraft] = useState<PelicanDraft>(() => draftFromConfig(config));
    const [testResult, setTestResult] = useState<TestBanner>(null);
    const set = (patch: Partial<PelicanDraft>) => setDraft((d) => ({ ...d, ...patch }));

    const handleSave = async (e: FormEvent) => {
        e.preventDefault();
        setTestResult(null);
        try {
            const saved = await update.mutateAsync(buildUpdateBody(draft, config));
            setDraft(draftFromConfig(saved));
            toast.success('Pelican configuration saved');
        } catch (err) {
            toast.error(errorMessage(err, 'Failed to save Pelican configuration'));
        }
    };

    const handleTest = async () => {
        setTestResult(null);
        try {
            const r = await test.mutateAsync();
            setTestResult({ success: r.success, message: r.message });
        } catch (err) {
            setTestResult({ success: false, message: errorMessage(err, 'Failed to test the Pelican connection') });
        }
    };

    return { draft, set, testResult, handleSave, handleTest, dirty: isDirty(draft, config),
        isSaving: update.isPending, isTesting: test.isPending };
}
