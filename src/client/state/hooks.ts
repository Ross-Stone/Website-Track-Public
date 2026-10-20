import { useEffect, useMemo, useState } from 'react';
import { roleAtLeast } from '../../shared/constants';
import { Lookup } from '../lib/format';
import { useStore } from './store';

/** Writers and Admin, while online (FR-AUTH-03 AC3, FR-SYNC-03 AC4). */
export function useCanEdit(): boolean {
  const role = useStore((s) => s.boot?.me.role);
  const online = useStore((s) => s.online);
  return !!role && roleAtLeast(role, 'writer') && online;
}

export function useRole() {
  return useStore((s) => s.boot?.me.role ?? 'reader');
}

/** True when the user's role allows writing, regardless of connection (controls are shown but disabled offline). */
export function useIsWriter(): boolean {
  const role = useRole();
  return roleAtLeast(role, 'writer');
}

export function useLookup(): Lookup | null {
  const boot = useStore((s) => s.boot);
  return useMemo(() => (boot ? new Lookup(boot) : null), [boot]);
}

/** Current time, refreshed on an interval (timers show minutes, so 30 s is plenty). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
