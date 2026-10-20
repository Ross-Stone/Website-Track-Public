import '@fontsource-variable/dm-sans';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { watchSystemTheme } from './lib/theme';
import { setRegistration, watchForUpdates } from './lib/update';

watchSystemTheme();

// Back from "Sign in again" (FR-AUTH-04): drop the parameter that sent the navigation past the cached shell.
const url = new URL(window.location.href);
if (url.searchParams.has('signin')) {
  url.searchParams.delete('signin');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

// The service worker caches the shell after the first signed-in load (TECH-04, FR-SYNC-03 AC1),
// and the app offers a refresh when a new version takes over.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  watchForUpdates(navigator.serviceWorker);
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(setRegistration)
      .catch(() => {
        /* not fatal: the app still works online */
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
