import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary, lazyPart } from './ErrorBoundary.jsx';
import Account from './pages/Account.jsx';
import Enroll from './pages/Enroll.jsx';
import Film from './pages/Film.jsx';
import Home from './pages/Home.jsx';
import SignIn from './pages/SignIn.jsx';
import TicketOpen from './pages/TicketOpen.jsx';
import { SiteProvider } from './site.jsx';
import './styles.css';

// The admin is only for the owner; viewers never download it.
const AdminApp = lazyPart(() => import('./admin/AdminApp.jsx'));

// A page brought back by Back or Forward from the browser's memory is as it was when
// it was left, signed in or not. Someone may have signed out since, on a shared
// computer perhaps, so load it afresh: it then shows only what is true now.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) window.location.reload();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <ErrorBoundary>
              <Suspense fallback={null}>
                <AdminApp />
              </Suspense>
            </ErrorBoundary>
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
                <Route path="/account" element={<Account />} />
                <Route path="/:slug" element={<Film />} />
              </Routes>
            </SiteProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
