import { AppearancePanel } from './appearance-panel';
import { TimezoneSection } from '../../components/profile/TimezoneSection';

/**
 * Consolidated Preferences panel (ROK-359).
 * Merges Appearance and Timezone settings into a single page.
 * Privacy toggle (show_activity) moved to player profile ActivitySection (ROK-443).
 */
export function PreferencesPanel() {
    return (
        <div className="space-y-6">
            <AppearancePanel />
            <TimezoneSection />
        </div>
    );
}
