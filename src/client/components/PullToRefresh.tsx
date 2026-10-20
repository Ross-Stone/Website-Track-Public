// Pull down at the top of Home to refresh (FR-HOME-05). The sync status button is the
// single-pointer alternative, so nothing depends on the gesture (WCAG 2.5.1).
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { check, useStore } from '../state/store';

const TRIGGER = 64;
const MAX = 96;

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const refreshing = useStore((s) => s.refreshing);
  const start = useRef<number | null>(null);
  const distance = useRef(0);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      // Only from the very top, with no sheet open.
      if (window.scrollY > 0 || document.querySelector('dialog[open]') || e.touches.length !== 1) return;
      start.current = e.touches[0]!.clientY;
      distance.current = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0]!.clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) {
        start.current = null;
        distance.current = 0;
        setPull(0);
        return;
      }
      distance.current = Math.min(MAX, dy * 0.5); // resistance
      setPull(distance.current);
    };
    const onEnd = () => {
      if (start.current !== null && distance.current >= TRIGGER) void check(true);
      start.current = null;
      distance.current = 0;
      setPull(0);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const height = refreshing ? 40 : pull;
  if (height === 0) return null;
  return (
    <div className="pull" style={{ height }} aria-hidden="true">
      <RefreshCw
        size={20}
        className={refreshing ? 'spin' : undefined}
        style={{ transform: refreshing ? undefined : `rotate(${pull * 3}deg)` }}
      />
      <span>{refreshing ? 'Refreshing…' : pull >= TRIGGER ? 'Release to refresh' : 'Pull to refresh'}</span>
    </div>
  );
}
