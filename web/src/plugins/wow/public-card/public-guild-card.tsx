/**
 * ROK-1813 — the signed-out guild visitor card (approved mockup, §4.2 card
 * surface). Identity, a rounded size and recruitment ONLY: initials stand in
 * for the crest (N4), wanted rows never carry their note (N2), and Apply shows
 * only while recruiting with an https link (D7).
 */
import type { JSX } from 'react';
import type { PublicGuildCard, PublicGuildWanted } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { buttonClass } from '../../../components/ui/button-classes';
import { crestInitials } from '../../../components/hub/crest/hub-crest.helpers';
import { RECRUIT_ROLE_LABEL, RECRUIT_STATE_META } from '../hub-widgets/recruitment.helpers';
import { memberCountLabel, visibleApplyUrl } from './public-guild-card.helpers';

/** Wanted rows still open to applicants, open before limited (closed rows are not "looking for"). */
function lookingFor(wanted: readonly PublicGuildWanted[]): PublicGuildWanted[] {
    const open = wanted.filter((w) => w.state === 'open');
    return [...open, ...wanted.filter((w) => w.state === 'limited')];
}

function CardHero({ card }: { card: PublicGuildCard }): JSX.Element {
    const meta = [card.region.toUpperCase(), card.realmName, card.gameName, memberCountLabel(card.approxMemberCount)]
        .filter((part): part is string => part !== null && part !== '');
    return (
        <header className="flex items-center gap-4 border-b border-edge-subtle p-4 sm:p-5">
            <div aria-hidden="true" data-testid="public-guild-card-initials"
                className="grid h-13 w-13 flex-none place-items-center rounded-xl border border-edge-strong bg-panel text-lg font-bold text-foreground sm:h-16 sm:w-16 sm:text-[22px]">
                {crestInitials(card.name)}
            </div>
            <div className="min-w-0">
                <h1 className="break-words text-[19px] font-bold leading-tight text-foreground sm:text-[22px]">{card.name}</h1>
                <p className="mt-1 text-[13px] text-muted" data-testid="public-guild-card-meta">
                    {meta.map((part, i) => (
                        <span key={`${i}-${part}`}>
                            {i > 0 && <span aria-hidden="true" className="px-1 text-dim">·</span>}
                            {part}
                        </span>
                    ))}
                </p>
            </div>
        </header>
    );
}

function WantedPills({ wanted }: { wanted: readonly PublicGuildWanted[] }): JSX.Element | null {
    const rows = lookingFor(wanted);
    if (rows.length === 0) return null;
    return (
        <ul aria-label="Looking for" className="mb-5 flex flex-wrap gap-2">
            {rows.map((w) => (
                <li key={`${w.className}-${w.role}`} data-testid="public-guild-card-wanted"
                    className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-panel px-2.5 py-1 text-xs text-secondary">
                    <b className="font-semibold text-foreground">{w.className}</b>
                    <span className="text-muted">{RECRUIT_ROLE_LABEL[w.role]}</span>
                </li>
            ))}
        </ul>
    );
}

function ApplyLink({ href }: { href: string }): JSX.Element {
    return (
        <>
            <a href={href} target="_blank" rel="noopener noreferrer" data-testid="public-guild-card-apply"
                className={buttonClass({ variant: 'primary', className: 'w-full sm:w-auto' })}>
                Apply <span aria-hidden="true">↗</span>
            </a>
            <p className="mt-3 text-xs text-dim">Opens the guild&apos;s own application link.</p>
        </>
    );
}

function RecruitmentBody({ card }: { card: PublicGuildCard }): JSX.Element {
    const state = card.recruitment?.state ?? 'closed';
    const meta = RECRUIT_STATE_META[state];
    const apply = visibleApplyUrl(card);
    return (
        <div className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">Recruitment</h2>
                <StatusChip tone={meta.tone} title={`Recruitment: ${meta.label}`}>{meta.label}</StatusChip>
            </div>
            {state === 'closed' || card.recruitment === null ? (
                <p className="rounded-lg bg-panel p-3 text-[13px] text-muted" data-testid="public-guild-card-closed">
                    Not recruiting right now.
                </p>
            ) : (
                <WantedPills wanted={card.recruitment.wanted} />
            )}
            {apply !== null && <ApplyLink href={apply} />}
        </div>
    );
}

/** The card itself (no page chrome). */
export function PublicGuildCardView({ card }: { card: PublicGuildCard }): JSX.Element {
    return (
        <article data-testid="public-guild-card" aria-label={card.name}
            className="mx-auto max-w-[560px] overflow-hidden rounded-lg border border-edge bg-surface">
            <CardHero card={card} />
            <RecruitmentBody card={card} />
        </article>
    );
}
