import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Film from './pages/Film.jsx';
import Home from './pages/Home.jsx';
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
                <Route path="/:slug" element={<Film />} />
              </Routes>
            </SiteProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
