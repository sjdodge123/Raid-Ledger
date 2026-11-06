/**
 * ROK-1716: the Forever probe's own settings — extra candidate prefixes, an
 * optional character path and (ROK-2102) an optional guild path. Each path is
 * `realm/name` for Classic or a realmless `name-surname` slug for Forever
 * (contract `FOREVER_PROBE_PATH_RE`), validated client-side with the contract
 * schema and saved with their own button. The PUT always carries `guildPath`.
 */
import { useState, type FormEvent, type JSX } from 'react';
import { ForeverProbeConfigSchema, type ForeverProbeConfigDto, type ForeverProbeStateDto } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';

type SaveFn = (dto: ForeverProbeConfigDto) => Promise<unknown>;
interface FormErrors { candidates?: string; path?: string; guild?: string }
interface FormValues { candidates: string; path: string; guild: string }

const PATH_HINT = 'realm/name for Classic, name-surname for Forever';
const PATH_ERROR = `Use ${PATH_HINT}, e.g. nightslayer/thrall or thrall-stormborn`;

/** Split a comma/space separated candidate list into trimmed, non-empty prefixes. */
function parseCandidateList(raw: string): string[] {
    return raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Empty (after trim) = null, so the PUT clears the saved path. */
function nullIfBlank(raw: string): string | null {
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
}

function validate(values: FormValues): { dto?: ForeverProbeConfigDto; errors: FormErrors } {
    const parsed = ForeverProbeConfigSchema.safeParse({
        extraCandidates: parseCandidateList(values.candidates),
        characterPath: nullIfBlank(values.path),
        guildPath: nullIfBlank(values.guild),
    });
    if (parsed.success) return { dto: parsed.data, errors: {} };
    const errors: FormErrors = {};
    for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'extraCandidates') errors.candidates ??= `Invalid candidate list: ${issue.message}`;
        if (issue.path[0] === 'characterPath') errors.path ??= PATH_ERROR;
        if (issue.path[0] === 'guildPath') errors.guild ??= PATH_ERROR;
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

interface PathFieldsProps {
    path: string; setPath: (v: string) => void; guild: string; setGuild: (v: string) => void; errors: FormErrors;
}

function PathFields({ path, setPath, guild, setGuild, errors }: PathFieldsProps): JSX.Element {
    return (
        <>
            <Field label="Character path" error={errors.path}
                hint={`Optional — ${PATH_HINT}. Also checks the profile endpoints`}>
                <Input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="thrall-stormborn" fieldSize="lg" />
            </Field>
            <Field label="Guild path" error={errors.guild}
                hint={`Optional — ${PATH_HINT}. Also checks the guild roster endpoint`}>
                <Input type="text" value={guild} onChange={(e) => setGuild(e.target.value)} placeholder="the-vanguard" fieldSize="lg" />
            </Field>
        </>
    );
}

/** Extra candidates + optional character / guild paths for the Forever namespace probe. */
export function ForeverProbeConfigForm({ saved, mutate, pending }: { saved: ForeverProbeStateDto; mutate: SaveFn; pending: boolean }): JSX.Element {
    const [candidates, setCandidates] = useState(saved.extraCandidates.join(', '));
    const [path, setPath] = useState(saved.characterPath ?? '');
    const [guild, setGuild] = useState(saved.guildPath ?? '');
    const [errors, setErrors] = useState<FormErrors>({});
    const onSubmit = (e: FormEvent): void => {
        e.preventDefault();
        const { dto, errors: next } = validate({ candidates, path, guild });
        setErrors(next);
        if (dto) void submit(mutate, dto);
    };
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-3">
            <Field label="Extra candidates" error={errors.candidates}
                hint="Comma-separated prefixes to probe besides the defaults — lowercase letters and digits, up to 20">
                <Input type="text" value={candidates} onChange={(e) => setCandidates(e.target.value)} placeholder="forever2, wowfe" fieldSize="lg" />
            </Field>
            <PathFields path={path} setPath={setPath} guild={guild} setGuild={setGuild} errors={errors} />
            <Button type="submit" variant="secondary" loading={pending} loadingLabel="Saving..." aria-label="Save probe settings">
                Save
            </Button>
        </form>
    );
}
