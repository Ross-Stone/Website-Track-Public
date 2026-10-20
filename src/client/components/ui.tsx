// Track component library, built from the design (App.dc.html) on the tokens in tokens.css.
import { ChevronRight, Info, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import type { PaletteColour } from '../../shared/constants';
import { ActivityGlyph } from '../lib/icons';
import { Link } from '../lib/router';

/** CSS custom properties for an activity colour. */
export function paletteVars(colour: PaletteColour | 'neutral'): CSSProperties {
  if (colour === 'neutral')
    return { '--fg': 'var(--text)', '--bg-tile': 'var(--surface-2)' } as CSSProperties;
  return { '--fg': `var(--${colour}-fg)`, '--bg-tile': `var(--${colour}-bg)` } as CSSProperties;
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------- buttons ----------

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'soft';
  size?: 'md' | 'sm';
  block?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  className,
  children,
  type,
  ...rest
}: BtnProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cx(
        'btn',
        variant !== 'secondary' && `btn-${variant}`,
        size === 'sm' && 'btn-sm',
        block && 'btn-block',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  variant,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: 'boxed' | 'filled' }) {
  return (
    <button type="button" aria-label={label} className={cx('icon-btn', variant, className)} {...rest}>
      {children}
    </button>
  );
}

// ---------- activity tile ----------

export function ActivityTile({
  icon,
  colour,
  size = 36,
  className,
}: {
  icon: string;
  colour: PaletteColour | 'neutral';
  size?: 30 | 34 | 36 | 44;
  className?: string;
}) {
  const px = { 30: 16, 34: 18, 36: 20, 44: 24 }[size];
  return (
    <span className={cx('tile', `tile-${size}`, className)} style={paletteVars(colour)} aria-hidden="true">
      <ActivityGlyph name={icon} size={px} />
    </span>
  );
}

// ---------- form controls ----------

export function TextField({
  label,
  suffix,
  error,
  hint,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  suffix?: string;
  error?: string | null;
  hint?: string;
}) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={cx('field', className)}>
      <label htmlFor={id}>{label}</label>
      <span className="field-box">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          {...input}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </span>
      {hint && !error && (
        <span className="muted" style={{ fontWeight: 400 }}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errId} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="field-box">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

export function FieldGrid({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <div className="field-grid" style={{ '--cols': cols } as CSSProperties}>
      {children}
    </div>
  );
}

/** Segmented control. Single choice by default; `multi` for the day picker. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  multi,
  disabled,
}: {
  label?: string;
  options: { value: T; label: string; ariaLabel?: string }[];
  value: T | T[];
  onChange: (v: T) => void;
  multi?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {label && (
        <span id={id} className="form-label">
          {label}
        </span>
      )}
      <div className={cx('seg', multi && 'multi')} role="group" aria-labelledby={label ? id : undefined}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected(o.value)}
            aria-label={o.ariaLabel}
            onClick={() => onChange(o.value)}
            disabled={disabled}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A switch whose whole row is the 44px target. */
export function SwitchRow({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="switch-row"
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="grow stack">
        <span className="label">{label}</span>
        {help && <span className="help">{help}</span>}
      </span>
      <span className="switch" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export function InfoBox({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div className={cx('info', warn && 'warn')}>
      <Info size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

// ---------- settings building blocks ----------

export function Section({
  title,
  children,
  card = true,
}: {
  title?: string;
  children: ReactNode;
  card?: boolean;
}) {
  const id = useId();
  return (
    <section className="section" aria-labelledby={title ? id : undefined}>
      {title && (
        <h2 id={id} className="section-title">
          {title}
        </h2>
      )}
      {card ? <div className="card">{children}</div> : children}
    </section>
  );
}

export function NavRow({
  to,
  onClick,
  title,
  sub,
  lead,
  badges,
  tile,
}: {
  to?: string;
  onClick?: () => void;
  title: string;
  sub?: string;
  lead?: string;
  badges?: string[];
  tile?: ReactNode;
}) {
  const inner = (
    <>
      {lead && <span className="lead tabular">{lead}</span>}
      {tile}
      <span className="grow stack" style={{ gap: 3 }}>
        <span className="title">{title}</span>
        {sub && <span className="sub">{sub}</span>}
        {badges && badges.length > 0 && (
          <span className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {badges.map((b) => (
              <span key={b} className="badge-quiet badge">
                {b}
              </span>
            ))}
          </span>
        )}
      </span>
      <ChevronRight size={18} className="muted" aria-hidden="true" />
    </>
  );
  return to ? (
    <Link to={to} className="nav-row">
      {inner}
    </Link>
  ) : (
    <button type="button" className="nav-row" onClick={onClick}>
      {inner}
    </button>
  );
}

// ---------- sheet ----------

/**
 * Bottom sheet on a native modal <dialog>: focus is trapped, Escape closes, the rest of the page is inert.
 */
export function Sheet({
  open,
  onClose,
  title,
  sub,
  tile,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  tile?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // tap on the scrim
      }}
    >
      {open && (
        <div className="sheet-inner">
          <span className="sheet-handle" aria-hidden="true" />
          <div className="sheet-head">
            {tile}
            <div className="grow stack">
              <h2 id={titleId} className="sheet-title">
                {title}
              </h2>
              {sub && <span className="page-sub">{sub}</span>}
            </div>
            <IconButton label="Close" variant="filled" onClick={onClose}>
              <X size={20} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="sheet-body">{children}</div>
        </div>
      )}
    </dialog>
  );
}

// ---------- snackbar ----------

export function Snackbar({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="snackbar" role="status">
      <span className="grow">{message}</span>
      {actionLabel && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="info warn" role="alert">
      <span>{message}</span>
    </div>
  );
}
