/**
 * ROK-1716: the Forever probe's own settings — extra candidate prefixes and an
 * optional raw `<realmOrRuleset>/<name>` profile path — validated client-side
 * with the contract schema and saved with their own button.
 */
import { useState, type FormEvent, type JSX } from 'react';
import { ForeverProbeConfigSchema, type ForeverProbeConfigDto, type ForeverProbeStateDto } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';

type SaveFn = (dto: ForeverProbeConfigDto) => Promise<unknown>;
interface FormErrors { candidates?: string; path?: string }

/** Split a comma/space separated candidate list into trimmed, non-empty prefixes. */
function parseCandidateList(raw: string): string[] {
    return raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function validate(candidates: string, path: string): { dto?: ForeverProbeConfigDto; errors: FormErrors } {
    const parsed = ForeverProbeConfigSchema.safeParse({
        extraCandidates: parseCandidateList(candidates),
        characterPath: path.trim() === '' ? null : path.trim(),
    });
    if (parsed.success) return { dto: parsed.data, errors: {} };
    const errors: FormErrors = {};
    for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'extraCandidates') errors.candidates ??= `Invalid candidate list: ${issue.message}`;
        if (issue.path[0] === 'characterPath') errors.path ??= 'Use <realm or ruleset>/<name>, e.g. nightslayer/thrall';
    }
    return { errors };
}

async function submit(mutate: SaveFn, dto: ForeverProbeConfigDto): Promise<void> {
    try {
        await mutate(dto);
        toast.success('Forever probe settings saved');
    } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save Forever probe settings');
    }
}

/** Extra candidates + optional character path for the Forever namespace probe. */
export function ForeverProbeConfigForm({ saved, mutate, pending }: { saved: ForeverProbeStateDto; mutate: SaveFn; pending: boolean }): JSX.Element {
    const [candidates, setCandidates] = useState(saved.extraCandidates.join(', '));
    const [path, setPath] = useState(saved.characterPath ?? '');
    const [errors, setErrors] = useState<FormErrors>({});
    const onSubmit = (e: FormEvent): void => {
        e.preventDefault();
        const { dto, errors: next } = validate(candidates, path);
        setErrors(next);
        if (dto) void submit(mutate, dto);
    };
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-3">
            <Field label="Extra candidates" error={errors.candidates}
                hint="Comma-separated prefixes to probe besides the defaults — lowercase letters and digits, up to 20">
                <Input type="text" value={candidates} onChange={(e) => setCandidates(e.target.value)} placeholder="forever2, wowfe" fieldSize="lg" />
            </Field>
            <Field label="Character path" error={errors.path}
                hint="Optional <realm or ruleset>/<name> to also check a profile endpoint">
                <Input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="nightslayer/thrall" fieldSize="lg" />
            </Field>
            <Button type="submit" variant="secondary" loading={pending} loadingLabel="Saving..." aria-label="Save probe settings">
                Save
            </Button>
        </form>
    );
}
