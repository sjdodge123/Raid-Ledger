import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { Z_INDEX } from '../../lib/z-index';

interface MobilePageToolbarProps {
    children: React.ReactNode;
    className?: string;
    /** Accessible label for the toolbar region */
    'aria-label'?: string;
}

/**
 * Sticky toolbar wrapper for mobile per-page controls (ROK-329).
 * Sits below the 64px header, only visible on mobile (<768px).
 * Frosted glass effect with backdrop blur.
 *
 * When the header hides (scroll-down), the toolbar slides up to top-0.
 */
export function MobilePageToolbar({ children, className = '', 'aria-label': ariaLabel = 'Page toolbar' }: MobilePageToolbarProps) {
    const scrollDirection = useScrollDirection();
    const headerHidden = scrollDirection === 'down';

    return (
        <div
            role="toolbar"
            aria-label={ariaLabel}
            className={`sticky md:hidden bg-surface/95 backdrop-blur-sm border-b border-edge will-change-transform md:will-change-auto ${headerHidden ? 'top-0' : 'top-16'
                }`}
            style={{ zIndex: Z_INDEX.TOOLBAR, transition: 'top 300ms ease-in-out' }}
        >
            <div className={`px-4 py-3 ${className}`}>
                {children}
            </div>
        </div>
    );
}
