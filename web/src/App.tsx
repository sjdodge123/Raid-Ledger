import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useThemeStore } from './stores/theme-store';
import { Layout } from './components/layout';
import { ProtectedRoute } from './components/auth';
import { RootRedirect } from './components/RootRedirect';
import { EventsPage } from './pages/events-page';
import { EventDetailPage } from './pages/event-detail-page';
import { CreateEventPage } from './pages/create-event-page';
import { EditEventPage } from './pages/edit-event-page';
import { ProfilePage } from './pages/profile-page';
import { UserProfilePage } from './pages/user-profile-page';
import { AuthSuccessPage } from './pages/auth-success-page';
import { CalendarPage } from './pages/calendar-page';
import { AdminSettingsPage } from './pages/admin-settings-page';
import { GamesPage } from './pages/games-page';
import { GameDetailPage } from './pages/game-detail-page';
import { CharacterDetailPage } from './pages/character-detail-page';
import { PlayersPage } from './pages/players-page';
import { MyEventsPage } from './pages/my-events-page';
import './plugins/wow/register';
import './lib/toast-config';
import './App.css';

function App() {
  const isDark = useThemeStore((s) => s.resolved.isDark);

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        theme={isDark ? 'dark' : 'light'}
        richColors
        closeButton
        offset="72px"
        duration={5000}
      />
      <Layout>
        <Routes>
          {/* ROK-175: Root shows login or redirects to events based on auth */}
          <Route path="/" element={<RootRedirect />} />
          {/* Legacy /login redirects to root (AC-2) */}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/games/:id" element={<GameDetailPage />} />
          <Route path="/characters/:id" element={<CharacterDetailPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/events" element={<EventsPage />} />
          {/* ROK-213: My Events dashboard */}
          <Route path="/my-events" element={
            <ProtectedRoute>
              <MyEventsPage />
            </ProtectedRoute>
          } />
          <Route path="/events/new" element={
            <ProtectedRoute>
              <CreateEventPage />
            </ProtectedRoute>
          } />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/events/:id/edit" element={
            <ProtectedRoute>
              <EditEventPage />
            </ProtectedRoute>
          } />
          {/* ROK-181: Public user profiles */}
          <Route path="/users/:userId" element={<UserProfilePage />} />
          <Route path="/profile" element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          } />
          {/* ROK-146: Admin Settings Page */}
          <Route path="/admin/settings" element={
            <ProtectedRoute>
              <AdminSettingsPage />
            </ProtectedRoute>
          } />
          <Route path="/auth/success" element={<AuthSuccessPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
