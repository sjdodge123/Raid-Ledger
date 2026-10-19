/** ROK-1836 — renders the section slot list (`character-section-slots.ts`) as §4.10 titled sections. */
import type { ValheimCharacterDetail } from '@raid-ledger/contract';
import { VALHEIM_CHARACTER_SECTIONS, type ValheimCharacterSectionDef } from './character-section-slots';

function Section({ def, character }: { def: ValheimCharacterSectionDef; character: ValheimCharacterDetail }) {
    const Body = def.component;
    return (
        <section aria-labelledby={`${def.id}-h`} className="rounded-lg border border-edge bg-surface p-4">
            <h2 id={`${def.id}-h`} className="mb-4 border-b border-edge pb-2 text-lg font-semibold text-foreground">{def.title}</h2>
            <Body character={character} />
        </section>
    );
}

/** The two-column section grid; `sections` is injectable for tests. */
export function ValheimCharacterSections({ character, sections = VALHEIM_CHARACTER_SECTIONS }: {
    character: ValheimCharacterDetail;
    sections?: readonly ValheimCharacterSectionDef[];
}) {
    const col = (c: 'left' | 'right') => sections.filter((s) => s.column === c)
        .map((s) => <Section key={s.id} def={s} character={character} />);
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">{col('left')}</div>
            <div className="flex min-w-0 flex-col gap-4">{col('right')}</div>
        </div>
    );
}
