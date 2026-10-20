// Home: the selected child's today (FR-HOME-01, FR-HOME-02), laid out as in the design.
import { ArrowLeftRight, LayoutGrid, Lock, Pill, RefreshCw, Square, Sun, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { localTimeOf } from '../../shared/time';
import { ActivityGlyph } from '../lib/icons';
import { ActivityTile, IconButton, paletteVars } from '../components/ui';
import { inputFrom } from '../sheets/PlannedSheet';
import { useSheets } from '../sheets/host';
import { buildHome, type TimelineRow } from '../state/home';
import { useCanEdit, useIsWriter, useNow } from '../state/hooks';
import { check, saveEntry, tz, useStore } from '../state/store';
import { PullToRefresh } from '../components/PullToRefresh';

export function Home() {
  const boot = useStore((s) => s.boot)!;
  const childId = useStore((s) => s.childId);
  const entries = useStore((s) => (childId ? s.recent[childId] : undefined));
  const overrides = useStore((s) => (childId ? s.overrides[childId] : undefined));
  const lastUpdated = useStore((s) => s.lastUpdated);
  const online = useStore((s) => s.online);
  const refreshing = useStore((s) => s.refreshing);
  const now = useNow();
  const writer = useIsWriter();
  const canEdit = useCanEdit();
  const { open } = useSheets();

  const child = boot.children.find((c) => c.id === childId);
  const multi = boot.children.filter((c) => !c.archivedAt).length > 1;
  const model = useMemo(
    () =>
      childId && entries
        ? buildHome({ boot, childId, entries, overrides: overrides ?? [], now, tz: tz() })
        : null,
    [boot, childId, entries, overrides, now],
  );

  if (!child) {
    return (
      <div className="empty">
        <p>No children yet.</p>
        <p>{boot.me.role === 'admin' ? 'Add one in Settings › Children.' : 'Ask your admin to add one.'}</p>
      </div>
    );
  }

  const syncLabel = online
    ? lastUpdated
      ? `Updated ${localTimeOf(lastUpdated, tz())}`
      : 'Updating…'
    : 'Offline';

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <div className="row" style={{ gap: 2 }}>
            <h1 className="page-title">{child.firstName}</h1>
            {multi && (
              <IconButton label="Switch child" onClick={() => open({ kind: 'child' })}>
                <ArrowLeftRight size={20} aria-hidden="true" />
              </IconButton>
            )}
          </div>
          <span className="page-sub">{model?.dateLabel}</span>
          {model?.stats && <span style={{ fontSize: 14, fontWeight: 600 }}>{model.stats}</span>}
        </div>
        <div className="stack" style={{ alignItems: 'flex-end', gap: 6, paddingTop: 6 }}>
          {/* Tap to refresh: the single-pointer alternative to pull to refresh (WCAG 2.5.1). */}
          <button
            type="button"
            className="sync-btn"
            onClick={() => void check(true)}
            disabled={refreshing}
            aria-label={`${syncLabel}. Refresh`}
          >
            {online ? (
              <RefreshCw size={14} aria-hidden="true" className={refreshing ? 'spin' : undefined} />
            ) : (
              <WifiOff size={14} aria-hidden="true" />
            )}
            {syncLabel}
          </button>
          {!writer && (
            <span className="pill">
              <Lock size={13} aria-hidden="true" />
              View only
            </span>
          )}
        </div>
      </header>

      {!online && (
        // FR-SYNC-03 AC3
        <div className="offline-banner" role="status">
          <WifiOff size={18} aria-hidden="true" />
          Offline{lastUpdated ? ` · last updated ${localTimeOf(lastUpdated, tz())}` : ''}
        </div>
      )}
      <PullToRefresh />

      {!model ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="home-cards">
            {model.running.map((r) => (
              <section
                key={r.entry.id}
                className="running"
                style={paletteVars(r.type.colour)}
                aria-label={r.title}
              >
                <ActivityTile icon={r.type.icon} colour={r.type.colour} size={44} />
                <div className="grow stack">
                  <span className="running-title">{r.title}</span>
                  <span className="running-elapsed tabular">{r.elapsed}</span>
                  <span className="running-sub">{r.sub}</span>
                </div>
                {writer && (
                  <button
                    type="button"
                    className="running-btn"
                    disabled={!canEdit}
                    onClick={() =>
                      void saveEntry(r.entry.id, { ...inputFrom(r.entry), endUtc: new Date().toISOString() })
                    }
                  >
                    {r.type.systemKey === 'overnight_sleep' ? (
                      <Sun size={18} aria-hidden="true" />
                    ) : (
                      <Square size={18} aria-hidden="true" />
                    )}
                    {r.endLabel}
                  </button>
                )}
              </section>
            ))}

            {model.meds.length > 0 && (
              <section className="meds" aria-label="Medication">
                {model.meds.map((m) => (
                  <div key={m.status.medicine.id} className="row" style={{ gap: 10 }}>
                    <span className="tile tile-34" style={paletteVars('red')} aria-hidden="true">
                      <Pill size={18} />
                    </span>
                    <span className="grow stack">
                      <span className="meds-title">{m.title}</span>
                      <span className="muted" style={{ fontSize: 13 }}>
                        {m.detail}
                      </span>
                    </span>
                    <span className={m.status.state === 'ok' ? 'pill pill-ok' : 'pill'}>
                      {m.status.state === 'ok' ? 'OK now' : 'Wait'}
                    </span>
                  </div>
                ))}
                {model.alternating && <span className="meds-alt">{model.alternating}</span>}
              </section>
            )}

            {model.next && (
              <NextCard next={model.next} childId={child.id} writer={writer} canEdit={canEdit} />
            )}
          </div>

          {writer && (
            <nav className="quick" aria-label="Quick log">
              {model.quick.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => open({ kind: 'log', childId: child.id, typeId: t.id })}
                >
                  <ActivityTile icon={t.icon} colour={t.colour} size={30} />
                  {t.name}
                </button>
              ))}
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => open({ kind: 'other', childId: child.id })}
              >
                <span className="tile tile-30" style={paletteVars('neutral')} aria-hidden="true">
                  <LayoutGrid size={16} />
                </span>
                Other
              </button>
            </nav>
          )}

          <section className="timeline" aria-label="Today">
            {model.rows.map((r) => (
              <TimelineItem key={r.key} row={r} childId={child.id} writer={writer} canEdit={canEdit} />
            ))}
          </section>
        </>
      )}
    </>
  );
}

