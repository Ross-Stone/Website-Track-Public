// One place that owns the open sheet and the undo snackbar, so Home and History share the same flows.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MatchedRow } from '../../shared/matching';
import type { Entry } from '../../shared/domain';
import { Snackbar } from '../components/ui';

export type SheetRequest =
  | {
      kind: 'log';
      childId: string;
      typeId: string;
      /** Editing an existing entry. */
      entry?: Entry;
      /** History "Add" on a past day (FR-HIST-02 AC1). */
      date?: string;
      /** Prefilled times and link when confirming a planned item. */
      planned?: { row: MatchedRow; at: 'now' | 'planned' };
    }
  | { kind: 'other'; childId: string; date?: string }
  | { kind: 'planned'; childId: string; row: MatchedRow }
  | { kind: 'entry'; entry: Entry }
  | { kind: 'child' }
  | { kind: 'export'; childId: string; date: string };

interface Snack {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface HostValue {
  sheet: SheetRequest | null;
  open: (s: SheetRequest) => void;
  close: () => void;
  snack: (s: Snack, ms?: number) => void;
}

const HostContext = createContext<HostValue>({
  sheet: null,
  open: () => {},
  close: () => {},
  snack: () => {},
});
export const useSheets = () => useContext(HostContext);

export function SheetHost({
  children,
  render,
}: {
  children: ReactNode;
  render: (s: SheetRequest) => ReactNode;
}) {
  const [sheet, setSheet] = useState<SheetRequest | null>(null);
  const [snackState, setSnack] = useState<Snack | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snack = useCallback((s: Snack, ms = 8000) => {
    if (timer.current) clearTimeout(timer.current);
    setSnack(s);
    timer.current = setTimeout(() => setSnack(null), ms);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const value: HostValue = { sheet, open: setSheet, close: () => setSheet(null), snack };
  return (
    <HostContext.Provider value={value}>
      {children}
      {sheet && render(sheet)}
      {snackState && (
        <Snackbar
          message={snackState.message}
          actionLabel={snackState.actionLabel}
          onAction={() => {
            setSnack(null);
            snackState.onAction?.();
          }}
        />
      )}
    </HostContext.Provider>
  );
}
