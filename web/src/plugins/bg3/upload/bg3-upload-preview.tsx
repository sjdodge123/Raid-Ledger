/**
 * ROK-1960 §5 step 2 — the local preview (CONTRACT §4): exactly what will be
 * sent — thumbnail, save name, area, difficulty, party — read in the browser.
 */
import type { JSX } from 'react';
import { bg3DifficultyDisplay, bg3LevelDisplay, type Bg3PartyMember } from '@raid-ledger/contract';
import { bg3ClassesLabel, bg3RaceLabel, bg3SummonName } from '../lib/bg3-labels';
import type { Bg3ParsedSave } from './bg3-upload-api';

export const BG3_UPLOAD_PRIVACY_NOTE = 'Only this summary and the screenshot are sent. Your save file stays on this computer.';

export interface Bg3UploadPreviewProps {
    readonly save: Bg3ParsedSave;
    /** Object URL of the WebP thumbnail; the owner revokes it. */
    readonly thumbUrl: string | null;
}

function placeLine(level: string): string {
    const { act, label } = bg3LevelDisplay(level);
    return act === null ? label : `Act ${act} · ${label}`;
}

function difficultyLine(difficulty: string, ruleset: string | null): string {
    const d = bg3DifficultyDisplay(difficulty, ruleset);
    return d.ruleset === null ? d.label : `${d.label} · ${d.ruleset}`;
}

/** "Wood Elf · Barbarian · Level 8"; a summon is named, not classed. */
export function bg3MemberLine(m: Bg3PartyMember): string {
    if (m.isSummon) return `${bg3SummonName(m.origin)} · Summon`;
    return `${bg3RaceLabel(m.race)} · ${bg3ClassesLabel(m.classes)} · Level ${m.level}`;
}

export function Bg3UploadPreview({ save, thumbUrl }: Bg3UploadPreviewProps): JSX.Element {
    const p = save.payload;
    return (
        <div className="flex flex-col gap-3" data-testid="bg3-upload-preview">
            <div className="flex gap-3">
                {thumbUrl !== null && (
                    <img src={thumbUrl} alt="" data-testid="bg3-upload-thumb"
                        className="h-20 w-36 shrink-0 rounded-md border border-edge object-cover" />
                )}
                <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="truncate text-sm font-semibold text-foreground">{p.saveName}</p>
                    <p className="text-sm text-secondary">{placeLine(p.currentLevel)}</p>
                    <p className="text-sm text-secondary">{difficultyLine(p.difficulty, p.ruleset)}</p>
                </div>
            </div>
            <ul className="flex flex-col divide-y divide-edge rounded-lg border border-edge" aria-label="Party">
                {p.party.map((m, i) => <li key={`${m.origin}-${i}`} className="px-3 py-2 text-sm text-secondary">{bg3MemberLine(m)}</li>)}
            </ul>
            <p className="text-xs text-muted">{BG3_UPLOAD_PRIVACY_NOTE}</p>
        </div>
    );
}
