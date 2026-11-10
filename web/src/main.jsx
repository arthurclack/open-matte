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
import { installDevicePixels } from './look/devicePixels.js';
import { SiteProvider } from './site.jsx';
// The look, in order: its tokens and fonts, the app's base and older classes, the
// interface layer, the printed objects and the machine, then the friend's pages.
// The back office's own (look/office.css) comes with it (admin/AdminApp.jsx).
import './look/tokens.css';
import './styles.css';
import './look/ui.css';
import './look/objects.css';
import './look/friend.css';

// The raster and the blue screen's scanlines in whole device pixels.
installDevicePixels();

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
