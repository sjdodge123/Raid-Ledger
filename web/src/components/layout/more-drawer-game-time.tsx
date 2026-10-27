/**
 * The phone "My game time" editor the More drawer opens (ROK-1584 §3). Its own
 * module so `more-drawer-lazy.tsx` can load it on first tap (ROK-1901): the
 * sheet and the week editor are ~4 KB gz the app shell never needs.
 */
import { GameTimeCheckSheet } from '../../pages/scheduling/GameTimeCheckSheet';
import { PhoneWeekCheckStep } from '../features/game-time/phone/PhoneWeekCheckStep';
import { PROFILE_HOURS } from '../features/game-time/phone/phone-week-check.helpers';

/**
 * Hosted OUTSIDE the drawer panel: the panel is `invisible pointer-events-none`
 * once closed, and the row closes it on tap — so the sheet has to be a sibling,
 * not a child, or it would open into a hidden subtree. Same drawer the profile
 * route mounts.
 */
export function GameTimeDrawer({ onClose }: { onClose: () => void }) {
    return (
        <GameTimeCheckSheet
            isOpen
            title="My game time"
            onClose={onClose}
            body={<PhoneWeekCheckStep variant="profile" hours={PROFILE_HOURS} />}
        />
    );
}
