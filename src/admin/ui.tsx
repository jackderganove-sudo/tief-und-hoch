import { useEffect, useState, type ReactNode } from 'react';
import { Panel, PxButton, type ButtonTone } from '../components/px';

/** Gemeinsame Bausteine des Admin-Dashboards (Pixel-Stil, mobil bedienbar). */

export function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm" role="radiogroup" aria-label={label}>
      <span className="w-16 shrink-0 font-tiny text-xs uppercase opacity-75">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`px-field ${value === v ? 'px-field-light text-[#3a2416]' : 'px-field-dark'} px-1 text-sm leading-6 [--px:2px]`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="font-tiny text-[0.65rem] uppercase opacity-70">{label}</span>
      <span className="px-field px-field-dark mt-0.5 block [--px:2px]">{children}</span>
    </label>
  );
}

/** Kritische Aktion: erster Tipp fragt nach, zweiter führt aus (setzt sich nach 4 s zurück). */
export function ConfirmButton({
  tone,
  confirmLabel,
  onConfirm,
  disabled,
  children,
  className = '',
}: {
  tone: ButtonTone;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <PxButton
      tone={armed ? 'coral' : tone}
      small
      disabled={disabled}
      className={`text-base ${className}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </PxButton>
  );
}

/** Kennzahl-Kachel. */
export function Stat({ label, value, hint, color }: { label: string; value: ReactNode; hint?: ReactNode; color?: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-tiny text-[0.6rem] uppercase leading-tight opacity-70">{label}</dt>
      <dd className="text-2xl font-bold leading-tight tabular-nums" style={{ color }}>
        {value}
      </dd>
      {hint && <dd className="text-xs leading-tight opacity-70">{hint}</dd>}
    </div>
  );
}

export function Card({ title, children, className = '', right }: { title: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <Panel tone="stone" className={`px-1 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-tiny text-xs uppercase tracking-wide opacity-80">{title}</h2>
        {right}
      </div>
      <div className="mt-1.5">{children}</div>
    </Panel>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="mt-3 border-2 border-[#e2541e] bg-[#3a1a14] p-2 text-sm">{error}</p> : null;
}

export const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
