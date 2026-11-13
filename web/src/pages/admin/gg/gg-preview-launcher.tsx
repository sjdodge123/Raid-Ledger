/**
 * ROK-2187 L10d — "Preview my GG" on the admin GG panel: a year picker
 * (current year by default) that opens the admin-only preview route. The
 * panel itself only renders inside the admin settings guard.
 */
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';

const FIRST_YEAR = 2020;

function yearOptions(current: number): number[] {
    const years: number[] = [];
    for (let y = current; y >= FIRST_YEAR; y -= 1) years.push(y);
    return years;
}

/** Year picker + "Preview my GG" button. */
export function GgPreviewLauncher(): JSX.Element {
    const current = new Date().getFullYear();
    const [year, setYear] = useState(current);
    const navigate = useNavigate();
    return (
        <section data-testid="gg-preview" className="bg-panel border border-edge rounded-lg p-4 space-y-3">
            <div>
                <h3 className="text-base font-semibold text-foreground">Preview my GG</h3>
                <p className="text-sm text-muted mt-1">Play your own GG as it stands today. Not saved, not shared, no one is notified.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Preview year" fieldSize="md" wrapperClassName="w-32" value={String(year)}
                    onChange={(e) => setYear(Number(e.target.value))}>
                    {yearOptions(current).map((y) => <option key={y} value={y}>{y}</option>)}
                </Select>
                <Button variant="secondary" data-testid="gg-preview-launch"
                    onClick={() => navigate(`/admin/settings/general/gg/preview/${year}`)}>Preview my GG</Button>
            </div>
        </section>
    );
}
