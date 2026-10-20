// Theme: System (default), Light or Dark, stored on this device only (FR-SET-03, D11).
import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'track.theme';
const listeners = new Set<() => void>();

export function getTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function effectiveDark(choice: ThemeChoice): boolean {
  return (
    choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  );
}

export function applyTheme(choice: ThemeChoice = getTheme()) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const colour = effectiveDark(choice) ? '#0f1218' : '#f7f8fa';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = colour;
  document.head.appendChild(meta);
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: still apply for this session */
  }
  applyTheme(choice);
  listeners.forEach((l) => l());
}

/** Keeps System in step with the phone's dark mode as it changes (AC1). */
export function watchSystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getTheme() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onChange);
  applyTheme();
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [t, setT] = useState(getTheme);
  useEffect(() => {
    const l = () => setT(getTheme());
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return [t, setTheme];
}
