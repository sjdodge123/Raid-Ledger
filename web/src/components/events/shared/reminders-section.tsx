import '../../../pages/event-detail-page.css';

export interface RemindersSectionProps {
    reminder15min: boolean;
    reminder1hour: boolean;
    reminder24hour: boolean;
    onReminder15minChange: (v: boolean) => void;
    onReminder1hourChange: (v: boolean) => void;
    onReminder24hourChange: (v: boolean) => void;
    /** Optional description text override (plan form uses different wording) */
    description?: string;
}

const REMINDER_OPTIONS = [
    { key: 'reminder15min' as const, label: '15 minutes before', sub: 'Starting soon!' },
    { key: 'reminder1hour' as const, label: '1 hour before', sub: 'Coming up in 1 hour' },
    { key: 'reminder24hour' as const, label: '24 hours before', sub: "Tomorrow's event" },
];

export function RemindersSection({
    reminder15min,
    reminder1hour,
    reminder24hour,
    onReminder15minChange,
    onReminder1hourChange,
    onReminder24hourChange,
    description = 'Signed-up members with Discord linked will receive DM reminders before this event.',
}: RemindersSectionProps) {
    const values = { reminder15min, reminder1hour, reminder24hour };
    const handlers = {
        reminder15min: onReminder15minChange,
        reminder1hour: onReminder1hourChange,
        reminder24hour: onReminder24hourChange,
    };

    return (
        <>
            <p className="text-xs text-dim -mt-2">
                {description}
            </p>
            <div className="bg-panel/50 border border-edge-subtle rounded-lg px-4 divide-y divide-edge-subtle">
                {REMINDER_OPTIONS.map(({ key, label, sub }) => (
                    <div key={key} className="flex items-center justify-between gap-3 py-3 min-h-[44px] sm:min-h-0">
                        <div>
                            <span className="text-sm text-secondary font-medium">{label}</span>
                            <p className="text-xs text-dim mt-0.5">{sub}</p>
                        </div>
                        <div className="event-detail-autosub-toggle shrink-0">
                            <div
                                className="event-detail-autosub-toggle__track"
                                role="switch"
                                aria-checked={values[key]}
                                aria-label={`${label} reminder`}
                                tabIndex={0}
                                onClick={() => handlers[key](!values[key])}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers[key](!values[key]); } }}
                            >
                                <span className={`event-detail-autosub-toggle__option ${values[key] ? 'event-detail-autosub-toggle__option--active' : ''}`}>On</span>
                                <span className={`event-detail-autosub-toggle__option ${!values[key] ? 'event-detail-autosub-toggle__option--active' : ''}`}>Off</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
}
