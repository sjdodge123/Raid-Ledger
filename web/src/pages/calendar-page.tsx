import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarView, MiniCalendar } from '../components/calendar';
import '../components/calendar/calendar-styles.css';

/**
 * Calendar page - displays events in a month grid view.
 * ROK-171: Calendar Month View
 */
export function CalendarPage() {
    const [currentDate, setCurrentDate] = useState(new Date());

    // Handler for mini-calendar date selection
    const handleDateSelect = (date: Date) => {
        setCurrentDate(date);
    };

    return (
        <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white">Calendar</h1>
                <p className="text-slate-400 mt-1">
                    View upcoming events and plan your schedule
                </p>
            </div>

            <div className="calendar-page-layout">
                {/* Sidebar (desktop only) */}
                <aside className="calendar-sidebar">
                    {/* Mini Calendar Navigator */}
                    <MiniCalendar
                        currentDate={currentDate}
                        onDateSelect={handleDateSelect}
                    />

                    {/* Quick Actions */}
                    <div className="sidebar-section">
                        <h3 className="sidebar-section-title">Quick Actions</h3>
                        <div className="sidebar-quick-actions">
                            <Link to="/events/new" className="sidebar-action-btn">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Create Event
                            </Link>
                            <Link to="/events" className="sidebar-action-btn">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                </svg>
                                All Events
                            </Link>
                        </div>
                    </div>
                </aside>

                {/* Main Calendar */}
                <main>
                    <CalendarView currentDate={currentDate} onDateChange={setCurrentDate} />
                </main>
            </div>
        </div>
    );
}
