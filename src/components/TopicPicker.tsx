import { useTranslation } from 'react-i18next';
import { TOPICS, TOPIC_EMOJI, topicSelected, type TopicId, type TopicSelection } from '../domain/types';

/**
 * Themenauswahl per Checkbox, mit "Alle Themen" als Standard.
 * Eigenständig und ohne Bezug zum Übungsmodus – gedacht auch für den
 * späteren Freunde-Modus (Raum-Einstellungen).
 *
 * `value` ist 'all' oder eine Liste von Themen-IDs. 'all' bleibt 'all', auch
 * wenn später neue Themen dazukommen.
 */
export function TopicPicker({
  value,
  onChange,
  counts,
  tone = 'dark',
}: {
  value: TopicSelection;
  onChange: (next: TopicSelection) => void;
  /** Fragen pro Thema; Themen mit 0 werden deaktiviert. */
  counts?: Partial<Record<TopicId, number>>;
  tone?: 'dark' | 'light';
}) {
  const { t } = useTranslation();
  const available = TOPICS.filter((topic) => !counts || (counts[topic] ?? 0) > 0);

  const toggle = (topic: TopicId) => {
    const current = value === 'all' ? [...available] : value;
    const next = current.includes(topic) ? current.filter((x) => x !== topic) : [...current, topic];
    // Alles angehakt = 'all'; Reihenfolge wie in TOPICS halten.
    onChange(available.every((x) => next.includes(x)) ? 'all' : TOPICS.filter((x) => next.includes(x)));
  };

  const dark = tone === 'dark';
  const field = dark ? 'px-field px-field-dark' : 'px-field px-field-light';
  const chip = (checked: boolean, disabled = false) =>
    `${field} flex min-h-11 cursor-pointer items-center gap-1.5 px-1 text-[15px] leading-tight select-none ` +
    `has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#ffd76a] ` +
    (disabled ? 'cursor-not-allowed opacity-35' : checked ? (dark ? 'bg-[#1f6f76]/60' : 'bg-[#f2b53a]/45') : '');

  /** Pixel-Checkbox: echtes <input> (für Tastatur/Screenreader), unsichtbar über dem gezeichneten Kästchen. */
  const box = (checked: boolean, disabled: boolean, onToggle: () => void) => (
    <span className="relative grid size-5 shrink-0 place-items-center border-2 border-[#1b1424] bg-[#fff7e3]">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="absolute inset-0 m-0 cursor-pointer opacity-0" />
      {checked && <span className="size-2.5 bg-[#3a2416] shadow-[inset_-2px_-2px_0_#1b1424]" aria-hidden />}
    </span>
  );

  return (
    <fieldset>
      <legend className="sr-only">{t('topics.legend')}</legend>
      <label className={chip(value === 'all')}>
        {box(value === 'all', false, () => onChange(value === 'all' ? [] : 'all'))}
        <span className="flex-1 font-bold">{t('topics.all')}</span>
        {counts && <span className="tabular-nums opacity-60">{available.reduce((s, x) => s + (counts[x] ?? 0), 0)}</span>}
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {TOPICS.map((topic) => {
          const disabled = !available.includes(topic);
          const checked = !disabled && topicSelected(value, topic);
          return (
            <label key={topic} className={chip(checked, disabled)}>
              {box(checked, disabled, () => toggle(topic))}
              <span aria-hidden className="max-[400px]:hidden">
                {TOPIC_EMOJI[topic]}
              </span>
              <span className="min-w-0 flex-1 hyphens-manual [overflow-wrap:anywhere]">{t(`topics.${topic}`)}</span>
              {counts && <span className="text-xs tabular-nums opacity-60">{counts[topic] ?? 0}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
