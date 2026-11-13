import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase/client';
import { fetchRoom, roomCall, type RoomPreview, type RoomState } from './roomApi';
import { RoomSync } from './roomSync';

/** Raumzustand live (Realtime + Herzschlag + Wiederverbinden). */
export function useRoom(code: string) {
  const sync = useMemo(
    () =>
      new RoomSync(code, {
        fetchState: fetchRoom,
        tick: (c) => roomCall('tick', { code: c }),
        subscribe: (c, h) => {
          if (!supabase) return () => {};
          const ch = supabase
            .channel(`room:${c}`)
            .on('broadcast', { event: 'state' }, () => h.onState())
            .on('broadcast', { event: 'answered' }, (m) => h.onAnswered(m.payload as { idx: number; user_id: string }))
            .on('broadcast', { event: 'tried' }, (m) => h.onTried?.(m.payload as { idx: number; user_id: string; n: number }))
            .subscribe((status) => h.onStatus(status));
          return () => void supabase!.removeChannel(ch);
        },
      }),
    [code],
  );
  const [state, setState] = useState<RoomState | RoomPreview | null>(null);
  const [info, setInfo] = useState({ connected: false, offsetMs: 0 });

  useEffect(() => {
    const off = sync.subscribe((s, i) => {
      setState(s);
      setInfo(i);
    });
    sync.start();
    // Handy: zurück aus dem Hintergrund / Bildschirm wieder an / Netz wieder da
    const resume = () => document.visibilityState === 'visible' && sync.resume();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      off();
      sync.stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [sync]);

  return { state, connected: info.connected, sync, refresh: () => sync.refresh() };
}
