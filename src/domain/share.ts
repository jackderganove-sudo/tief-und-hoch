import type { AnswerResult, Mode } from './types';
import { MAX_POINTS, TIERS, pointsToMeters, totalPoints } from './scoring';

export interface ShareLabels {
  title: string;
  modeName: string;
  /** z. B. "Tiefe" / "Höhe" */
  measureLabel: string;
  locale: string;
  url?: string;
}

/** Teilbarer Text mit einer Emoji-Reihe, Wordle-Stil. */
export function buildShareText(
  mode: Mode,
  dateKey: string,
  results: AnswerResult[],
  labels: ShareLabels,
): string {
  const points = totalPoints(results);
  const meters = pointsToMeters(points);
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Intl.DateTimeFormat(labels.locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
  const icon = mode === 'rare' ? '⛏️' : '🎈';
  const sign = mode === 'rare' ? '−' : '';
  const row = results.map((r) => TIERS[r.tier].emoji).join('');
  const fmt = new Intl.NumberFormat(labels.locale);

  return [
    `${labels.title} · ${labels.modeName} ${icon} ${date}`,
    row,
    `${labels.measureLabel}: ${sign}${fmt.format(meters)} m (${points}/${MAX_POINTS})`,
    labels.url,
  ]
    .filter(Boolean)
    .join('\n');
}
