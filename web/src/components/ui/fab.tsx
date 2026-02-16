import { PlusIcon } from '@heroicons/react/24/solid';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { Z_INDEX } from '../../lib/z-index';

interface FABProps {
    onClick: () => void;
    icon?: React.ComponentType<{ className?: string }>;
    label?: string;
}

export function FAB({ onClick, icon: Icon = PlusIcon, label }: FABProps) {
    const scrollDirection = useScrollDirection();
    const tabBarHidden = scrollDirection === 'down';

    return (
        <button
            onClick={onClick}
            aria-label={label || 'Create'}
            className="fixed right-4 w-14 h-14 bg-emerald-600 text-white rounded-full shadow-lg shadow-emerald-500/25 hover:bg-emerald-500 active:scale-95 flex items-center justify-center md:hidden"
            style={{ zIndex: Z_INDEX.FAB, bottom: tabBarHidden ? 16 : 72, transition: 'all 200ms ease-out' }}
        >
            <Icon className="w-6 h-6" />
        </button>
    );
}
