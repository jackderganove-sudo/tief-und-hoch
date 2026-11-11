import { useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { Mode } from './domain/types';
import { services } from './services';
import { useBerlinDay } from './game/useBerlinDay';
import { currentLang } from './i18n';
import { HomeScreen } from './screens/HomeScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultScreen } from './screens/ResultScreen';

type Screen = { name: 'home' } | { name: 'game'; mode: Mode; dateKey: string } | { name: 'result'; mode: Mode; dateKey: string };

export default function App() {
  useTranslation(); // bei Sprachwechsel neu rendern
  const today = useBerlinDay();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  const open = (mode: Mode) => {
    const day = services.progress.getDay(mode, today);
    setScreen(day?.finished ? { name: 'result', mode, dateKey: today } : { name: 'game', mode, dateKey: today });
  };

  return (
    <MotionConfig reducedMotion="user">
      {screen.name === 'home' && <HomeScreen dateKey={today} onPlay={open} />}
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
    </MotionConfig>
  );
}
