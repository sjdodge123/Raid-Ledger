import type {
    CharacterProfessionsDto,
    ProfessionEntryDto,
    ProfessionTierDto,
} from '@raid-ledger/contract';
import { getProfessionIconUrl } from '../lib/profession-icons';

interface CharacterProfessionsPanelProps {
    professions: CharacterProfessionsDto | null;
}

export function CharacterProfessionsPanel({ professions }: CharacterProfessionsPanelProps) {
    if (
        professions === null ||
        (professions.primary.length === 0 && professions.secondary.length === 0)
    ) {
        return null;
    }
    return (
        <div className="bg-panel border border-edge rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Professions</h2>
            <div className="space-y-6">
                {professions.primary.length > 0 && (
                    <ProfessionGroup heading="Primary" entries={professions.primary} />
                )}
                {professions.secondary.length > 0 && (
                    <ProfessionGroup heading="Secondary" entries={professions.secondary} />
                )}
            </div>
        </div>
    );
}

function ProfessionGroup({
    heading,
    entries,
}: {
    heading: string;
    entries: ProfessionEntryDto[];
}) {
    return (
        <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">
                {heading}
            </h3>
            <ul className="space-y-3">
                {entries.map((entry) => (
                    <li key={entry.id}>
                        <ProfessionRow entry={entry} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

function ProfessionRow({ entry }: { entry: ProfessionEntryDto }) {
    const iconUrl = getProfessionIconUrl(entry.slug);
    return (
        <div>
            <div className="flex items-center gap-2 text-foreground">
                {iconUrl && (
                    <img src={iconUrl} alt={entry.name} className="w-6 h-6 rounded-sm" />
                )}
                <span className="font-medium">{entry.name}</span>
                <span className="text-sm text-muted">
                    {entry.skillLevel}/{entry.maxSkillLevel}
                </span>
            </div>
            {entry.tiers.length > 0 && <ProfessionTierList tiers={entry.tiers} />}
        </div>
    );
}

function ProfessionTierList({ tiers }: { tiers: ProfessionTierDto[] }) {
    return (
        <ul className="mt-2 ml-8 space-y-1 text-sm text-muted">
            {tiers.map((tier) => (
                <li key={tier.id} className="flex items-center gap-2">
                    <span>{tier.name}</span>
                    <span>
                        {tier.skillLevel}/{tier.maxSkillLevel}
                    </span>
                </li>
            ))}
        </ul>
    );
}