function NextCard({
  next,
  childId,
  writer,
  canEdit,
}: {
  next: NonNullable<ReturnType<typeof buildHome>['next']>;
  childId: string;
  writer: boolean;
  canEdit: boolean;
}) {
  const { open } = useSheets();
  return (
    <section className="next" aria-label="Next planned">
      <ActivityGlyph name={next.type.icon} size={22} />
      <div className="grow stack">
        <span className="next-when">{next.when}</span>
        <span className="next-title">{next.title}</span>
      </div>
      {writer && next.row && (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => open({ kind: 'planned', childId, row: next.row! })}
        >
          Log
        </button>
      )}
    </section>
  );
}

function TimelineItem({
  row,
  childId,
  writer,
  canEdit,
}: {
  row: TimelineRow;
  childId: string;
  writer: boolean;
  canEdit: boolean;
}) {
  const { open } = useSheets();
  if (row.kind === 'now') {
    return (
      <div className="tl-now" aria-label={`Now, ${row.time}`}>
        <span className="time tabular">{row.time}</span>
        <span className="dot" aria-hidden="true" />
        <span className="line" aria-hidden="true" />
        <span>Now</span>
      </div>
    );
  }
  const badge =
    row.kind === 'entry'
      ? row.state === 'running'
        ? { text: 'Running', solid: true }
        : row.auto
          ? { text: 'Auto', solid: false }
          : null
      : row.state === 'missed'
        ? { text: 'Missed', solid: false }
        : row.state === 'skipped'
          ? { text: 'Skipped', solid: false }
          : row.moved
            ? { text: 'Moved', solid: false }
            : null;
  const onOpen = () =>
    row.kind === 'entry'
      ? open({ kind: 'entry', entry: row.entry })
      : open({ kind: 'planned', childId, row: row.row });
  // Read only users can open entry details but not planned-item actions.
  const interactive = row.kind === 'entry' || (writer && canEdit);
  const content = (
    <>
      <span className="sr-only">{row.time} </span>
      <span className="tl-icon" style={{ display: 'flex' }} aria-hidden="true">
        <ActivityGlyph name={row.type.icon} size={18} />
      </span>
      <span className="grow stack">
        <span className="tl-title">{row.title}</span>
        {row.detail && <span className="tl-detail ellipsis">{row.detail}</span>}
      </span>
      {badge && <span className={badge.solid ? 'badge badge-solid' : 'badge'}>{badge.text}</span>}
    </>
  );
  return (
    <div className={`tl-item ${row.state}`} style={paletteVars(row.type.colour)}>
      <span className="tl-time tabular">{row.time}</span>
      <span className="tl-rail" aria-hidden="true">
        <span className="top" />
        <span className="tl-dot" />
        <span className="bottom" />
      </span>
      <div className="tl-box">
        {interactive ? (
          <button type="button" className="tl-main" onClick={onOpen}>
            {content}
          </button>
        ) : (
          <div className="tl-main">{content}</div>
        )}
        {row.kind === 'planned' && row.state === 'missed' && writer && (
          <button type="button" className="tl-confirm" disabled={!canEdit} onClick={onOpen}>
            Confirm
          </button>
        )}
      </div>
    </div>
  );
}
