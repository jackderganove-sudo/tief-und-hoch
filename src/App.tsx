import { lazy, Suspense, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { debugEnabled } from './debug/debugState';
import { useTranslation } from 'react-i18next';
import type { Mode } from './domain/types';
import { services } from './services';
import { useBerlinDay } from './game/useBerlinDay';
import { currentLang } from './i18n';
import { HomeScreen } from './screens/HomeScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultScreen } from './screens/ResultScreen';
import { PracticeScreen } from './screens/PracticeScreen';

// Nur im Dev-Server oder mit VITE_ENABLE_DEBUG=true geladen; sonst fällt der Import komplett weg.
const DebugPanel = import.meta.env.DEV || __DEBUG_BUILD__ ? lazy(() => import('./debug/DebugPanel')) : null;
// Welt-Vorschau für Screenshots (nur Dev-Server): /?world=rare&m=3000
const WorldPreview = import.meta.env.DEV ? lazy(() => import('./pixel/WorldPreview')) : null;
const previewWorld = import.meta.env.DEV && new URLSearchParams(location.search).has('world');

type Screen =
  | { name: 'home' }
  | { name: 'practice' }
  | { name: 'game'; mode: Mode; dateKey: string } | { name: 'result'; mode: Mode; dateKey: string };

export default function App() {
  useTranslation(); // bei Sprachwechsel neu rendern
  const today = useBerlinDay();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  // Erhöht sich bei Debug-Aktionen, damit die Startseite Stände neu einliest.
  const [refresh, setRefresh] = useState(0);

  const open = (mode: Mode) => {
    const day = services.progress.getDay(mode, today);
    setScreen(day?.finished ? { name: 'result', mode, dateKey: today } : { name: 'game', mode, dateKey: today });
  };

  if (WorldPreview && previewWorld) {
    return (
      <Suspense fallback={null}>
        <WorldPreview />
      </Suspense>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      {screen.name === 'home' && <HomeScreen key={`${today}-${refresh}`} dateKey={today} onPlay={open} onPractice={() => setScreen({ name: 'practice' })} />}
      {screen.name === 'practice' && <PracticeScreen lang={currentLang()} dateKey={today} onExit={() => setScreen({ name: 'home' })} />}
      {screen.name === 'game' && (
        <GameScreen
          key={`${screen.mode}-${screen.dateKey}`}
          mode={screen.mode}
          dateKey={screen.dateKey}
          lang={currentLang()}
          onExit={() => setScreen({ name: 'home' })}
          onFinished={() => setScreen({ name: 'result', mode: screen.mode, dateKey: screen.dateKey })}
        />
      )}
      {screen.name === 'result' && (
        <ResultScreen
          key={`${screen.mode}-${screen.dateKey}`}
          mode={screen.mode}
          dateKey={screen.dateKey}
          onHome={() => setScreen({ name: 'home' })}
          onOtherMode={() => open(screen.mode === 'rare' ? 'common' : 'rare')}
        />
      )}
      {DebugPanel && debugEnabled && (
        <Suspense fallback={null}>
          <DebugPanel
            dateKey={today}
            onChange={() => {
              setScreen({ name: 'home' });
              setRefresh((r) => r + 1);
            }}
          />
        </Suspense>
      )}
    </MotionConfig>
  );
}
