import { CalendarDays, History as HistoryIcon, Lock, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useEffect } from 'react';
import { Button, Sheet } from './components/ui';
import { Link, RouterProvider, useRouter } from './lib/router';
import { useUpdateReady } from './lib/update';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { SettingsRouter } from './screens/settings/SettingsRouter';
import { EntrySheet } from './sheets/EntrySheet';
import { ExportSheet } from './sheets/ExportSheet';
import { SheetHost, type SheetRequest } from './sheets/host';
import { LogSheet } from './sheets/LogSheet';
import { ChildSheet, OtherSheet } from './sheets/PickerSheets';
import { PlannedSheet } from './sheets/PlannedSheet';
import { start, useStore } from './state/store';

function renderSheet(s: SheetRequest) {
  switch (s.kind) {
    case 'log':
      // Keyed so switching from one sheet to another starts a fresh form.
      return <LogSheet key={`${s.typeId}:${s.entry?.id ?? 'new'}`} req={s} />;
    case 'planned':
      return <PlannedSheet req={s} />;
    case 'entry':
      return <EntrySheet req={s} />;
    case 'other':
      return <OtherSheet req={s} />;
    case 'child':
      return <ChildSheet />;
    case 'export':
      return <ExportSheet req={s} />;
  }
}

function Routes() {
  const { path } = useRouter();
  if (path.startsWith('/history')) return <History date={path.split('/')[2]} />;
  if (path.startsWith('/settings')) return <SettingsRouter path={path} />;
  return <Home />;
}

function BottomNav() {
  const { path } = useRouter();
  const items = [
    {
      to: '/',
      label: 'Today',
      Icon: CalendarDays,
      active: !path.startsWith('/history') && !path.startsWith('/settings'),
    },
    { to: '/history', label: 'History', Icon: HistoryIcon, active: path.startsWith('/history') },
    { to: '/settings', label: 'Settings', Icon: SlidersHorizontal, active: path.startsWith('/settings') },
  ];
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map(({ to, label, Icon, active }) => (
        <Link key={to} to={to} aria-current={active ? 'page' : undefined}>
          <Icon size={22} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Reloads through Cloudflare Access. `signin` makes the service worker skip the cached shell. */
function signInAgain() {
  const url = new URL(window.location.href);
  url.searchParams.set('signin', String(Date.now()));
  window.location.assign(url.toString());
}

/** FR-AUTH-04: the Access session has expired; cached data stays visible behind this. */
function SignInAgain() {
  const lastUpdated = useStore((s) => s.lastUpdated);
  return (
    <Sheet
      open
      onClose={() => {}}
      title="Sign in again"
      sub="Your sign-in has expired"
      tile={
        <span
          className="tile tile-44"
          style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
          aria-hidden="true"
        >
          <Lock size={24} />
        </span>
      }
    >
      <div className="info">
        <span>
          {lastUpdated
            ? `You can still see what was loaded at ${lastUpdated.toTimeString().slice(0, 5)}.`
            : 'Your data will load once you are signed in.'}{' '}
          Sign in to log entries and get the latest changes.
        </span>
      </div>
      <Button variant="primary" block onClick={signInAgain}>
        Sign in again
      </Button>
    </Sheet>
  );
}

/** A new version of the app has taken over: offer to load it (TECH-04). */
function UpdateBanner() {
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      <RefreshCw size={18} aria-hidden="true" />
      <span className="grow">A new version of Track is ready.</span>
      <Button size="sm" variant="primary" onClick={() => window.location.reload()}>
        Refresh
      </Button>
    </div>
  );
}

function Shell() {
  const status = useStore((s) => s.status);
  const message = useStore((s) => s.message);
  const authExpired = useStore((s) => s.authExpired);
  useEffect(() => {
    void start();
  }, []);

  if (status === 'not_allowed') {
    return (
      <main className="state-screen">
        <Lock size={32} aria-hidden="true" />
        <h1>No access</h1>
        <p>{message || "You don't have access to Track. Ask your admin to add you."}</p>
      </main>
    );
  }
  if (status === 'loading' && !authExpired) {
    return (
      <main className="state-screen" aria-busy="true">
        <p className="muted">Loading Track…</p>
      </main>
    );
  }
  if (status === 'error' && !authExpired) {
    return (
      <main className="state-screen">
        <h1>Couldn't load Track</h1>
        <p className="muted">{message}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </main>
    );
  }
  return (
    <SheetHost render={renderSheet}>
      <div className="app">
        <main className="app-main">
          <UpdateBanner />
          {status === 'ready' ? <Routes /> : null}
        </main>
        <BottomNav />
      </div>
      {authExpired && <SignInAgain />}
    </SheetHost>
  );
}

export function App() {
  return (
    <RouterProvider>
      <Shell />
    </RouterProvider>
  );
}
