import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from './components/layout';
import { ProtectedRoute } from './components/auth';
import { RootRedirect } from './components/RootRedirect';
import { EventsPage } from './pages/events-page';
import { EventDetailPage } from './pages/event-detail-page';
import { CreateEventPage } from './pages/create-event-page';
import { ProfilePage } from './pages/profile-page';
import { AuthSuccessPage } from './pages/auth-success-page';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        theme="dark"
        richColors
        closeButton
      />
      <Layout>
        <Routes>
          {/* ROK-175: Root shows login or redirects to events based on auth */}
          <Route path="/" element={<RootRedirect />} />
          {/* Legacy /login redirects to root (AC-2) */}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/new" element={
            <ProtectedRoute>
              <CreateEventPage />
            </ProtectedRoute>
          } />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/profile" element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          } />
          <Route path="/auth/success" element={<AuthSuccessPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;


