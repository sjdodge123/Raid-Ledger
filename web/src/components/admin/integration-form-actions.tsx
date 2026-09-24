/**
 * ROK-1652: the one action row for the admin integration forms (IGDB, ITAD,
 * Steam, Discord Bot / OAuth, Blizzard). Below `lg` Save Configuration is a
 * full-width primary row and Test Connection + Clear sit under it, each label
 * on one line; from `lg` Save is `flex-1` beside them (the desktop layout).
 * Copy is fixed here so the forms cannot drift. Co-Optimus keeps its own shorter
 * copy ("Save" / "Test connection") in its own row, laid out the same way.
 */
import { Button } from '../ui/button';

export interface IntegrationFormActionsProps {
    isPending: { save: boolean; test: boolean; clear: boolean };
    /** Show Test Connection (usually once configured; Discord Bot also while a token is typed). */
    showTest: boolean;
    /** Show Clear (once configured). */
    showClear: boolean;
    onTest: () => void;
    onClear: () => void;
}

export function IntegrationFormActions({ isPending, showTest, showClear, onTest, onClear }: IntegrationFormActionsProps) {
    return (
        <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" variant="primary" size="lg" className="w-full lg:w-auto lg:flex-1"
                loading={isPending.save} loadingLabel="Saving...">
                Save Configuration
            </Button>
            {showTest && (
                <Button variant="secondary" size="lg" className="whitespace-nowrap" onClick={onTest}
                    loading={isPending.test} loadingLabel="Testing...">
                    Test Connection
                </Button>
            )}
            {showClear && (
                <Button variant="destructive-soft" size="lg" className="whitespace-nowrap" onClick={onClear}
                    loading={isPending.clear}>
                    Clear
                </Button>
            )}
        </div>
    );
}
