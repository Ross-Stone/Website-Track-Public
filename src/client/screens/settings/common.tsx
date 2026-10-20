import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui';
import { Link } from '../../lib/router';

export function SettingsHeader({
  title,
  sub,
  back,
  action,
}: {
  title: string;
  sub?: string;
  back?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <header className="settings-head">
      {back && (
        <Link to={back} className="icon-btn" aria-label="Back" style={{ marginLeft: -10 }}>
          <ChevronLeft size={22} aria-hidden="true" />
        </Link>
      )}
      <div className="grow stack">
        <h1>{title}</h1>
        {sub && <span className="page-sub">{sub}</span>}
      </div>
      {action && (
        <Button
          variant="primary"
          size="sm"
          onClick={action.onClick}
          disabled={action.disabled}
          style={{ padding: '0 18px', fontSize: 15 }}
        >
          {action.label}
        </Button>
      )}
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="page-body">{children}</div>;
}

/** Shown in place of a page the user's role can't use (the API refuses anyway). */
export function NotForRole() {
  return <p className="empty">This page is not available for your role.</p>;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Every day", "Mon to Fri", "Sat, Sun", … */
export function describeDays(mask: number): string {
  if (mask === 0b1111111) return 'Every day';
  if (mask === 0b0011111) return 'Mon to Fri';
  if (mask === 0b1100000) return 'Sat and Sun';
  return DAY_NAMES.filter((_, i) => mask & (1 << i)).join(', ');
}

export function hoursMinutes(min: number): string {
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} m`;
}
