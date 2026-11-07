/**
 * ROK-2128 — Add character → "Guild roster": the unclaimed rows of every
 * visible WoW: Forever guild, grouped per guild, each claimed in one click.
 * Rows show name, class and level only (FLAG 2); one Ruleset select above the
 * list is defaulted from the user's other Forever character (FLAG 4).
 */
import { useMemo, useState, type JSX } from 'react';
import {
    WOW_FOREVER_RULESET_LABELS,
    WOW_FOREVER_SELECTABLE_RULESETS,
    type CharacterDto,
    type RosterClaimCandidateDto,
    type RosterClaimGuildDto,
    type WowForeverSelectableRuleset,
} from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { SearchInput } from '../../../components/ui/search-input';
import { useDebouncedValue } from '../../../hooks/use-debounced-value';
import { ModalEmptyState } from '../../../components/ui/modal-helpers';
import { toast } from '../../../lib/toast';
import { httpStatusOf } from '../../../lib/api/api-error';
import { useClaimRosterMember, useRosterClaimCandidates } from '../hooks/use-roster-claim';
import { classDotClass } from '../hub/wow-member-professions';
import { getClassIconUrl } from '../lib/class-icons';
import { countCandidates, defaultClaimRuleset, filterRosterGuilds, rosterMetaLine } from '../lib/roster-claim';

export interface RosterClaimListProps {
    gameId: number;
    existingCharacters: CharacterDto[];
    /** Armory is offered for this game — the "Not listed?" hint links to it. */
    armoryAvailable: boolean;
    onClaimed: () => void;
    onSwitchTab: (tab: 'manual' | 'import') => void;
}

function ClassBadge({ cls }: { cls: string | null }): JSX.Element {
    const icon = getClassIconUrl(cls);
    return (
        <>
            <span aria-hidden="true" className={`size-2.5 rounded-full flex-none ${classDotClass(cls) ?? 'bg-dim'}`} />
            {icon
                ? <img src={icon} alt="" className="size-7 rounded-full flex-none border border-edge" />
                : <span aria-hidden="true" className="size-7 rounded-full flex-none bg-overlay border border-edge" />}
        </>
    );
}

function CandidateRow({ c, pending, busy, onClaim }: {
    c: RosterClaimCandidateDto; pending: boolean; busy: boolean; onClaim: () => void;
}): JSX.Element {
    return (
        <li className="flex items-center gap-2.5 min-h-11 px-2.5 py-1.5 border-t border-edge first:border-t-0 bg-surface">
            <ClassBadge cls={c.class} />
            <div className="flex-1 min-w-0">
                <p className="text-foreground font-medium truncate">{c.name}</p>
                <p className="text-xs text-muted">{rosterMetaLine(c)}</p>
            </div>
            <Button variant="secondary" size="sm" aria-label={`Claim ${c.name}`} loading={pending} loadingLabel="Claiming…"
                disabled={busy && !pending} onClick={onClaim}>
                {pending ? 'Claiming…' : 'Claim'}
            </Button>
        </li>
    );
}

function GuildSection({ guild, pendingId, onClaim }: {
    guild: RosterClaimGuildDto; pendingId: number | null; onClaim: (c: RosterClaimCandidateDto) => void;
}): JSX.Element {
    const n = guild.candidates.length;
    return (
        <section className="space-y-1.5">
            <div className="flex justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                <h3 className="truncate">{guild.guildName}</h3>
                <span className="flex-none">{n} unclaimed</span>
            </div>
            <ul className="rounded-lg border border-edge overflow-hidden">
                {guild.candidates.map((c) => (
                    <CandidateRow key={c.memberId} c={c} pending={pendingId === c.memberId} busy={pendingId !== null} onClaim={() => onClaim(c)} />
                ))}
            </ul>
        </section>
    );
}

function NotListedHint({ armoryAvailable, onSwitchTab }: Pick<RosterClaimListProps, 'armoryAvailable' | 'onSwitchTab'>): JSX.Element {
    const link = 'underline text-success hover:text-foreground';
    return (
        <p className="text-xs text-muted">
            Not listed?{' '}
            {armoryAvailable && <><button type="button" className={link} onClick={() => onSwitchTab('import')}>Import from Armory</button>{' or '}</>}
            <button type="button" className={link} onClick={() => onSwitchTab('manual')}>{armoryAvailable ? 'add it manually' : 'Add it manually'}</button>.
        </p>
    );
}

function RulesetSelect({ value, onChange }: { value: WowForeverSelectableRuleset; onChange: (r: WowForeverSelectableRuleset) => void }): JSX.Element {
    return (
        <Field label="Ruleset">
            <Select value={value} onChange={(e) => {
                const next = WOW_FOREVER_SELECTABLE_RULESETS.find((r) => r === e.target.value);
                if (next) onChange(next);
            }}>
                {WOW_FOREVER_SELECTABLE_RULESETS.map((r) => <option key={r} value={r}>{WOW_FOREVER_RULESET_LABELS[r]}</option>)}
            </Select>
        </Field>
    );
}

function LoadingRows(): JSX.Element {
    return (
        <div className="space-y-2" aria-busy="true" aria-label="Loading guild roster">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 rounded-lg bg-panel animate-pulse" />)}
        </div>
    );
}

function useClaimHandler(gameId: number, existing: CharacterDto[], ruleset: WowForeverSelectableRuleset, onClaimed: () => void) {
    const claim = useClaimRosterMember(gameId);
    const isMain = !existing.some((c) => c.isMain);
    const onClaim = (c: RosterClaimCandidateDto): void => {
        claim.mutate({ memberId: c.memberId, body: { ruleset, isMain } }, {
            onSuccess: () => { toast.success(`${c.name} is now yours.`); onClaimed(); },
            onError: (e) => { toast.error(httpStatusOf(e) === 409 ? 'Someone claimed this first' : e.message || 'Could not claim this character'); },
        });
    };
    return { onClaim, pendingId: claim.isPending ? claim.variables?.memberId ?? null : null };
}

/** The "Guild roster" body of the Add character dialog (WoW: Forever only). */
export function RosterClaimList({ gameId, existingCharacters, armoryAvailable, onClaimed, onSwitchTab }: RosterClaimListProps): JSX.Element {
    const [query, setQuery] = useState('');
    // Codex P2: the server filters by name BEFORE its 1000-row cap; the local filter narrows while typing.
    const { data, isLoading } = useRosterClaimCandidates(gameId, true, useDebouncedValue(query, 300));
    const [ruleset, setRuleset] = useState<WowForeverSelectableRuleset>(() => defaultClaimRuleset(existingCharacters));
    const visible = useMemo(() => filterRosterGuilds(data?.guilds ?? [], query), [data, query]);
    const { onClaim, pendingId } = useClaimHandler(gameId, existingCharacters, ruleset, onClaimed);
    return (
        <div className="flex flex-col gap-3 min-h-0">
            <RulesetSelect value={ruleset} onChange={setRuleset} />
            <SearchInput label="Search guild roster" placeholder="Search guild roster" value={query} onChange={setQuery} />
            {isLoading ? <LoadingRows /> : countCandidates(visible) === 0
                ? <ModalEmptyState message={`No unclaimed character matches “${query.trim()}”.`} />
                : visible.map((g) => <GuildSection key={g.guildId} guild={g} pendingId={pendingId} onClaim={onClaim} />)}
            {data?.truncated && <p className="text-xs text-muted">Showing the first 1000 — search to narrow.</p>}
            <NotListedHint armoryAvailable={armoryAvailable} onSwitchTab={onSwitchTab} />
        </div>
    );
}
