import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Enroll from './pages/Enroll.jsx';
import Film from './pages/Film.jsx';
import Home from './pages/Home.jsx';
import SignIn from './pages/SignIn.jsx';
import TicketOpen from './pages/TicketOpen.jsx';
import { SiteProvider } from './site.jsx';
import './styles.css';

// The admin is only for the owner; viewers never download it.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={null}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <SiteProvider>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/t/:code" element={<TicketOpen />} />
                {/* Static paths, so they win over /:slug (both are reserved slugs). */}
                <Route path="/signin" element={<SignIn />} />
                <Route path="/enroll" element={<Enroll />} />
                <Route path="/:slug" element={<Film />} />
              </Routes>
            </SiteProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
