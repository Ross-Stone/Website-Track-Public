// History: one child's logged entries for one day, in time order (FR-HIST-01..03).
import { ArrowLeftRight, Calendar, ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addDays, formatShortDayYear, localDateOf, localTimeOf } from '../../shared/time';
import { ActivityTile, Button, IconButton } from '../components/ui';
import { errorMessage } from '../lib/api';
import { Lookup } from '../lib/format';
import { useRouter } from '../lib/router';
import { useSheets } from '../sheets/host';
import { useCanEdit, useIsWriter } from '../state/hooks';
import { loadDay, setVisibleDay, today, useStore } from '../state/store';

export function History({ date: routeDate }: { date?: string }) {
  const { navigate } = useRouter();
  const { open } = useSheets();
  const boot = useStore((s) => s.boot)!;
  const childId = useStore((s) => s.childId);
  const date = routeDate && /^\d{4}-\d{2}-\d{2}$/.test(routeDate) ? routeDate : today();
  const entries = useStore((s) => (childId ? s.days[`${childId}|${date}`] : undefined));
  const lookup = useMemo(() => new Lookup(boot), [boot]);
  const writer = useIsWriter();
  const online = useStore((s) => s.online);
  const canEdit = useCanEdit();
  // Error for the day it belongs to, so changing day clears it without a reset in the effect.
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const error = failed && failed.key === `${childId}|${date}` ? failed.message : null;
  const child = boot.children.find((c) => c.id === childId);
  const multi = boot.children.filter((c) => !c.archivedAt).length > 1;

  useEffect(() => {
    if (!childId) return;
    setVisibleDay(childId, date);
    loadDay(childId, date).catch((e: unknown) =>
      setFailed({ key: `${childId}|${date}`, message: errorMessage(e) }),
    );
    return () => setVisibleDay(null, null);
  }, [childId, date]);

  const go = (d: string) => navigate(d === today() ? '/history' : `/history/${d}`, { replace: true });
  const isToday = date === today();

  return (
    <>
      <header className="page-head" style={{ alignItems: 'center', paddingBottom: 8 }}>
        <div className="stack">
          <h1 className="page-title">History</h1>
          <div className="row" style={{ gap: 2 }}>
            <span className="page-sub">{child?.firstName}</span>
            {multi && (
              <IconButton label="Switch child" onClick={() => open({ kind: 'child' })}>
                <ArrowLeftRight size={18} aria-hidden="true" />
              </IconButton>
            )}
          </div>
        </div>
        {child && (
          <div className="row" style={{ gap: 8 }}>
            <Button
              size="sm"
              icon={<Download size={18} aria-hidden="true" />}
              onClick={() => open({ kind: 'export', childId: child.id, date })}
            >
              Export
            </Button>
            {writer && (
              <Button
                size="sm"
                variant="primary"
                icon={<Plus size={18} aria-hidden="true" />}
                disabled={!canEdit}
                onClick={() => open({ kind: 'other', childId: child.id, date })}
              >
                Add
              </Button>
            )}
          </div>
        )}
      </header>

      <nav className="day-nav" aria-label="Choose a day">
        <IconButton label="Previous day" variant="boxed" onClick={() => go(addDays(date, -1))}>
          <ChevronLeft size={20} aria-hidden="true" />
        </IconButton>
        <label className="date-btn">
          <Calendar size={18} aria-hidden="true" />
          <span>{formatShortDayYear(date)}</span>
          <span className="sr-only">Choose a date</span>
          <input
            type="date"
            value={date}
            max={addDays(today(), 0)}
            onChange={(e) => e.target.value && go(e.target.value)}
          />
        </label>
        <IconButton label="Next day" variant="boxed" onClick={() => go(addDays(date, 1))} disabled={isToday}>
          <ChevronRight size={20} aria-hidden="true" />
        </IconButton>
        <Button size="sm" variant="soft" onClick={() => go(today())} disabled={isToday}>
          Today
        </Button>
      </nav>

      <section className="history-list" aria-label={`Entries on ${formatShortDayYear(date)}`}>
        {/* Offline, a day opened before still shows from this phone (FR-SYNC-03 AC2). */}
        {error && !entries && (
          <p className="empty">{online ? error : "This day isn't saved on this phone. Connect to see it."}</p>
        )}
        {!entries && !error && <p className="empty">Loading…</p>}
        {entries && entries.length === 0 && <p className="empty">Nothing logged on this day.</p>}
        {entries?.map((e) => {
          const type = lookup.type(e.activityTypeId);
          const endDate = e.endUtc ? localDateOf(e.endUtc, e.tz) : null;
          const values = lookup.values(e);
          const span = e.endUtc ? lookup.span(e)!.split(' · ')[1] : null;
          const detail =
            [
              span,
              ...values,
              endDate && endDate !== e.localDate ? `ends ${formatShortDayYear(endDate).slice(0, -5)}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || (e.endUtc === null && type?.kind === 'duration' ? 'Running' : 'No details');
          return (
            <button
              key={e.id}
              type="button"
              className="history-row"
              onClick={() => open({ kind: 'entry', entry: e })}
            >
              <span className="times tabular">
                <span style={{ fontSize: 14, fontWeight: 700 }}>{localTimeOf(e.startUtc, e.tz)}</span>
                {e.endUtc && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {localTimeOf(e.endUtc, e.tz)}
                  </span>
                )}
              </span>
              {type && <ActivityTile icon={type.icon} colour={type.colour} />}
              <span className="grow stack">
                <span style={{ fontSize: 15, fontWeight: 600 }}>{lookup.title(e)}</span>
                <span className="muted ellipsis" style={{ fontSize: 13 }}>
                  {detail}
                </span>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {lookup.user(e.createdBy)}
              </span>
            </button>
          );
        })}
      </section>
    </>
  );
}
