import { AppearancePanel } from './appearance-panel';
import { TimezoneSection } from '../../components/profile/TimezoneSection';

/**
 * Consolidated Preferences panel (ROK-359).
 * Merges Appearance and Timezone settings into a single page.
 */
export function PreferencesPanel() {
    return (
        <div className="space-y-6">
            <AppearancePanel />
            <TimezoneSection />
        </div>
    );
}
