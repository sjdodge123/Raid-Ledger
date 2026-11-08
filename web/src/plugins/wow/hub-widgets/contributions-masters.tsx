/**
 * ROK-2148 — "Profession masters": one row per Mailworthy guild rule, the
 * "Guild Enchanter" label and the recipient (linked when it resolves to a
 * linked roster character; "not on roster" when it left the guild).
 */
import type { JSX } from 'react';
import type { GuildContributionsMaster, GuildContributionsTemplate } from '@raid-ledger/contract';
import { CharacterLink } from '../../../components/hub/character-link';
import { ContributionsSection } from './contributions-section';
import { MASTERS_EMPTY, NOT_ON_ROSTER, formatDay } from './contributions.helpers';

function MasterRow({ master }: { master: GuildContributionsMaster }): JSX.Element {
    return (
        <li data-testid="contributions-master-row" className="flex min-h-8 items-baseline justify-between gap-2 text-sm sm:min-h-7">
            <span className="text-xs text-muted">{master.title}</span>
            <span className="min-w-0 text-right">
                <CharacterLink name={master.recipientName} characterId={master.onRoster ? master.characterId : null} />
                {!master.onRoster && <span className="ml-1 text-xs text-dim">{NOT_ON_ROSTER}</span>}
            </span>
        </li>
    );
}

function TemplateLine({ template }: { template: GuildContributionsTemplate }): JSX.Element {
    return (
        <p data-testid="contributions-template" className="mt-1.5 text-xs text-dim">
            Guild template by{' '}
            <CharacterLink name={template.authorName} characterId={template.authorCharacterId} className="text-muted" />
            {' · '}revised {formatDay(template.rev)}
        </p>
    );
}

interface MastersProps { template: GuildContributionsTemplate | null; masters: readonly GuildContributionsMaster[] }

export function ContributionsMasters({ template, masters }: MastersProps): JSX.Element {
    return (
        <ContributionsSection title="Profession masters" testId="contributions-masters">
            {template === null || masters.length === 0 ? (
                <p data-testid="contributions-masters-empty" className="py-2 text-sm text-muted">{MASTERS_EMPTY}</p>
            ) : (
                <ul className="flex flex-col gap-1">
                    {masters.map((m) => <MasterRow key={m.professionSkillLineId} master={m} />)}
                </ul>
            )}
            {template !== null && <TemplateLine template={template} />}
        </ContributionsSection>
    );
}
