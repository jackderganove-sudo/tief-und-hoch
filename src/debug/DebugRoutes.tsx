import { useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { scoreAnswer, tierFor } from '../domain/scoring';
import { MODES, type AnswerResult, type Lang, type Mode, type Question, type TierId } from '../domain/types';
import { currentLang } from '../i18n';
import { services } from '../services';
import { PixelWorld, type WorldView } from '../pixel/PixelWorld';
import { PracticeScreen } from '../screens/PracticeScreen';
import { TierReveal } from '../components/TierReveal';
import { PxButton } from '../components/px';

/**
 * Debug-Ansichten (nur im Debug-Modus, d. h. Dev-Server mit ?debug=1 oder bestätigter Admin):
 *   ?play=de-food-001&mode=rare    Frage direkt spielen (Übungsrunde mit genau dieser Frage)
 *   ?world=rare&m=3000             Zone/Höhe direkt anspringen (Design-Tests)
 *   ?reveal=core&mode=rare         Medaillen-Einblendung einer bestimmten Stufe erzwingen
 */
export function debugRouteRequested(search = location.search): boolean {
  const p = new URLSearchParams(search);
  return p.has('play') || p.has('world') || p.has('reveal');
}

const toDashboard = () => location.assign(`${import.meta.env.BASE_URL}admin?tab=debug`);

export default function DebugRoutes({ dateKey }: { dateKey: string }) {
  const p = new URLSearchParams(location.search);
  const mode: Mode = p.get('mode') === 'common' ? 'common' : 'rare';
  const lang = currentLang();

  if (p.has('play')) {
    const id = p.get('play')!;
    const qLang = (id.slice(0, 2) === 'en' ? 'en' : id.slice(0, 2) === 'de' ? 'de' : lang) as Lang;
    return (
      <MotionConfig reducedMotion="user">
        <PracticeScreen lang={qLang} dateKey={dateKey} onExit={toDashboard} forced={{ mode, ids: [id] }} />
      </MotionConfig>
    );
  }

  if (p.has('reveal')) return <RevealPreview tier={p.get('reveal') as TierId} mode={mode} lang={lang} />;

  const view = (p.get('world') || 'home') as WorldView;
  return (
    <div className="relative h-dvh w-full">
      <PixelWorld view={view} meters={Number(p.get('m') ?? 0)} />
      <BackButton />
    </div>
  );
}

function BackButton() {
  return (
    <PxButton tone="stone" small className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 text-base" onClick={toDashboard}>
      ← Dashboard
    </PxButton>
  );
}

/** Medaille erzwingen: passende Antwort aus einer echten Frage suchen und die Einblendung zeigen. */
function RevealPreview({ tier, mode, lang }: { tier: TierId; mode: Mode; lang: Lang }) {
  const [data, setData] = useState<{ q: Question; r: AnswerResult } | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    void services.questions.getQuestions({ lang, mode, topics: 'all' }).then((qs) => {
      const pool = qs.slice(n % Math.max(1, qs.length)).concat(qs);
      for (const q of pool) {
        const a = q.answers.find((x) => tierFor(mode, x.baseScore, x.tooClever) === tier);
        if (a || tier === 'invalid') {
          const input = a?.text ?? 'xyz';
          const r = scoreAnswer({ mode, questionId: q.id, input, match: a ? { answer: a, distance: 0 } : null, frequency: a?.baseScore ?? null });
          setData({ q, r });
          return;
        }
      }
    });
  }, [tier, mode, lang, n]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-dvh w-full">
        <div className="fixed inset-0">
          <PixelWorld view={mode} meters={data ? data.r.points * 10 : 0} />
        </div>
        <BackButton />
        <div className="relative z-10 mx-auto max-w-xl px-3 pt-[40vh]">
          {data ? (
            <TierReveal result={data.r} question={data.q} mode={mode} nextLabel="Andere Frage" onNext={() => setN((x) => x + 7)} />
          ) : (
            <p className="text-center">Keine Antwort mit Stufe „{tier}“ in {MODES.includes(mode) ? mode : '?'} gefunden.</p>
          )}
        </div>
      </div>
    </MotionConfig>
  );
}
