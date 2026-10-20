// Built-in image pickers (FR-ACT-07): a simple illustration and a text label on every option.
// The label carries the meaning; the app gives no interpretation of any option (AC2).
import { PICKER_SETS, type PickerSet } from '../../shared/constants';

const SWATCH: Record<string, { fill: string; streak?: string }> = {
  Yellow: { fill: '#F2D04B' },
  Mustard: { fill: '#C9A227' },
  Orange: { fill: '#E08A2E' },
  Green: { fill: '#5E8C3A' },
  Brown: { fill: '#7A4E2D' },
  Black: { fill: '#222222' },
  'Red or red streaks': { fill: '#7A4E2D', streak: '#D23B2E' },
  'White or pale grey': { fill: '#E8E8E2' },
};

function ColourArt({ name }: { name: string }) {
  const s = SWATCH[name] ?? { fill: '#999999' };
  return (
    <svg viewBox="0 0 32 24" aria-hidden="true">
      <ellipse
        cx="16"
        cy="13"
        rx="12"
        ry="8"
        fill={s.fill}
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      {s.streak && (
        <path
          d="M9 11 q4 3 7 -1 q3 -3 7 1"
          fill="none"
          stroke={s.streak}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function ConsistencyArt({ name }: { name: string }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'Watery':
      return (
        <svg viewBox="0 0 32 24" aria-hidden="true">
          <path d="M4 10 q4 -3 8 0 t8 0 t8 0" {...p} />
          <path d="M4 16 q4 -3 8 0 t8 0 t8 0" {...p} />
        </svg>
      );
    case 'Runny':
      return (
        <svg viewBox="0 0 32 24" aria-hidden="true">
          <path d="M5 16 q3 -6 8 -4 q4 -5 9 -1 q5 0 5 5 q-6 3 -11 2 q-6 2 -11 -2z" {...p} />
        </svg>
      );
    case 'Soft':
      return (
        <svg viewBox="0 0 32 24" aria-hidden="true">
          <path d="M6 17 q-2 -7 6 -8 q2 -5 7 -2 q7 0 7 7 q0 3 -3 3z" {...p} />
        </svg>
      );
    case 'Formed':
      return (
        <svg viewBox="0 0 32 24" aria-hidden="true">
          <rect x="4" y="8" width="24" height="9" rx="4.5" {...p} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 32 24" aria-hidden="true">
          <circle cx="8" cy="14" r="3.5" {...p} />
          <circle cx="16" cy="11" r="3.5" {...p} />
          <circle cx="24" cy="14" r="3.5" {...p} />
        </svg>
      );
  }
}

export function ImagePicker({
  set,
  label,
  value,
  onChange,
  disabled,
}: {
  set: PickerSet;
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
}) {
  const options = PICKER_SETS[set];
  // One row for up to five options (consistency), otherwise four across (colour), so the sheet fits
  // on a phone screen without scrolling.
  const cols = options.length <= 5 ? options.length : 4;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="form-label">{label}</span>
      <div
        className="picker"
        role="group"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={value === opt}
            disabled={disabled}
            onClick={() => onChange(value === opt ? undefined : opt)}
          >
            {set === 'stool_colour' ? <ColourArt name={opt} /> : <ConsistencyArt name={opt} />}
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
