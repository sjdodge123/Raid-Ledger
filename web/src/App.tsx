import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from './components/layout';
import { HomePage } from './pages/home-page';
import { EventsPage } from './pages/events-page';
import { EventDetailPage } from './pages/event-detail-page';
import { CreateEventPage } from './pages/create-event-page';
import { ProfilePage } from './pages/profile-page';
import { AuthSuccessPage } from './pages/auth-success-page';
import { LoginPage } from './pages/login-page';
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
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/new" element={<CreateEventPage />} />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/auth/success" element={<AuthSuccessPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;

