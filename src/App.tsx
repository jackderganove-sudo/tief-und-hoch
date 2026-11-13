import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { MotionConfig } from 'framer-motion';
import { getDayOffset, isDebug, subscribeDebug } from './debug/debugState';
import { useTranslation } from 'react-i18next';
import type { Mode } from './domain/types';
import { services } from './services';
import { useBerlinDay } from './game/useBerlinDay';
import { currentLang } from './i18n';
import { HomeScreen } from './screens/HomeScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultScreen } from './screens/ResultScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { UpdateToast } from './pwa/UpdateToast';
import { AccountNotice } from './components/AccountSheet';
import { urlRoomCode } from './friends/roomUrl';
// Freunde-Modus: eigener Chunk, wird erst beim Öffnen geladen
const FriendsScreen = lazy(() => import('./friends/FriendsScreen').then((m) => ({ default: m.FriendsScreen })));

// Schwebendes Debug-Panel nur im Dev-Server (?debug=1). Im Live-Build gibt es Debug nur
// über das Admin-Dashboard (serverseitig geprüfter Admin) – dann zeigt die App nur ein Abzeichen.
const DebugPanel = import.meta.env.DEV ? lazy(() => import('./debug/DebugPanel')) : null;
const DebugRoutes = lazy(() => import('./debug/DebugRoutes'));
const debugRoute = (() => {
  const p = new URLSearchParams(location.search);
  return p.has('play') || p.has('world') || p.has('reveal');
})();
// Welt-Vorschau für Screenshots (nur Dev-Server): /?world=rare&m=3000
const WorldPreview = import.meta.env.DEV ? lazy(() => import('./pixel/WorldPreview')) : null;
const previewWorld = import.meta.env.DEV && new URLSearchParams(location.search).has('world');
// Vorschaubild für Link-Vorschauen (nur Dev-Server): /?og
const OgPreview = import.meta.env.DEV ? lazy(() => import('./seo/OgPreview')) : null;
const previewOg = import.meta.env.DEV && new URLSearchParams(location.search).has('og');
// Admin-Bereich: versteckte Route /admin, eigener Chunk (Spieler laden ihn nie)
const AdminApp = lazy(() => import('./admin/AdminApp'));
const adminRoute = /\/admin\/?$/.test(location.pathname);

type Screen =
  | { name: 'home' }
  | { name: 'practice' }
  | { name: 'friends'; code: string | null }
  | { name: 'game'; mode: Mode; dateKey: string } | { name: 'result'; mode: Mode; dateKey: string };

export default function App() {
  useTranslation(); // bei Sprachwechsel neu rendern
  const today = useBerlinDay();
  // Einladungslink ?room=CODE öffnet direkt den Raum
  const [screen, setScreen] = useState<Screen>(() => {
    const code = urlRoomCode();
    return code ? { name: 'friends', code } : { name: 'home' };
  });
  // Erhöht sich bei Debug-Aktionen, damit die Startseite Stände neu einliest.
  const [refresh, setRefresh] = useState(0);
  const debug = useSyncExternalStore(subscribeDebug, isDebug);

  const open = (mode: Mode) => {
    const day = services.progress.getDay(mode, today);
    setScreen(day?.finished ? { name: 'result', mode, dateKey: today } : { name: 'game', mode, dateKey: today });
  };

  if (adminRoute) {
    return (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    );
  }

  if (debug && debugRoute) {
    return (
      <Suspense fallback={null}>
        <DebugRoutes dateKey={today} />
      </Suspense>
    );
  }

  if (OgPreview && previewOg) {
    return (
      <Suspense fallback={null}>
        <OgPreview />
      </Suspense>
    );
  }

  if (WorldPreview && previewWorld) {
    return (
      <Suspense fallback={null}>
        <WorldPreview />
      </Suspense>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      {screen.name === 'home' && (
        <HomeScreen
          key={`${today}-${refresh}-${debug}`}
          dateKey={today}
          onPlay={open}
          onPractice={() => setScreen({ name: 'practice' })}
          onFriends={() => setScreen({ name: 'friends', code: null })}
        />
      )}
      {screen.name === 'friends' && (
        <Suspense fallback={null}>
          <FriendsScreen initialCode={screen.code} onExit={() => setScreen({ name: 'home' })} />
        </Suspense>
      )}
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
      {/* Update-Hinweis nie während einer Runde (Tagesspiel oder Übung) */}
      {/* … auf der Startseite wird eine neue Version sofort von selbst übernommen */}
      <UpdateToast hidden={screen.name === 'game' || screen.name === 'practice'} auto={screen.name === 'home'} />
      {screen.name !== 'game' && screen.name !== 'friends' && <AccountNotice />}
      {debug && !DebugPanel && <DebugBadge />}
      {DebugPanel && debug && (
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

/** Admin-Debug aktiv (Live-Build): kleines Abzeichen, führt zurück ins Dashboard. */
function DebugBadge() {
  const offset = getDayOffset();
  return (
    <a
      href={`${import.meta.env.BASE_URL}admin?tab=debug`}
      title="Debug-Modus (Sandbox) – zum Admin-Dashboard"
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-[100] rounded-full bg-black/80 px-2.5 py-1 font-mono text-[0.7rem] text-lime-300 shadow-lg"
    >
      DEBUG{offset ? ` ${offset > 0 ? '+' : ''}${offset}d` : ''}
    </a>
  );
}
