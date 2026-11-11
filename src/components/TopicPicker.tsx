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
  const chip = (checked: boolean, disabled = false) =>
    `flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[13px] leading-tight font-medium ring-1 transition select-none ` +
    `has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ` +
    (disabled
      ? 'cursor-not-allowed opacity-35 ring-current/10'
      : checked
        ? dark
          ? 'bg-glow-crystal/20 ring-glow-crystal/70'
          : 'bg-balloon/15 ring-balloon/70'
        : dark
          ? 'bg-white/5 ring-white/15 hover:bg-white/10'
          : 'bg-white/50 ring-black/10 hover:bg-white/80');
  const box = `h-4 w-4 shrink-0 ${dark ? 'accent-[#8be9fd]' : 'accent-[#ff7a59]'}`;

  return (
    <fieldset>
      <legend className="sr-only">{t('topics.legend')}</legend>
      <label className={chip(value === 'all')}>
        <input type="checkbox" className={box} checked={value === 'all'} onChange={() => onChange(value === 'all' ? [] : 'all')} />
        <span className="flex-1 font-semibold">{t('topics.all')}</span>
        {counts && <span className="tabular-nums opacity-60">{available.reduce((s, x) => s + (counts[x] ?? 0), 0)}</span>}
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {TOPICS.map((topic) => {
          const disabled = !available.includes(topic);
          const checked = !disabled && topicSelected(value, topic);
          return (
            <label key={topic} className={chip(checked, disabled)}>
              <input type="checkbox" className={box} checked={checked} disabled={disabled} onChange={() => toggle(topic)} />
              <span aria-hidden className="max-[400px]:hidden">{TOPIC_EMOJI[topic]}</span>
              <span className="min-w-0 flex-1 hyphens-manual [overflow-wrap:anywhere]">{t(`topics.${topic}`)}</span>
              {counts && <span className="text-xs tabular-nums opacity-60">{counts[topic] ?? 0}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
